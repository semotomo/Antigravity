import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { decodeProductEditInspection } from './inspection.server'
import { configuredPosProductInspector } from './inspection-transport.server'
import { parsePosProductCommand } from './validation'
import { prepareProductEditOperation, registerProductEditDispatch, loadProductEditDispatchRecovery } from './ledger.server'
import type { PosProductStoreId } from './types'

/** 実GAS入口の確認後にサーバー内で接続する。ブラウザから関数/URL/資格情報を受け付けない。 */
export type PosProductInspector = {
  inspect(target: { storeId: PosProductStoreId; janCode: string; actorId: string; operationId: string }): Promise<unknown>
}

/** 認可→店舗別DB商品→POS両検索→差分→台帳受付を接続。保存リクエストは送らない。 */
export async function prepareProductEditFromPos(input: unknown, inspector?: PosProductInspector) {
  const command = parsePosProductCommand(input)
  if (command.kind !== 'update') throw new Error('通常の商品編集だけを確認できます。')
  if (process.env.POS_PRODUCT_WRITES_ENABLED !== 'true') throw new Error('POS商品保存はまだ有効になっていません。')
  const client = await createClient()
  const user = await requireInventoryManagerAccess(client, command.storeId)
  const { data, error } = await client.from('products').select('id,store_id,jan_code')
    .eq('store_id', command.storeId).eq('id', command.productId).maybeSingle()
  // 手書きDatabase型と現行Supabase型の差異を限定し、DB応答の値を改めて検証する。
  const product = data as unknown as { id: unknown; store_id: unknown; jan_code: unknown } | null
  if (error || !product || product.store_id !== command.storeId || product.id !== command.productId ||
      typeof product.jan_code !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(product.jan_code)) {
    throw new Error('対象店舗の商品とJANを確認できません。')
  }
  let raw: unknown
  try {
    const reader = inspector ?? configuredPosProductInspector()
    raw = await reader.inspect({ storeId: command.storeId, janCode: product.jan_code, actorId: user.id, operationId: command.operationId })
  } catch {
    // 接続例外のHTML/認証情報を利用者や監視サービスへ渡さない。
    throw new Error('POSの商品情報を取得できません。入力を保持して取得し直してください。')
  }
  const inspection = decodeProductEditInspection({ storeId: command.storeId, productId: command.productId, janCode: product.jan_code }, raw)
  const group = inspection.groups.find(g => g.id === command.fields.groupId)
  const supplier = command.fields.supplierId === null ? null : inspection.suppliers.find(s => s.id === command.fields.supplierId)
  if (!group || supplier === undefined) throw new Error('この店舗で選択できる商品グループ・仕入先ではありません。')
  const prepared = await prepareProductEditOperation(command, inspection.snapshot, inspection.choices, { storeId: command.storeId, group, supplier })
  if (process.env.POS_PRODUCT_DISPATCH_ENABLED !== 'true') return prepared
  // 登録応答消失や再受付では、本文・期限・照合基準を作り直さない。
  const recovered = await loadProductEditDispatchRecovery(command.storeId, command.operationId)
  const original = prepared.operation
  const current = recovered.operation
  if (current.operationId !== original.operationId || current.actorId !== original.actorId || current.storeId !== original.storeId ||
      current.payloadHash !== original.payloadHash || current.expectedResultFingerprint !== original.expectedResultFingerprint ||
      current.version < original.version) throw new Error('商品操作の実行記録を確認できません。再送せず、操作状態を確認してください。')
  // 他の処理で送信中へ進んだ場合も、取得した状態をpreparedへ戻さない。
  if (recovered.dispatch || current.status !== 'prepared') {
    return { ...prepared, ...recovered, review: recovered.dispatch?.review ?? prepared.review }
  }
  const registered = await registerProductEditDispatch(current, command, inspection)
  return { ...prepared, operation: registered.operation, review: registered.dispatch.review, dispatch: registered.dispatch }
}

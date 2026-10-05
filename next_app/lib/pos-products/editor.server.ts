import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { parsePosProductCommand } from './validation'
import { configuredPosProductInspector } from './inspection-transport.server'
import { decodeProductEditInspection } from './inspection.server'
import { buildProductEditReview } from './edit-review.server'
import type { ProductEditInspection } from './inspection.server'
import type { PosProductInspector } from './edit-preparation.server'
import type { ProductEditorData, ProductEditorReviewData } from './editor'
import type { PosProductStoreId } from './types'

type Target = { storeId: PosProductStoreId; productId: number; operationId: string }
export class ProductEditorError extends Error {}

function target(value: unknown): Target {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductEditorError('対象店舗・商品を確認してください。')
  const input = value as Record<string, unknown>
  const keys = ['storeId', 'productId', 'operationId']
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key)) ||
      (input.storeId !== 6 && input.storeId !== 7) || typeof input.productId !== 'number' ||
      !Number.isSafeInteger(input.productId) || input.productId <= 0 || typeof input.operationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.operationId)) {
    throw new ProductEditorError('対象店舗・商品を確認してください。')
  }
  return { storeId: input.storeId, productId: input.productId, operationId: input.operationId }
}

/** 台帳受付やPOS保存は行わない。フラグは表示だけでなく毎回サーバーで検査する。 */
async function readInspection(input: Target, inspector?: PosProductInspector): Promise<ProductEditInspection> {
  if (process.env.POS_PRODUCT_EDITOR_ENABLED !== 'true') throw new ProductEditorError('POS商品編集の準備機能はまだ有効になっていません。')
  const client = await createClient()
  let actorId: string
  try { actorId = (await requireInventoryManagerAccess(client, input.storeId)).id }
  catch { throw new ProductEditorError('店舗管理者の権限を確認できません。ログイン状態と店舗権限を確認してください。') }
  const { data, error } = await client.from('products').select('id,store_id,jan_code')
    .eq('store_id', input.storeId).eq('id', input.productId).maybeSingle()
  const product = data as unknown as { id: unknown; store_id: unknown; jan_code: unknown } | null
  if (error || !product || product.id !== input.productId || product.store_id !== input.storeId ||
      typeof product.jan_code !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(product.jan_code)) {
    throw new ProductEditorError('対象店舗の商品とJANを確認できません。入力は保持されています。')
  }
  try {
    // 接続の生成・GAS資格情報へのアクセスも認可と店舗別DB照合の後に限定する。
    const reader = inspector ?? configuredPosProductInspector()
    const raw = await reader.inspect({ storeId: input.storeId, operationId: input.operationId, janCode: product.jan_code, actorId })
    return decodeProductEditInspection({ storeId: input.storeId, productId: input.productId, janCode: product.jan_code }, raw)
  } catch { throw new ProductEditorError('POSの商品情報を取得・照合できません。入力を保持して取得し直してください。') }
}

export async function loadProductEditor(input: unknown, inspector?: PosProductInspector): Promise<ProductEditorData> {
  const request = target(input)
  const inspection = await readInspection(request, inspector)
  const snapshot = inspection.snapshot
  return { storeId: snapshot.storeId, productId: snapshot.productId, janCode: snapshot.janCode,
    capturedAt: snapshot.capturedAt, fingerprint: inspection.fingerprint, fields: { ...snapshot.fields },
    groups: inspection.groups.map(group => ({ ...group })), suppliers: inspection.suppliers.map(supplier => ({ ...supplier })) }
}

export async function reviewProductEditor(input: unknown, inspector?: PosProductInspector): Promise<ProductEditorReviewData> {
  let command
  try {
    command = parsePosProductCommand(input)
    if (command.kind !== 'update') throw new Error()
  } catch { throw new ProductEditorError('商品名・店舗別の候補・整数円の金額を確認してください。') }
  const inspection = await readInspection({ storeId: command.storeId, productId: command.productId, operationId: command.operationId }, inspector)
  // ブラウザのsnapshotやJANは受け取らず、再取得した業務値から差分を検証する。
  let review
  try { review = buildProductEditReview(command, inspection.snapshot, inspection.choices) }
  catch {
    if (command.expectedFingerprint !== inspection.fingerprint) {
      throw new ProductEditorError('POS商品が編集開始後に変更されました。入力を保持してPOSから読み直し、差分を確認してください。')
    }
    throw new ProductEditorError('変更内容を確認できません。変更した項目・店舗別の候補・整数円の金額を確認してください。')
  }
  return { operationId: review.operationId, reviewedAt: review.reviewedAt, changes: review.changes.map(change => {
    const catalog = change.field === 'groupId' ? inspection.groups : change.field === 'supplierId' ? inspection.suppliers : null
    const label = (value: string | null) => value === null ? null : catalog?.find(choice => choice.id === value)?.name ?? value
    return { ...change, before: label(change.before), after: label(change.after) }
  }) }
}

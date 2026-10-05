'use server'

import { prepareProductEditFromPos } from '@/lib/pos-products/edit-preparation.server'
import { executePreparedProductEdit, loadProductEditExecution, inspectProductEditRecovery, cancelPreparedProductEdit } from '@/lib/pos-products/edit-execution.server'
import type { ActionResult, ProductEditExecutionData, ProductEditRecoveryData } from '@/lib/pos-products/editor'

function prepareEnabled(): boolean {
  return process.env.POS_PRODUCT_EDITOR_ENABLED === 'true' && process.env.POS_PRODUCT_WRITES_ENABLED === 'true' &&
    process.env.POS_PRODUCT_DISPATCH_ENABLED === 'true' && process.env.POS_PRODUCT_EDIT_GATEWAY_ENABLED === 'true' &&
    process.env.POS_PRODUCT_CONSUME_ENABLED === 'true' && process.env.POS_PRODUCT_EDIT_EXECUTION_ENABLED === 'true'
}

// 初回だけ入力を固定する。認可・店舗別照合はDAL内で実施し、固定本文は返さない。
export async function preparePosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditExecutionData>> {
  if (!prepareEnabled()) return { success: false, error: 'POS商品保存はまだ有効になっていません。入力は保持されています。' }
  try {
    const prepared = await prepareProductEditFromPos(input)
    if (!prepareEnabled()) throw new Error('停止中')
    const data = await loadProductEditExecution({ storeId: prepared.operation.storeId, operationId: prepared.operation.operationId })
    return { success: true, data }
  } catch {
    // commit後の応答消失もあり得るため、別操作での再送を勧めない。
    return { success: false, error: '保存準備の結果を確認できません。入力を保持しています。同じ操作IDで保存状態を確認してください。' }
  }
}

// 保存・照合・DB復旧は固定記録と状態に基づき、ブラウザのpatchを受け取らない。
export async function savePosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditExecutionData>> {
  try { return { success: true, data: await executePreparedProductEdit(input) } }
  catch { return { success: false, error: '保存結果を確認できません。再送せず「保存状態を確認」で同じ操作を確認してください。' } }
}

// 書込み停止時もmanager再認可付きの読取り復旧を残す。
export async function recoverPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditExecutionData>> {
  try { return { success: true, data: await loadProductEditExecution(input) } }
  catch { return { success: false, error: '保存状態を確認できません。入力と操作IDを保持し、ログイン状態・店舗権限を確認してください。' } }
}

export async function inspectPosProductEditorRecoveryAction(input: unknown): Promise<ActionResult<ProductEditRecoveryData>> {
  try { return { success: true, data: await inspectProductEditRecovery(input) } }
  catch { return { success: false, error: '店舗・商品・本人の操作状態を確認できません。復旧情報は解除せず、同じ操作IDで確認してください。' } }
}

export async function cancelPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditRecoveryData>> {
  try { return { success: true, data: await cancelPreparedProductEdit(input) } }
  catch { return { success: false, error: '未送信取消の完了を確認できません。復旧情報を保持して状態を確認してください。送信済み・結果不明の操作は取消できません。' } }
}

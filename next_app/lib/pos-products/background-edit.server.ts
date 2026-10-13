import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { backgroundEditProduct, backgroundEditRecord, backgroundEditStore, backgroundEditUuid,
  decodeProductEditIntakeData, parseBackgroundEditRequest } from './background-edit'
import type { ProductEditIntakeData } from './background-edit'
import { BackgroundEditFailure } from './background-failure'

const FAILURE = '商品変更の受付状態を確認できません。入力を保持し、同じ操作の受付状態を確認してください。'
export function backgroundEditEnabled() {
  return process.env.POS_PRODUCT_BACKGROUND_EDIT_ENABLED === 'true' && process.env.POS_PRODUCT_WRITES_ENABLED === 'true' &&
    process.env.POS_PRODUCT_DISPATCH_ENABLED === 'true'
}
export function backgroundClassificationEnabled() {
  return backgroundEditEnabled() && process.env.POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED === 'true'
}
/** service鍵とDB例外はサーバー内部だけで扱い、呼出元へ原文を渡さない。 */
export async function backgroundEditRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new BackgroundEditFailure('BG_EDIT_DB_CONFIG')
  let connected = false
  try {
    const client = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    connected = true
    const { data, error } = await client.rpc(name, args)
    if (error) {
      // DBの元例外・本文は記録せず、限定したSQLSTATE/RESTコードだけを残す。
      const sqlstate = typeof error.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(error.code) ? error.code : 'UNKNOWN'
      console.warn('POS_PRODUCT_BACKGROUND_DB_REJECTED', { sqlstate })
      throw new BackgroundEditFailure('BG_EDIT_DB_REJECTED')
    }
    return data
  } catch (error) {
    if (error instanceof BackgroundEditFailure) throw error
    throw new BackgroundEditFailure(connected ? 'BG_EDIT_DB_TRANSPORT' : 'BG_EDIT_DB_CONFIG')
  }
}
async function authorize(storeId: 6 | 7) {
  try {
    const client = await createClient()
    return (await requireInventoryManagerAccess(client, storeId)).id
  } catch { throw new BackgroundEditFailure('BG_EDIT_ACCESS') }
}
export async function enqueueBackgroundProductEdit(input: unknown): Promise<ProductEditIntakeData> {
  let command: ReturnType<typeof parseBackgroundEditRequest>
  try { command = parseBackgroundEditRequest(input) }
  catch { throw new BackgroundEditFailure('BG_EDIT_VALIDATION') }
  if (!backgroundEditEnabled()) throw new BackgroundEditFailure('BG_EDIT_DISABLED')
  if (command.catalogSnapshotId && !backgroundClassificationEnabled()) throw new BackgroundEditFailure('BG_EDIT_DISABLED')
  const actorId = await authorize(command.storeId)
  if (!backgroundEditEnabled()) throw new BackgroundEditFailure('BG_EDIT_DISABLED')
  if (command.catalogSnapshotId && !backgroundClassificationEnabled()) throw new BackgroundEditFailure('BG_EDIT_DISABLED')
  const result = await backgroundEditRpc(command.catalogSnapshotId ? 'enqueue_pos_product_edit_intake_v2' : 'enqueue_pos_product_edit_intake', {
    p_actor_id: actorId, p_store_id: command.storeId, p_product_id: command.productId,
    p_operation_id: command.operationId, p_patch_text: JSON.stringify(command.patch), p_expected_values_text: JSON.stringify(command.expectedValues),
    ...(command.catalogSnapshotId ? { p_catalog_snapshot_id: command.catalogSnapshotId } : {}),
  })
  try {
    const raw = backgroundEditRecord(result)
    if (raw.actor_id !== actorId) throw new BackgroundEditFailure('BG_EDIT_RECEIPT')
    const data = decodeProductEditIntakeData(raw)
    if (data.operationId !== command.operationId || data.storeId !== command.storeId || data.productId !== command.productId ||
        JSON.stringify(data.patch) !== JSON.stringify(command.patch) || data.catalogSnapshotId !== command.catalogSnapshotId ||
        (Object.hasOwn(command.patch, 'groupId') && data.posChoiceBaseline?.groupId !== command.expectedValues.groupId) ||
        (Object.hasOwn(command.patch, 'supplierId') && data.posChoiceBaseline?.supplierId !== command.expectedValues.supplierId)) throw new BackgroundEditFailure('BG_EDIT_RECEIPT')
    return data
  } catch { throw new BackgroundEditFailure('BG_EDIT_RECEIPT') }
}
export async function controlBackgroundProductEdit(input: unknown): Promise<ProductEditIntakeData | { operationId: string; storeId: 6 | 7; productId: number; abandoned: true }> {
  const row = backgroundEditRecord(input)
  const keys = row.action === 'abandon' ? ['storeId', 'operationId', 'productId', 'action'] : ['storeId', 'operationId', 'action']
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
      !['cancel', 'resume', 'abandon'].includes(String(row.action))) throw new Error(FAILURE)
  const storeId = backgroundEditStore(row.storeId), operationId = backgroundEditUuid(row.operationId)
  if (row.action === 'resume' && !backgroundEditEnabled()) throw new Error(FAILURE)
  const actorId = await authorize(storeId)
  if (row.action === 'abandon') {
    const productId = backgroundEditProduct(row.productId)
    const receipt = backgroundEditRecord(await backgroundEditRpc('abandon_pos_product_edit_intake',
      { p_actor_id: actorId, p_store_id: storeId, p_product_id: productId, p_operation_id: operationId }))
    if (Object.keys(receipt).length !== 4 || receipt.operationId !== operationId || receipt.storeId !== storeId ||
        receipt.productId !== productId || receipt.abandoned !== true) throw new Error(FAILURE)
    return { operationId, storeId, productId, abandoned: true }
  }
  if (row.action === 'resume' && !backgroundEditEnabled()) throw new Error(FAILURE)
  const result = decodeProductEditIntakeData(await backgroundEditRpc(row.action === 'cancel' ? 'cancel_pos_product_edit_intake' : 'requeue_pos_product_edit_intake',
    { p_actor_id: actorId, p_store_id: storeId, p_operation_id: operationId }))
  if (result.storeId !== storeId || result.operationId !== operationId ||
      (row.action === 'cancel' ? result.status !== 'cancelled' : result.status !== 'queued')) throw new Error(FAILURE)
  return result
}
export async function readBackgroundProductEdits(input: unknown): Promise<ProductEditIntakeData | ProductEditIntakeData[] | null> {
  const request = backgroundEditRecord(input), storeId = backgroundEditStore(request.storeId)
  const keys = Object.keys(request)
  if (keys.length !== 2 || keys.some(key => !['storeId', 'operationId', 'productIds'].includes(key)) ||
      Object.hasOwn(request, 'operationId') === Object.hasOwn(request, 'productIds')) throw new Error(FAILURE)
  const operationId = Object.hasOwn(request, 'operationId') ? backgroundEditUuid(request.operationId) : null
  let productIds: number[] = []
  if (operationId === null) {
    if (!Array.isArray(request.productIds) || request.productIds.length < 1 || request.productIds.length > 100) throw new Error(FAILURE)
    productIds = request.productIds.map(backgroundEditProduct)
    if (new Set(productIds).size !== productIds.length) throw new Error(FAILURE)
  }
  // 機能停止後も既存受付を確認できる。管理者認可は停止状態と無関係に必須。
  const actorId = await authorize(storeId)
  const raw = await backgroundEditRpc(operationId ? 'get_pos_product_edit_intake' : 'get_pos_product_edit_intakes',
    operationId ? { p_actor_id: actorId, p_store_id: storeId, p_operation_id: operationId }
      : { p_actor_id: actorId, p_store_id: storeId, p_product_ids: productIds })
  if (operationId) {
    if (raw === null) return null
    const dto = decodeProductEditIntakeData(raw)
    if (dto.storeId !== storeId || dto.operationId !== operationId) throw new Error(FAILURE)
    return dto
  }
  if (!Array.isArray(raw) || raw.length > 100) throw new Error(FAILURE)
  const result = raw.map(decodeProductEditIntakeData)
  if (result.some(dto => dto.storeId !== storeId || !productIds.includes(dto.productId)) ||
      new Set(result.map(dto => dto.productId)).size !== result.length) throw new Error(FAILURE)
  return result
}

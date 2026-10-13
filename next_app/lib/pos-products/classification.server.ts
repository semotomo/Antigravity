import 'server-only'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { backgroundClassificationEnabled, backgroundEditRpc } from './background-edit.server'
import { backgroundEditUuid } from './background-edit'
import { BackgroundEditFailure } from './background-failure'
import { decodeBackgroundClassificationSnapshot, parseBackgroundClassificationTarget } from './classification'
import { loadProductEditor } from './editor.server'
import type { BackgroundClassificationTarget } from './classification'

function enabled() {
  if (!backgroundClassificationEnabled()) throw new BackgroundEditFailure('BG_EDIT_DISABLED')
}
async function target(input: unknown) {
  let request: BackgroundClassificationTarget
  try { request = parseBackgroundClassificationTarget(input) } catch { throw new BackgroundEditFailure('BG_EDIT_VALIDATION') }
  enabled()
  let client: Awaited<ReturnType<typeof createClient>>, actorId: string
  try {
    client = await createClient()
    actorId = backgroundEditUuid((await requireInventoryManagerAccess(client, request.storeId)).id)
  }
  catch { throw new BackgroundEditFailure('BG_EDIT_ACCESS') }
  let product: { id: unknown; store_id: unknown; jan_code: unknown } | null
  try {
    const { data, error } = await client.from('products').select('id,store_id,jan_code').eq('store_id', request.storeId).eq('id', request.productId).maybeSingle()
    if (error) throw new BackgroundEditFailure('BG_EDIT_DB_REJECTED')
    product = data as unknown as typeof product
  } catch (error) {
    if (error instanceof BackgroundEditFailure) throw error
    throw new BackgroundEditFailure('BG_EDIT_DB_TRANSPORT')
  }
  if (!product || product.id !== request.productId || product.store_id !== request.storeId ||
      typeof product.jan_code !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(product.jan_code)) throw new BackgroundEditFailure('BG_EDIT_RECEIPT')
  enabled()
  return { ...request, janCode: product.jan_code, actorId }
}
export async function readBackgroundClassification(input: unknown) {
  const request = await target(input)
  const raw = await backgroundEditRpc('get_pos_product_classification_snapshot', {
    p_actor_id: request.actorId, p_store_id: request.storeId, p_product_id: request.productId,
  })
  if (raw === null) return null
  try { return decodeBackgroundClassificationSnapshot(raw, request) }
  catch { throw new BackgroundEditFailure('BG_EDIT_RECEIPT') }
}
export async function refreshBackgroundClassification(input: unknown) {
  const request = await target(input)
  let candidate: ReturnType<typeof decodeBackgroundClassificationSnapshot>
  try {
    // 既存の署名付き読取りと両検索decoderを通した業務DTOだけを候補として記録する。
    const inspected = await loadProductEditor({ storeId: request.storeId, productId: request.productId, operationId: randomUUID() })
    enabled()
    candidate = decodeBackgroundClassificationSnapshot({ snapshotId: randomUUID(), storeId: inspected.storeId, productId: inspected.productId,
      janCode: inspected.janCode, capturedAt: inspected.capturedAt, expiresAt: inspected.capturedAt + 900000,
      currentGroupId: inspected.fields.groupId, currentSupplierId: inspected.fields.supplierId, groups: inspected.groups, suppliers: inspected.suppliers }, request)
  } catch (error) {
    if (error instanceof BackgroundEditFailure) throw error
    throw new BackgroundEditFailure('BG_EDIT_RECEIPT')
  }
  enabled()
  const { snapshotId, ...business } = candidate
  const raw = await backgroundEditRpc('record_pos_product_classification_snapshot', { p_actor_id: request.actorId,
    p_store_id: request.storeId, p_product_id: request.productId, p_snapshot_id: snapshotId, p_snapshot_text: JSON.stringify(business) })
  try {
    const saved = decodeBackgroundClassificationSnapshot(raw, request)
    if (JSON.stringify(saved) !== JSON.stringify(candidate)) throw new BackgroundEditFailure('BG_EDIT_RECEIPT')
    return saved
  } catch { throw new BackgroundEditFailure('BG_EDIT_RECEIPT') }
}

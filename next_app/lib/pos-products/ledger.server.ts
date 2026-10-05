import 'server-only'

import type { ProductEditRecoveryTarget } from './editor'

import { createHash } from 'node:crypto'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { InventoryAccessError, requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { parsePosProductCommand, validateProductChoices } from './validation'
import { advanceProductOperation, assertSameProductOperation, productOperationNextStep } from './operations'
import { buildProductEditReview, verifyProductEditResult } from './edit-review.server'
import { buildProductEditDispatch, restoreProductEditDispatch } from './edit-dispatch.server'
import type { ProductEditReview } from './edit-review.server'
import type { ProductEditInspection } from './inspection.server'
import type { ProductOperation, ProductOperationStatus } from './operations'
import type { PosProductChoices } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const RPC_FAILURE = '商品操作の保存結果を確認できません。再送せず、操作状態を確認してください。'

export type ProductEditCatalog = {
  storeId: 6 | 7
  group: { id: string; name: string }
  supplier: { id: string; name: string } | null
}

/** 最新POS情報はサーバー内で取得する。ブラウザからsnapshotを受け付ける公開Actionではない。 */
export async function prepareProductEditOperation(input: unknown, latest: unknown, choices: PosProductChoices, catalog: ProductEditCatalog, now = Date.now()) {
  requireEnabled()
  const review = buildProductEditReview(input, latest, choices, now)
  const label = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('POSの分類・仕入先名称を確認できません。')
    return value
  }
  if (!catalog || catalog.storeId !== review.expectedSnapshot.storeId || catalog.group?.id !== review.expectedSnapshot.fields.groupId ||
      (catalog.supplier?.id ?? null) !== review.expectedSnapshot.fields.supplierId) throw new Error('POSの店舗別選択肢が一致しません。')
  const editCatalog = {
    groupId: catalog.group.id, groupName: label(catalog.group.name),
    supplierId: catalog.supplier?.id ?? null, supplierName: catalog.supplier === null ? null : label(catalog.supplier.name),
    previousPosName: label(record(record(latest).fields).name),
  }
  const operation = await prepareProductOperation(input, {
    posProductId: review.posProductId, expectedResultFingerprint: review.expectedResultFingerprint, choices, editCatalog,
  })
  return { operation, review }
}

/** 送信後に独立して再取得したPOS値だけを検証し、同一操作の台帳へ記録する。 */
export async function recordProductEditVerification(operation: ProductOperation, review: ProductEditReview, actual: unknown, now = Date.now()) {
  requireEnabled()
  if (operation.operationId !== review.operationId || operation.storeId !== review.expectedSnapshot.storeId ||
      operation.expectedResultFingerprint !== review.expectedResultFingerprint) throw new Error(RPC_FAILURE)
  const fingerprint = verifyProductEditResult(review, actual, now)
  return recordProductOperationResult(operation, { type: 'pos_verified', fingerprint })
}
type ResultEvent = { type: 'dispatch_returned' | 'outcome_unknown' | 'reject_before_dispatch' | 'db_failed' }
  | { type: 'pos_verified'; fingerprint: string }
type StatusDto = Pick<ProductOperation, 'operationId' | 'storeId' | 'status' | 'version' | 'sendAttempts'>

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(RPC_FAILURE)
  return value as Record<string, unknown>
}

/** DB応答も検証し、未確認の状態や別操作の結果を成功として返さない。 */
function decodeOperation(value: unknown): ProductOperation {
  const r = record(value)
  if (typeof r.id !== 'string' || typeof r.actor_id !== 'string' || typeof r.payload_hash !== 'string' ||
      typeof r.status !== 'string' || typeof r.row_version !== 'number' ||
      typeof r.expected_result_fingerprint !== 'string' ||
      (r.verified_fingerprint !== null && typeof r.verified_fingerprint !== 'string') ||
      (r.store_id !== 6 && r.store_id !== 7) || (r.send_attempts !== 0 && r.send_attempts !== 1)) throw new Error(RPC_FAILURE)
  const op: ProductOperation = {
    operationId: r.id, actorId: r.actor_id, storeId: r.store_id, payloadHash: r.payload_hash,
    status: r.status as ProductOperationStatus, version: r.row_version, sendAttempts: r.send_attempts,
    expectedResultFingerprint: r.expected_result_fingerprint, verifiedFingerprint: r.verified_fingerprint,
  }
  productOperationNextStep(op)
  return op
}

async function authorize(storeId: number) {
  if (storeId !== 6 && storeId !== 7) throw new Error('対象店舗を一つ選択してください。')
  const client = await createClient()
  // 既存のDB店舗manager判定を再利用する。user_metadataや表示店舗Cookieは信用しない。
  try {
    const user = await requireInventoryManagerAccess(client, storeId)
    return { client, user }
  } catch (error) {
    if (error instanceof InventoryAccessError) throw error
    throw new Error('店舗権限を確認できません。時間をおいて状態を確認してください。')
  }
}

function requireEnabled() {
  if (process.env.POS_PRODUCT_WRITES_ENABLED !== 'true') throw new Error('POS商品保存はまだ有効になっていません。')
}

function requireCancellationEnabled() {
  requireEnabled()
  if (process.env.POS_PRODUCT_EDITOR_ENABLED !== 'true' || process.env.POS_PRODUCT_EDIT_EXECUTION_ENABLED !== 'true') throw new Error(RPC_FAILURE)
}

async function editRecoveryRpc(target: ProductEditRecoveryTarget, cancel: boolean) {
  if ((target.storeId !== 6 && target.storeId !== 7) || !UUID.test(target.operationId) ||
      !Number.isSafeInteger(target.productId) || target.productId <= 0 || target.productId > 2147483647) throw new Error(RPC_FAILURE)
  if (cancel) requireCancellationEnabled()
  const { user } = await authorize(target.storeId)
  if (cancel) requireCancellationEnabled()
  const result = record(await rpc(cancel ? 'cancel_pos_product_edit' : 'get_pos_product_edit_recovery_state', {
    p_actor_id: user.id, p_store_id: target.storeId, p_product_id: target.productId, p_operation_id: target.operationId,
  }))
  if (Object.keys(result).length !== 2 || !Object.hasOwn(result, 'operation') || !Object.hasOwn(result, 'cancellation')) throw new Error(RPC_FAILURE)
  const op = result.operation === null ? null : decodeOperation(result.operation)
  if (op) {
    const raw = record(result.operation)
    if (op.actorId !== user.id || op.storeId !== target.storeId || op.operationId !== target.operationId ||
        raw.kind !== 'update' || raw.product_id_snapshot !== target.productId) throw new Error(RPC_FAILURE)
  }
  let cancelled = false
  if (result.cancellation !== null) {
    const marker = record(result.cancellation)
    if (Object.keys(marker).length !== 6 || marker.operation_id !== target.operationId || marker.actor_id !== user.id ||
        marker.store_id !== target.storeId || marker.product_id_snapshot !== target.productId ||
        marker.reason !== (op ? 'cancel_prepared' : 'cancel_before_preparation') ||
        typeof marker.cancelled_at !== 'string' || !Number.isFinite(Date.parse(marker.cancelled_at)) ||
        (op && (op.status !== 'rejected' || op.sendAttempts !== 0))) throw new Error(RPC_FAILURE)
    cancelled = true
  }
  if (cancel && !cancelled) throw new Error(RPC_FAILURE)
  return { operation: op, cancelled }
}

/** 読取りだけ。未作成と取消済みを区別し、対象/本人はDBでも照合する。 */
export function loadProductEditRecoveryState(target: ProductEditRecoveryTarget) { return editRecoveryRpc(target, false) }
/** 同IDの遅延prepareも拒否する原子的な未送信取消。 */
export function cancelProductEditOperation(target: ProductEditRecoveryTarget) { return editRecoveryRpc(target, true) }

/** 特権鍵はここだけで使う。失敗時に再試行せず、DBの原子的claimの結果を確認する。 */
async function rpc(name: string, args: Record<string, string | number | null>): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('POS商品保存のサーバー設定が未完了です。')
  try {
    const service = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data, error } = await service.rpc(name, args)
    if (error) throw new Error(RPC_FAILURE)
    return data
  } catch {
    // DB本文・内部ID・資格情報を含む可能性があるため、例外本文やcauseは外へ渡さない。
    throw new Error(RPC_FAILURE)
  }
}

function assertBound(op: ProductOperation, expected: ProductOperation) {
  assertSameProductOperation(op, expected)
  if (op.expectedResultFingerprint !== expected.expectedResultFingerprint) throw new Error(RPC_FAILURE)
}

function assertVersion(op: ProductOperation, expected: ProductOperation) {
  assertBound(op, expected)
  if (op.status !== expected.status || op.version !== expected.version || op.sendAttempts !== expected.sendAttempts ||
      op.verifiedFingerprint !== expected.verifiedFingerprint) throw new Error(RPC_FAILURE)
}

async function authorizeOperation(op: ProductOperation) {
  requireEnabled()
  productOperationNextStep(op)
  const { user } = await authorize(op.storeId)
  // 認可の通信待機中に保存が停止された場合も、次の書込みへ進めない。
  requireEnabled()
  if (op.actorId !== user.id) throw new Error('この商品操作を実行する権限がありません。')
  return {
    p_actor_id: user.id, p_store_id: op.storeId, p_operation_id: op.operationId,
    p_payload_hash: op.payloadHash, p_expected_version: op.version,
  }
}

/** reviewはPOS再取得を検証したサーバー内部の値に限る。クライアント入力を直結しない。 */
export async function prepareProductOperation(input: unknown, review: {
  posProductId: string | null; expectedResultFingerprint: string; choices: PosProductChoices
  editCatalog?: { groupId: string; groupName: string; supplierId: string | null; supplierName: string | null; previousPosName: string }
}): Promise<ProductOperation> {
  requireEnabled()
  const command = parsePosProductCommand(input)
  if (command.kind !== 'create' && command.kind !== 'update') throw new Error('JAN訂正・削除の保存経路はまだ有効になっていません。')
  validateProductChoices(command, review.choices)
  if (!HASH.test(review.expectedResultFingerprint) || (command.kind === 'create' ? review.posProductId !== null :
    typeof review.posProductId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(review.posProductId))) throw new Error('POSの商品照合が必要です。')
  const { user } = await authorize(command.storeId)
  // 認可待機中の停止も、受付RPCの副作用が発生する前に検査する。
  requireEnabled()
  const commandText = JSON.stringify(command)
  const expected: ProductOperation = {
    operationId: command.operationId, actorId: user.id, storeId: command.storeId,
    payloadHash: createHash('sha256').update(commandText, 'utf8').digest('hex'),
    expectedResultFingerprint: review.expectedResultFingerprint, verifiedFingerprint: null,
    status: 'prepared', version: 0, sendAttempts: 0,
  }
  const op = decodeOperation(await rpc(review.editCatalog ? 'prepare_pos_product_edit' : 'prepare_pos_product_operation', {
    p_actor_id: user.id, p_command_text: commandText, p_pos_product_id: review.posProductId,
    p_expected_result_fingerprint: review.expectedResultFingerprint,
    ...(review.editCatalog ? { p_catalog_text: JSON.stringify(review.editCatalog) } : {}),
  }))
  // 再受付は既存の保存済み状態をそのまま返し、preparedへ戻さない。
  assertBound(op, expected)
  return op
}

export async function claimProductOperation(op: ProductOperation): Promise<{ claimed: boolean; operation: ProductOperation }> {
  const args = await authorizeOperation(op)
  const result = record(await rpc('claim_pos_product_operation', args))
  if (typeof result.claimed !== 'boolean') throw new Error(RPC_FAILURE)
  const stored = decodeOperation(result.operation)
  assertBound(stored, op)
  if (result.claimed) {
    assertVersion(stored, advanceProductOperation(op, { type: 'claim_dispatch', expectedVersion: op.version }))
  } else if (stored.status === 'prepared' || stored.version < op.version) throw new Error(RPC_FAILURE)
  return { claimed: result.claimed, operation: stored }
}

export async function recordProductOperationResult(op: ProductOperation, event: ResultEvent): Promise<ProductOperation> {
  const args = await authorizeOperation(op)
  // DB完了は将来の商品反映transaction専用。汎用のイベントでは受け付けない。
  if (!['dispatch_returned', 'outcome_unknown', 'reject_before_dispatch', 'db_failed', 'pos_verified'].includes(event.type)) {
    throw new Error('対応していない商品操作の結果です。')
  }
  const expected = advanceProductOperation(op, { ...event, expectedVersion: op.version })
  const stored = decodeOperation(await rpc('record_pos_product_operation_result', {
    ...args, p_event: event.type, p_verified_fingerprint: event.type === 'pos_verified' ? event.fingerprint : null,
  }))
  assertVersion(stored, expected)
  return stored
}

export async function getProductOperationStatus(storeId: number, operationId: string): Promise<StatusDto | null> {
  if (typeof operationId !== 'string' || !UUID.test(operationId)) throw new Error('操作IDが正しくありません。')
  const { client, user } = await authorize(storeId)
  // 新規テーブルは既存の手書きDatabase型にまだ含めず、限定した読取り契約だけを使う。
  const ledger = client as unknown as {
    from(name: 'pos_product_operations'): {
      select(columns: string): {
        eq(column: string, value: string | number): ReturnType<ReturnType<typeof ledger.from>['select']>
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>
      }
    }
  }
  let response: { data: unknown; error: unknown }
  try {
    response = await ledger.from('pos_product_operations')
      .select('id,actor_id,store_id,status,row_version,send_attempts,payload_hash,expected_result_fingerprint,verified_fingerprint')
      .eq('actor_id', user.id).eq('store_id', storeId).eq('id', operationId).maybeSingle()
  } catch {
    throw new Error(RPC_FAILURE)
  }
  const { data, error } = response
  if (error) throw new Error(RPC_FAILURE)
  if (!data) return null
  const op = decodeOperation(data)
  if (op.actorId !== user.id || op.storeId !== storeId || op.operationId !== operationId) throw new Error(RPC_FAILURE)
  return { operationId: op.operationId, storeId: op.storeId, status: op.status, version: op.version, sendAttempts: op.sendAttempts }
}

/** server内の受付後/claim前だけで使う。登録は送信許可・消費・POS保存ではない。 */
export async function registerProductEditDispatch(operation: ProductOperation, input: unknown, inspection: ProductEditInspection, now = Date.now()) {
  if (process.env.POS_PRODUCT_DISPATCH_ENABLED !== 'true') throw new Error('POS商品実行記録はまだ有効になっていません。')
  // 認可await中の呼出元変更で、認可店舗とRPC対象が分離しないよう固定する。
  const boundOperation = { ...operation }
  const dispatch = buildProductEditDispatch(boundOperation, input, inspection, now)
  const args = await authorizeOperation(boundOperation)
  requireEnabled()
  if (process.env.POS_PRODUCT_DISPATCH_ENABLED !== 'true') throw new Error('POS商品実行記録はまだ有効になっていません。')
  const response = record(await rpc('register_pos_product_edit_dispatch', {
    ...args, p_dispatch_text: dispatch.dispatchText, p_before_fingerprint_text: dispatch.beforeFingerprintText,
    p_expected_fingerprint_text: dispatch.expectedFingerprintText, p_reviewed_at: dispatch.reviewedAt,
  }))
  if (Object.keys(response).length !== 2 || !Object.hasOwn(response, 'operation') || !Object.hasOwn(response, 'dispatch')) throw new Error(RPC_FAILURE)
  const restored = restoreProductEditDispatch(response.operation, response.dispatch, null, now)
  assertVersion(restored.operation, boundOperation)
  if (!restored.dispatch || restored.dispatch.dispatchHash !== dispatch.dispatchHash || restored.dispatch.dispatchText !== dispatch.dispatchText) throw new Error(RPC_FAILURE)
  return { operation: restored.operation, dispatch: restored.dispatch }
}

/** private復旧用。書込みOFFでも本人の店舗managerを再認可する。公開Actionの返却に直結しない。 */
export async function loadProductEditDispatchRecovery(storeId: number, operationId: string, now = Date.now()) {
  if (typeof operationId !== 'string' || !UUID.test(operationId)) throw new Error('操作IDが正しくありません。')
  const { user } = await authorize(storeId)
  const response = record(await rpc('get_pos_product_edit_dispatch', { p_actor_id: user.id, p_store_id: storeId, p_operation_id: operationId }))
  if (Object.keys(response).length !== 3 || ['operation', 'dispatch', 'receipt'].some(k => !Object.hasOwn(response, k))) throw new Error(RPC_FAILURE)
  const restored = restoreProductEditDispatch(response.operation, response.dispatch, response.receipt, now)
  if (restored.operation.actorId !== user.id || restored.operation.storeId !== storeId || restored.operation.operationId !== operationId) throw new Error(RPC_FAILURE)
  return restored
}

/** POS確認済み操作のDB反映だけを行う。商品値は再送せず、受付時にDBへ固定した値を使う。 */
export async function applyProductEditToDatabase(op: ProductOperation): Promise<ProductOperation> {
  const args = await authorizeOperation(op)
  if (!['pos_confirmed', 'db_pending', 'completed'].includes(op.status)) throw new Error('POSの保存確認が完了していません。')
  const expected = op.status === 'completed' ? op : advanceProductOperation(op, { type: 'db_completed', expectedVersion: op.version })
  const stored = decodeOperation(await rpc('apply_pos_product_edit', args))
  assertVersion(stored, expected)
  return stored
}

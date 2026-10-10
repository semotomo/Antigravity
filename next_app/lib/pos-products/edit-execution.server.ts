import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { loadProductEditDispatchRecovery, claimProductOperation, recordProductOperationResult,
  recordProductEditVerification, applyProductEditToDatabase, loadProductEditRecoveryState, cancelProductEditOperation,
  resolveProductEditNotSent } from './ledger.server'
import { assertSameProductOperation, productOperationNextStep } from './operations'
import { fingerprintProductEditSnapshot, serializeProductEditSnapshotFingerprint, verifyProductEditResult } from './edit-review.server'
import { decodeProductEditInspection } from './inspection.server'
import { configuredPosProductDispatcher } from './dispatch-transport.server'
import { configuredPosProductInspector } from './inspection-transport.server'
import type { ProductEditExecutionData, ProductEditRecoveryData, ProductEditRecoveryTarget } from './editor'
import type { ProductOperation } from './operations'
import type { ProductEditSnapshot } from './edit-review.server'
import type { PosProductDispatcher, ProductEditDispatchObservation } from './dispatch-transport.server'
import type { PosProductInspector } from './edit-preparation.server'

type Target = { storeId: 6 | 7; operationId: string }
type Recovery = Awaited<ReturnType<typeof loadProductEditDispatchRecovery>>
type Ports = { dispatcher?: PosProductDispatcher; inspector?: PosProductInspector }
const FAILURE = '商品操作の保存結果を確認できません。再送せず、操作状態を確認してください。'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function reject(): never { throw new Error(FAILURE) }
function target(raw: unknown): Target {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject()
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'storeId') || !Object.hasOwn(value, 'operationId') ||
      (value.storeId !== 6 && value.storeId !== 7) || typeof value.operationId !== 'string' || !UUID.test(value.operationId)) reject()
  return { storeId: value.storeId, operationId: value.operationId }
}
function recoveryTarget(raw: unknown): ProductEditRecoveryTarget {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject()
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length !== 3 || !Object.hasOwn(value, 'productId') ||
      !Number.isSafeInteger(value.productId) || (value.productId as number) <= 0 || (value.productId as number) > 2147483647) reject()
  return { ...target({ storeId: value.storeId, operationId: value.operationId }), productId: value.productId as number }
}
function mutationEnabled(): boolean {
  return process.env.POS_PRODUCT_EDITOR_ENABLED === 'true' && process.env.POS_PRODUCT_WRITES_ENABLED === 'true' &&
    process.env.POS_PRODUCT_EDIT_EXECUTION_ENABLED === 'true'
}
function sendEnabled(): boolean {
  return mutationEnabled() && process.env.POS_PRODUCT_DISPATCH_ENABLED === 'true' &&
    process.env.POS_PRODUCT_EDIT_GATEWAY_ENABLED === 'true' && process.env.POS_PRODUCT_CONSUME_ENABLED === 'true'
}
function requireMutation() { if (!mutationEnabled()) reject() }

function recoveryDto(request: ProductEditRecoveryTarget, saved: Awaited<ReturnType<typeof loadProductEditRecoveryState>>): ProductEditRecoveryData {
  const op = saved.operation
  if (op && (op.operationId !== request.operationId || op.storeId !== request.storeId)) reject()
  const state = saved.cancelled ? 'cancelled' : !op ? 'not_created' :
    op.status === 'prepared' ? 'prepared' : op.status === 'completed' ? 'completed' : op.status === 'rejected' ? 'rejected' :
      op.status === 'not_sent' ? 'not_sent' : 'in_progress'
  const releaseAllowed = saved.cancelled || (op?.status === 'completed' && op.sendAttempts === 1) ||
    (op?.status === 'rejected' && op.sendAttempts === 0) || (op?.status === 'not_sent' && op.sendAttempts === 1)
  const messages = {
    not_created: '操作の作成は確認できません。遅延した準備を防ぐ取消が完了するまで、新しい操作は開始できません。',
    prepared: 'POS未送信の準備済み操作です。期限切れ・基準値競合でも、この操作を取り消して再読込できます。',
    in_progress: '送信開始後の操作は取り消せません。入力と操作IDを保持して、同じ操作の結果確認・DB復旧を続けてください。',
    completed: 'POS・DB反映完了を確認しました。閉じる操作でこの対象の復旧情報を解除できます。',
    rejected: '未送信の終了と予約解放を確認しました。閉じる操作でこの対象の復旧情報を解除できます。',
    cancelled: '未送信取消と予約解放を確認しました。同じ操作IDの遅延準備も拒否されます。閉じてから再読込できます。',
    not_sent: 'POSへ保存しなかったことと予約解放を確認しました。入力は保持しています。閉じて再読込してください。',
  }
  return { ...request, state, canCancel: mutationEnabled() && !releaseAllowed && (!op || (op.status === 'prepared' && op.sendAttempts === 0)),
    releaseAllowed, message: messages[state] }
}

/** POS通信なしの救済読取り。破損storageからも対象3項目で本人/商品を再照合する。 */
export async function inspectProductEditRecovery(input: unknown): Promise<ProductEditRecoveryData> {
  try { const request = recoveryTarget(input); return recoveryDto(request, await loadProductEditRecoveryState(request)) }
  catch { reject() }
}

export async function cancelPreparedProductEdit(input: unknown): Promise<ProductEditRecoveryData> {
  try {
    const request = recoveryTarget(input)
    requireMutation()
    const saved = await cancelProductEditOperation(request)
    return recoveryDto(request, saved)
  } catch { reject() }
}
function sameOperation(operation: ProductOperation, previous: ProductOperation) {
  productOperationNextStep(operation)
  assertSameProductOperation(operation, previous)
  if (operation.expectedResultFingerprint !== previous.expectedResultFingerprint || operation.version < previous.version ||
      operation.sendAttempts < previous.sendAttempts) reject()
}
function bindRecovery(request: Target, value: Recovery, previous?: Recovery): Recovery {
  // await中の呼出し側変更で、固定記録・認可対象・送信本文を差し替えない。
  const saved = structuredClone(value), operation = saved.operation, dispatch = saved.dispatch
  productOperationNextStep(operation)
  if (operation.storeId !== request.storeId || operation.operationId !== request.operationId) reject()
  if (previous) {
    sameOperation(operation, previous.operation)
    if (previous.dispatch && (!dispatch || dispatch.dispatchText !== previous.dispatch.dispatchText ||
        dispatch.dispatchHash !== previous.dispatch.dispatchHash || dispatch.beforeFingerprintText !== previous.dispatch.beforeFingerprintText ||
        dispatch.expectedFingerprintText !== previous.dispatch.expectedFingerprintText || dispatch.reviewedAt !== previous.dispatch.reviewedAt)) reject()
  }
  if (dispatch) {
    const command = dispatch.command, review = dispatch.review, expected = review.expectedSnapshot
    if (command.operationId !== operation.operationId || command.actorId !== operation.actorId || command.storeId !== operation.storeId ||
        command.janCode !== expected.janCode || review.operationId !== operation.operationId || expected.storeId !== operation.storeId ||
        review.reviewedAt !== dispatch.reviewedAt || review.posProductId !== expected.identity.posProductId ||
        review.expectedResultFingerprint !== operation.expectedResultFingerprint ||
        fingerprintProductEditSnapshot(expected, dispatch.reviewedAt) !== operation.expectedResultFingerprint ||
        serializeProductEditSnapshotFingerprint(expected, dispatch.reviewedAt) !== dispatch.expectedFingerprintText) reject()
  }
  if (saved.receiptConsumedAt !== null && (!dispatch || operation.sendAttempts !== 1 || !Number.isSafeInteger(saved.receiptConsumedAt) ||
      saved.receiptConsumedAt < dispatch.reviewedAt || saved.receiptConsumedAt >= dispatch.command.expiresAt || operation.status === 'not_sent')) reject()
  return saved
}
async function reload(request: Target, previous?: Recovery): Promise<Recovery> {
  return bindRecovery(request, await loadProductEditDispatchRecovery(request.storeId, request.operationId), previous)
}
function withOperation(saved: Recovery, operation: ProductOperation): Recovery {
  sameOperation(operation, saved.operation)
  return { ...saved, operation: { ...operation } }
}

async function authorizeTarget(saved: Recovery) {
  const client = await createClient(), user = await requireInventoryManagerAccess(client, saved.operation.storeId)
  if (user.id !== saved.operation.actorId) reject()
  const expected = saved.dispatch?.review.expectedSnapshot
  if (!expected) reject()
  const { data, error } = await client.from('products').select('id,store_id,jan_code')
    .eq('store_id', saved.operation.storeId).eq('id', expected.productId).maybeSingle()
  const product = data as unknown as { id: unknown; store_id: unknown; jan_code: unknown } | null
  if (error || !product || product.id !== expected.productId || product.store_id !== saved.operation.storeId ||
      product.jan_code !== expected.janCode) reject()
}
function dto(saved: Recovery, verified: boolean | null = null): ProductEditExecutionData {
  const operation = saved.operation, status = operation.status
  const stage = status === 'verifying' || status === 'uncertain' ? 'verification_required' : status
  let nextAction: ProductEditExecutionData['nextAction'] = 'none'
  if (mutationEnabled() && saved.dispatch) {
    if (status === 'prepared' && sendEnabled() && saved.dispatch.command.expiresAt > Date.now()) nextAction = 'save'
    else if (['dispatching', 'verifying', 'uncertain'].includes(status) && saved.receiptConsumedAt !== null) nextAction = 'verify'
    else if (['pos_confirmed', 'db_pending'].includes(status) && verified !== false) nextAction = 'apply_db'
  }
  const messages = {
    prepared: '保存内容を固定しました。保存はまだ開始していません。',
    dispatching: '保存処理の結果を確認中です。再送せず、状態を確認してください。',
    verification_required: verified === true ? 'POSの値は一致しています。操作状態を確認してから確定してください。' :
      verified === false ? 'POSの値が保存予定と一致しません。再送せず内容を確認してください。' : '保存結果を確認できません。再送せずPOSの値を確認してください。',
    pos_confirmed: 'POSの保存値を確認しました。DB反映を再開できます。',
    db_pending: 'POSの保存値を確認済みです。DB反映だけを再開してください。',
    completed: 'POSとDBへの反映が完了しました。', rejected: '保存前に操作が中止されました。',
    // 旧1操作の保守監査による終端も読めるため、全not_sentをGAS署名付きと表示しない。
    not_sent: 'POSへの保存前に停止したことを確認済みです。変更は未保存です。入力を保持し、予約を安全に解除しました。閉じて再読込してください。',
  }
  return { storeId: operation.storeId, operationId: operation.operationId, status, version: operation.version,
    sendAttempts: operation.sendAttempts, stage, nextAction, posValuesVerified: status === 'completed' ? true : verified,
    expiresAt: saved.dispatch?.command.expiresAt ?? null, message: messages[stage] }
}

async function readActual(saved: Recovery, inspector?: PosProductInspector): Promise<{ verified: boolean | null; snapshot: ProductEditSnapshot | null }> {
  await authorizeTarget(saved)
  const dispatch = saved.dispatch
  if (!dispatch) reject()
  let raw: unknown
  try {
    const reader = inspector ?? configuredPosProductInspector()
    raw = await reader.inspect({ storeId: saved.operation.storeId, operationId: saved.operation.operationId,
      actorId: saved.operation.actorId, janCode: dispatch.command.janCode })
  } catch { return { verified: null, snapshot: null } }
  await authorizeTarget(saved)
  let snapshot: ProductEditSnapshot
  try {
    const expected = dispatch.review.expectedSnapshot
    snapshot = decodeProductEditInspection({ storeId: saved.operation.storeId, productId: expected.productId, janCode: expected.janCode }, raw).snapshot
    verifyProductEditResult(dispatch.review, snapshot)
    return { verified: true, snapshot }
  } catch { return { verified: false, snapshot: null } }
}

/** 送信不明の復旧は読取りだけ。値一致や期限経過を、保存完了や予約解除の証明として扱わない。 */
export async function loadProductEditExecution(input: unknown, inspector?: PosProductInspector): Promise<ProductEditExecutionData> {
  try {
    const request = target(input), saved = await reload(request)
    if (!saved.dispatch || ['prepared', 'completed', 'rejected', 'not_sent'].includes(saved.operation.status)) return dto(saved)
    const actual = await readActual(saved, inspector)
    return dto(saved, actual.verified)
  } catch { reject() }
}

async function verifyAndApply(request: Target, initial: Recovery, inspector: PosProductInspector): Promise<ProductEditExecutionData> {
  let saved = initial
  const actual = await readActual(saved, inspector)
  if (actual.verified !== true || !actual.snapshot) return dto(saved, actual.verified)
  // GASの実行権が確認できない操作は、偶然の値一致でもPOS確認済みへ進めない。
  if (saved.receiptConsumedAt === null) return dto(saved, true)
  requireMutation()
  await authorizeTarget(saved)
  requireMutation()
  if (saved.operation.status === 'dispatching') {
    try { saved = withOperation(saved, await recordProductOperationResult(saved.operation, { type: 'outcome_unknown' })) }
    catch { return dto(await reload(request, saved), true) }
  }
  if (saved.operation.status === 'verifying' || saved.operation.status === 'uncertain') {
    try { saved = withOperation(saved, await recordProductEditVerification(saved.operation, saved.dispatch!.review, actual.snapshot)) }
    catch { return dto(await reload(request, saved), true) }
  }
  if (saved.operation.status === 'completed') return dto(saved, true)
  if (!['pos_confirmed', 'db_pending'].includes(saved.operation.status)) return dto(saved, true)
  await authorizeTarget(saved)
  requireMutation()
  try { return dto(withOperation(saved, await applyProductEditToDatabase(saved.operation)), true) }
  catch {
    // DB応答消失なら保存済み結果を読む。POSやDB更新をこの呼出しで再送しない。
    saved = await reload(request, saved)
    if (saved.operation.status === 'completed') return dto(saved, true)
    if (mutationEnabled() && ['pos_confirmed', 'db_pending'].includes(saved.operation.status)) {
      await authorizeTarget(saved)
      requireMutation()
      try { saved = withOperation(saved, await recordProductOperationResult(saved.operation, { type: 'db_failed' })) }
      catch { saved = await reload(request, saved) }
    }
    return dto(saved, true)
  }
}

/** 固定済み操作だけを実行。既送信状態への明示的な再呼出しは照合/DB反映に限り、保存POSTを再送しない。 */
export async function executePreparedProductEdit(input: unknown, ports: Ports = {}): Promise<ProductEditExecutionData> {
  try {
    const request = target(input)
    let saved = await reload(request)
    if (['completed', 'rejected', 'not_sent'].includes(saved.operation.status)) return dto(saved)
    requireMutation()
    if (!saved.dispatch) reject()
    const dispatch = saved.dispatch
    await authorizeTarget(saved)
    requireMutation()
    const inspector = ports.inspector ?? configuredPosProductInspector()
    if (saved.operation.status !== 'prepared') return await verifyAndApply(request, saved, inspector)
    if (!sendEnabled() || dispatch.command.expiresAt <= Date.now()) reject()
    const dispatcher = ports.dispatcher ?? configuredPosProductDispatcher()
    let claim: Awaited<ReturnType<typeof claimProductOperation>>
    try { claim = await claimProductOperation(saved.operation) }
    catch { return dto(await reload(request, saved)) }
    saved = withOperation(saved, claim.operation)
    if (!claim.claimed) return dto(await reload(request, saved))
    // claim中に認可/対象/運用フラグが変わっても、保存を開始しない。
    await authorizeTarget(saved)
    if (!sendEnabled()) reject()
    let observed: ProductEditDispatchObservation | null = null
    try { observed = await dispatcher.dispatch(dispatch) }
    catch { /* 保存結果不明。固定操作をuncertainへ進め、自動照合や再送をしない。 */ }
    requireMutation()
    if (observed?.outcome === 'not_sent' && observed.proofText !== undefined) {
      await authorizeTarget(saved)
      requireMutation()
      try {
        saved = withOperation(saved, await resolveProductEditNotSent(saved.operation, dispatch, observed.proofText))
        return dto(await reload(request, saved))
      } catch {
        // receiptとの競合/証拠拒否/応答消失では、旧IDを維持し保存・解除を再試行しない。
        const latest = await reload(request, saved)
        if (latest.operation.status === 'not_sent') return dto(latest)
      }
    }
    const valuesObserved = observed?.outcome === 'values_verified'
    try { saved = withOperation(saved, await recordProductOperationResult(saved.operation,
      { type: valuesObserved ? 'dispatch_returned' : 'outcome_unknown' })) }
    catch { return dto(await reload(request, saved)) }
    saved = await reload(request, saved)
    if (!valuesObserved) return dto(saved)
    return await verifyAndApply(request, saved, inspector)
  } catch { reject() }
}

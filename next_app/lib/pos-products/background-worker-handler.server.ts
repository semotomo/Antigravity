import 'server-only'
import { createHash } from 'node:crypto'
import { backgroundEditEnabled, backgroundEditRpc } from './background-edit.server'
import { backgroundEditRecord, backgroundEditUuid, decodeProductEditIntakeData } from './background-edit'
import { readBackgroundJson } from './background-http.server'
import { signBackgroundWorkerResponse, verifyBackgroundWorkerRequest } from './background-worker-protocol.server'
import type { BackgroundWorkerRequest } from './background-worker-protocol.server'
import { decodeProductEditInspection } from './inspection.server'
import { buildProductEditReview, verifyProductEditResult } from './edit-review.server'
import { buildProductEditDispatch, restoreProductEditDispatch } from './edit-dispatch.server'
import { parsePosProductCommand } from './validation'
import { productOperationNextStep } from './operations'
import type { ProductOperation } from './operations'

const FAILURE = 'POS_PRODUCT_BACKGROUND_UNAVAILABLE'
type Job = ReturnType<typeof readJob>
function reject(): never { throw new Error(FAILURE) }
function exact(value: unknown, keys: string[]) {
  const row = backgroundEditRecord(value)
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) reject()
  return row
}
function enabled() { return backgroundEditEnabled() && process.env.POS_PRODUCT_CONSUME_ENABLED === 'true' }
function readJob(raw: unknown, storeId: 6 | 7, operationId?: string, leaseToken?: string) {
  const row = backgroundEditRecord(raw), dto = decodeProductEditIntakeData(row)
  if (dto.storeId !== storeId || (operationId && dto.operationId !== operationId) ||
      (leaseToken && row.lease_token !== leaseToken)) reject()
  const choiceBaseline = classificationEvidence(row, backgroundEditRecord(dto.patch))
  return { dto, row, actorId: backgroundEditUuid(row.actor_id), leaseToken: backgroundEditUuid(row.lease_token),
    baseline: backgroundEditRecord(row.baseline), choiceBaseline, target: { storeId: dto.storeId, productId: dto.productId, janCode: dto.janCode } }
}

/** DBが固定した選択証拠だけを使用する。表示用DB仕入先名からPOS IDを補完しない。 */
function classificationChoice(value: unknown) {
  const choice = exact(value, ['id', 'name'])
  if (typeof choice.id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(choice.id) ||
      typeof choice.name !== 'string' || !choice.name || choice.name.length > 1000 || choice.name.trim() !== choice.name || /[\x00-\x1f\x7f]/.test(choice.name)) reject()
  return { id: choice.id as string, name: choice.name as string }
}
function classificationEvidence(row: Record<string, unknown>, patch: Record<string, unknown>) {
  const keys = ['groupId', 'supplierId'].filter(key => Object.hasOwn(patch, key))
  if (!keys.length) {
    if (row.catalog_snapshot_id != null || row.pos_choice_baseline != null) reject()
    return null
  }
  backgroundEditUuid(row.catalog_snapshot_id)
  const baseline = exact(row.pos_choice_baseline, ['groupId', 'groupName', 'supplierId', 'supplierName', 'requested'])
  classificationChoice({ id: baseline.groupId, name: baseline.groupName })
  if (baseline.supplierId === null) { if (baseline.supplierName !== null) reject() }
  else classificationChoice({ id: baseline.supplierId, name: baseline.supplierName })
  const requested = exact(baseline.requested, keys)
  for (const key of keys) {
    if (key === 'supplierId' && patch[key] === null) { if (requested[key] !== null) reject() }
    else if (classificationChoice(requested[key]).id !== patch[key]) reject()
  }
  return baseline
}
function verifyClassification(job: Job, inspection: ReturnType<typeof decodeProductEditInspection>) {
  const evidence = job.choiceBaseline
  if (!evidence) return
  const requested = backgroundEditRecord(evidence.requested)
  const catalogs = { groupId: inspection.groups, supplierId: inspection.suppliers }
  for (const catalog of Object.values(catalogs)) {
    if (catalog.length > 5000) reject()
    const ids = new Set<string>(), names = new Set<string>()
    for (const raw of catalog) {
      const choice = classificationChoice(raw)
      if (ids.has(choice.id) || names.has(choice.name)) reject()
      ids.add(choice.id); names.add(choice.name)
    }
  }
  for (const key of ['groupId', 'supplierId'] as const) {
    if (!Object.hasOwn(job.dto.patch, key)) continue
    if (inspection.snapshot.fields[key] !== evidence[key]) reject()
    const catalog = catalogs[key], nameKey = key === 'groupId' ? 'groupName' : 'supplierName'
    if (evidence[key] !== null && catalog.find(choice => choice.id === evidence[key])?.name !== evidence[nameKey]) reject()
    if (requested[key] !== null) {
      const choice = classificationChoice(requested[key])
      if (catalog.find(current => current.id === choice.id)?.name !== choice.name) reject()
    }
  }
}
function readOperation(raw: unknown, job: Job): ProductOperation {
  const row = backgroundEditRecord(raw)
  const operation = { operationId: row.id, actorId: row.actor_id, storeId: row.store_id, payloadHash: row.payload_hash,
    status: row.status, version: row.row_version, sendAttempts: row.send_attempts,
    expectedResultFingerprint: row.expected_result_fingerprint, verifiedFingerprint: row.verified_fingerprint } as ProductOperation
  productOperationNextStep(operation)
  if (operation.operationId !== job.dto.operationId || operation.actorId !== job.actorId || operation.storeId !== job.dto.storeId ||
      row.product_id_snapshot !== job.dto.productId || row.jan_code !== job.dto.janCode) reject()
  return operation
}
function operationArgs(operation: ProductOperation) {
  return { p_actor_id: operation.actorId, p_store_id: operation.storeId, p_operation_id: operation.operationId,
    p_payload_hash: operation.payloadHash, p_expected_version: operation.version }
}
async function finish(job: Job, code: string | null, assertCurrent: () => void) {
  assertCurrent()
  const row = await backgroundEditRpc('finish_pos_product_edit_intake', {
    p_operation_id: job.dto.operationId, p_lease_token: job.leaseToken, p_code: code,
  })
  assertCurrent()
  const dto = decodeProductEditIntakeData(row)
  if (dto.operationId !== job.dto.operationId || dto.storeId !== job.dto.storeId || dto.productId !== job.dto.productId) reject()
  return { operationId: dto.operationId, storeId: dto.storeId, status: dto.status }
}
async function lease(request: BackgroundWorkerRequest) {
  const operationId = backgroundEditUuid(request.payload.operationId), leaseToken = backgroundEditUuid(request.payload.leaseToken)
  const saved = exact(await backgroundEditRpc('get_pos_product_edit_intake_lease', {
    p_operation_id: operationId, p_store_id: request.storeId, p_lease_token: leaseToken,
  }), ['intake', 'operation', 'dispatch', 'receipt'])
  const job = readJob(saved.intake, request.storeId, operationId, leaseToken)
  return { job, saved }
}
async function recordResult(job: Job, operation: ProductOperation, event: string, fingerprint: string | null, assertCurrent: () => void) {
  assertCurrent()
  const next = readOperation(await backgroundEditRpc('record_pos_product_operation_result', {
    ...operationArgs(operation), p_event: event, p_verified_fingerprint: fingerprint,
  }), job)
  assertCurrent()
  if (next.version !== operation.version + 1 || next.payloadHash !== operation.payloadHash ||
      next.expectedResultFingerprint !== operation.expectedResultFingerprint || next.sendAttempts !== operation.sendAttempts) reject()
  return next
}
async function applyResult(job: Job, operation: ProductOperation, assertCurrent: () => void) {
  assertCurrent()
  const next = readOperation(await backgroundEditRpc('apply_pos_product_edit', operationArgs(operation)), job)
  assertCurrent()
  if (next.status !== 'completed' || next.payloadHash !== operation.payloadHash ||
      next.expectedResultFingerprint !== operation.expectedResultFingerprint || next.sendAttempts !== 1) reject()
  return next
}

/** 短い署名付きDB工程だけ。長いPOS通信はGAS workerへ分離する。 */
async function execute(request: BackgroundWorkerRequest, clock: () => number, assertCurrent: () => void): Promise<Record<string, unknown>> {
  assertCurrent()
  if (request.action === 'claim') {
    const capable = Object.hasOwn(request.payload, 'classificationCapable')
    const payload = exact(request.payload, capable ? ['workerId', 'classificationCapable'] : ['workerId'])
    if (capable && payload.classificationCapable !== true) reject()
    const claimed = exact(await backgroundEditRpc('claim_pos_product_edit_intake', {
      p_store_id: request.storeId, p_worker_id: backgroundEditUuid(payload.workerId),
    }), ['claimed', 'intake', 'operation'])
    assertCurrent()
    if (typeof claimed.claimed !== 'boolean') reject()
    if (!claimed.claimed) return { claimed: false, intake: null, operation: null }
    const job = readJob(claimed.intake, request.storeId)
    if (job.dto.status !== 'working') reject()
    const operation = claimed.operation === null ? null : readOperation(claimed.operation, job)
    if (operation !== null) {
      // 確認済みPOS値のDB反映だけなら、lease復旧時もPOSを再保存しない。
      if (['pos_confirmed', 'db_pending', 'completed'].includes(operation.status)) {
        if (operation.status !== 'completed') await applyResult(job, operation, assertCurrent)
        await finish(job, null, assertCurrent)
        return { claimed: false, intake: null, operation: null }
      }
      // 送信済みの不明状態はGASへ読取り確認だけを依頼する。再保存はしない。
    }
    // 旧workerへ分類の証拠/dispatchを渡さない。送信済み状態は再保存可へ戻さない。
    if (job.choiceBaseline && (!capable ||
        (operation?.sendAttempts !== 1 && process.env.POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED !== 'true'))) {
      await finish(job, operation?.sendAttempts === 1 ? 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN' : 'POS_PRODUCT_EDIT_DISABLED', assertCurrent)
      return { claimed: false, intake: null, operation: null }
    }
    return { claimed: true, intake: claimed.intake, operation: claimed.operation }
  }
  if (request.action === 'prepare' || request.action === 'recover') exact(request.payload, ['operationId', 'leaseToken', 'inspection'])
  else if (request.action === 'result') exact(request.payload, ['operationId', 'leaseToken', 'result'])
  else exact(request.payload, ['operationId', 'leaseToken', 'code'])
  const { job, saved } = await lease(request)
  assertCurrent()
  const now = clock()
  // 終端工程の応答消失でも同じ受付を返す。ここから再claim/再送には進まない。
  if (job.dto.status !== 'working') {
    if (request.action === 'prepare') return { operationId: job.dto.operationId, actorId: job.actorId, storeId: request.storeId, nextAction: 'review', dispatch: null }
    return { operationId: job.dto.operationId, storeId: request.storeId, status: job.dto.status }
  }
  if (request.action === 'fail') {
    const codes: Record<string, string> = { POS_READ_FAILED: 'POS_PRODUCT_EDIT_INSPECTION_FAILED', POS_PREPARE_FAILED: 'POS_PRODUCT_EDIT_CONFLICT',
      WORKER_RESPONSE_FAILED: 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN', POS_PRODUCT_EDIT_OUTCOME_UNKNOWN: 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN',
      POS_CLASSIFICATION_DISABLED: 'POS_PRODUCT_EDIT_DISABLED' }
    if (typeof request.payload.code !== 'string' || !Object.hasOwn(codes, request.payload.code)) reject()
    return finish(job, codes[request.payload.code], assertCurrent)
  }
  if (request.action === 'prepare') {
    const reviewRequired = async (code: string) => {
      await finish(job, code, assertCurrent)
      return { operationId: job.dto.operationId, actorId: job.actorId, storeId: request.storeId, nextAction: 'review', dispatch: null }
    }
    if (saved.operation !== null && readOperation(saved.operation, job).sendAttempts === 1) return reviewRequired('POS_PRODUCT_EDIT_OUTCOME_UNKNOWN')
    if (job.choiceBaseline && process.env.POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED !== 'true') return reviewRequired('POS_PRODUCT_EDIT_DISABLED')
    const inspection = decodeProductEditInspection(job.target, request.payload.inspection, now)
    try { verifyClassification(job, inspection) } catch { return reviewRequired('POS_PRODUCT_EDIT_CONFLICT') }
    const mapping = { name: 'product_name', price: 'selling_price', cost: 'cost_price' } as const
    for (const field of Object.keys(job.dto.patch).filter(key => Object.hasOwn(mapping, key)) as (keyof typeof mapping)[]) {
      const baseline = job.baseline[mapping[field]]
      if (baseline === null || baseline === undefined || String(baseline) !== inspection.snapshot.fields[field]) return reviewRequired('POS_PRODUCT_EDIT_CONFLICT')
    }
    const fields = { ...inspection.snapshot.fields, ...job.dto.patch }
    if (Object.keys(job.dto.patch).every(field => fields[field as keyof typeof fields] === inspection.snapshot.fields[field as keyof typeof fields])) {
      return reviewRequired('POS_PRODUCT_EDIT_CONFLICT')
    }
    const command = parsePosProductCommand({ kind: 'update', operationId: job.dto.operationId, storeId: request.storeId,
      productId: job.dto.productId, expectedFingerprint: inspection.fingerprint, fields })
    const review = buildProductEditReview(command, inspection.snapshot, inspection.choices, now)
    const commandText = JSON.stringify(command)
    const candidate: ProductOperation = { operationId: job.dto.operationId, actorId: job.actorId, storeId: request.storeId,
      payloadHash: createHash('sha256').update(commandText, 'utf8').digest('hex'), status: 'prepared', version: 0,
      sendAttempts: 0, expectedResultFingerprint: review.expectedResultFingerprint, verifiedFingerprint: null }
    const dispatch = buildProductEditDispatch(candidate, command, inspection, now)
    const group = inspection.groups.find(g => g.id === fields.groupId), supplier = inspection.suppliers.find(s => s.id === fields.supplierId)
    if (!group || (fields.supplierId !== null && !supplier)) reject()
    const preparationCurrent = () => {
      assertCurrent()
      if (job.choiceBaseline && process.env.POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED !== 'true') reject()
    }
    preparationCurrent()
    const prepared = exact(await backgroundEditRpc('prepare_pos_product_edit_intake', {
      p_operation_id: job.dto.operationId, p_lease_token: job.leaseToken, p_command_text: commandText,
      p_pos_product_id: review.posProductId, p_expected_result_fingerprint: review.expectedResultFingerprint,
      p_catalog_text: JSON.stringify({ groupId: group.id, groupName: group.name, supplierId: fields.supplierId,
        supplierName: supplier?.name ?? null, previousPosName: inspection.snapshot.fields.name }),
      p_dispatch_text: dispatch.dispatchText, p_before_fingerprint_text: dispatch.beforeFingerprintText,
      p_expected_fingerprint_text: dispatch.expectedFingerprintText, p_reviewed_at: dispatch.reviewedAt, p_dispatch_hash: dispatch.dispatchHash,
    }), ['operation', 'dispatch', 'claimed'])
    preparationCurrent()
    const restored = restoreProductEditDispatch(prepared.operation, prepared.dispatch, null, clock())
    readOperation(prepared.operation, job)
    if (!restored.dispatch || restored.operation.payloadHash !== candidate.payloadHash ||
        restored.dispatch.dispatchHash !== dispatch.dispatchHash || typeof prepared.claimed !== 'boolean') reject()
    if (!prepared.claimed) return reviewRequired('POS_PRODUCT_EDIT_OUTCOME_UNKNOWN')
    if (restored.operation.status !== 'dispatching' || restored.operation.sendAttempts !== 1) reject()
    return { operationId: job.dto.operationId, actorId: job.actorId, storeId: request.storeId, nextAction: 'save', dispatch: restored.dispatch.command }
  }
  const recovery = request.action === 'recover'
  const result = recovery ? null : backgroundEditRecord(request.payload.result)
  const verified = recovery || result?.outcome === 'values_verified'
  if (result) {
    exact(result, verified ? ['outcome', 'code', 'saveRequestStarted', 'responseReceived', 'inspection']
      : ['outcome', 'code', 'saveRequestStarted', 'responseReceived'])
  const codes = ['POS_PRODUCT_EDIT_DISABLED', 'POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE', 'POS_PRODUCT_EDIT_INVALID_REQUEST',
    'POS_PRODUCT_EDIT_PREPARE_REJECTED', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED', 'POS_PRODUCT_EDIT_EXECUTION_RIGHT_UNAVAILABLE',
    'POS_PRODUCT_EDIT_VERIFY_REQUIRED', 'POS_PRODUCT_EDIT_VALUES_VERIFIED']
  if (!['values_verified', 'not_sent', 'verification_required'].includes(String(result.outcome)) ||
      typeof result.code !== 'string' || !codes.includes(result.code) || typeof result.saveRequestStarted !== 'boolean' ||
      typeof result.responseReceived !== 'boolean' || (result.responseReceived && !result.saveRequestStarted) ||
      (verified && (result.code !== 'POS_PRODUCT_EDIT_VALUES_VERIFIED' || !result.saveRequestStarted))) reject()
  }
  const restored = restoreProductEditDispatch(saved.operation, saved.dispatch, saved.receipt, now)
  let operation = readOperation(saved.operation, job)
  if (!restored.dispatch || operation.sendAttempts !== 1) reject()
  if (operation.status === 'completed') return finish(job, null, assertCurrent)
  if (!verified) {
    // falseの送信フラグやconsume不在だけを「安全に再送可」の証拠にはしない。
    if (['dispatching', 'verifying', 'uncertain'].includes(operation.status)) operation = await recordResult(job, operation, 'outcome_unknown', null, assertCurrent)
    return finish(job, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN', assertCurrent)
  }
  if (restored.receiptConsumedAt === null) reject()
  // 復旧は新規保存の証拠を捏造せず、固定した期待値と新規POS読取りを照合する。
  const after = decodeProductEditInspection(job.target, recovery ? request.payload.inspection : result!.inspection, now)
  const fingerprint = verifyProductEditResult(restored.dispatch.review, after.snapshot, now)
  if (after.snapshot.capturedAt <= restored.receiptConsumedAt) reject()
  assertCurrent()
  if (operation.status === 'dispatching') operation = await recordResult(job, operation, 'dispatch_returned', null, assertCurrent)
  if (['verifying', 'uncertain'].includes(operation.status)) operation = await recordResult(job, operation, 'pos_verified', fingerprint, assertCurrent)
  if (['pos_confirmed', 'db_pending'].includes(operation.status)) {
    try { operation = await applyResult(job, operation, assertCurrent) }
    catch {
      await recordResult(job, operation, 'db_failed', null, assertCurrent)
      throw new Error(FAILURE)
    }
  }
  if (operation.status !== 'completed') reject()
  return finish(job, null, assertCurrent)
}

export async function handleBackgroundWorkerRequest(request: Request, clock = Date.now): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' }, failure = (status: number) => Response.json({ success: false, code: FAILURE }, { status, headers })
  if (!enabled()) return failure(503)
  const secret = process.env.POS_PRODUCT_CONSUME_SECRET
  let verified: BackgroundWorkerRequest | null = null
  try {
    const startedAt = clock(), body = await readBackgroundJson(request, 524288)
    verified = verifyBackgroundWorkerRequest(body, secret, clock())
    const assertCurrent = () => {
      const current = clock()
      if (!enabled() || process.env.POS_PRODUCT_CONSUME_SECRET !== secret || current < startedAt || current >= verified!.expiresAt) reject()
    }
    assertCurrent()
    const data = await execute(verified, clock, assertCurrent)
    assertCurrent()
    return Response.json(signBackgroundWorkerResponse(verified, true, data, secret as string), { headers })
  } catch {
    // SQL、鍵、署名、POS本文、例外原文をクライアントや監視ログへ出さない。
    if (verified && process.env.POS_PRODUCT_CONSUME_SECRET === secret) {
      return Response.json(signBackgroundWorkerResponse(verified, false, null, secret as string), { status: 403, headers })
    }
    return failure(403)
  }
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const REQUEST_AUDIENCE = 'kennel.product-master-sync.request.v1'
const RESPONSE_AUDIENCE = 'kennel.product-master-sync.response.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[0-9a-f]{64}$/
const REQUEST_KEYS = ['version', 'audience', 'requestId', 'storeId', 'issuedAt', 'expiresAt', 'signature']
const RESPONSE_KEYS = [...REQUEST_KEYS, 'payload', 'payloadHash']
export const PRODUCT_MASTER_SYNC_CODES = ['PRODUCT_SYNC_PENDING_EDIT', 'PRODUCT_SYNC_PENDING_SYNC', 'PRODUCT_SYNC_STALE', 'PRODUCT_SYNC_INVALID_DATA',
  'PRODUCT_SYNC_EXPIRED', 'PRODUCT_SYNC_DISABLED', 'PRODUCT_SYNC_UNAVAILABLE', 'PRODUCT_SYNC_UNKNOWN'] as const
export type ProductMasterSyncCode = typeof PRODUCT_MASTER_SYNC_CODES[number]
export type ProductMasterSyncResult = {
  success: true; storeId: 6 | 7; runId: string; csvRowCount: number
  syncResult: { success: true; count: number; deactivatedCount: number; syncStartedAt: string }
} | { success: false; storeId: 6 | 7; runId?: string; code: ProductMasterSyncCode; outcome: 'rejected' | 'unknown' }
type RequestEnvelope = { version: 1; audience: string; requestId: string; storeId: 6 | 7; issuedAt: number; expiresAt: number; signature: string }
type ResponseEnvelope = RequestEnvelope & { payload: string; payloadHash: string }

function reject(): never { throw new Error('PRODUCT_SYNC_UNKNOWN') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) reject()
}
function key(secret: unknown): asserts secret is string { if (typeof secret !== 'string' || !HEX.test(secret)) reject() }
function digest(text: string) { return createHash('sha256').update(text, 'utf8').digest('hex') }
function equal(a: string, b: string) { return HEX.test(a) && HEX.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')) }
function text(e: RequestEnvelope, hash?: string) {
  const values: (string | number)[] = [e.version, e.audience, e.requestId, e.storeId, e.issuedAt, e.expiresAt]
  if (hash !== undefined) values.push(hash)
  return JSON.stringify(values)
}
function common(e: Record<string, unknown>, audience: string, now: number) {
  if (e.version !== 1 || e.audience !== audience || typeof e.requestId !== 'string' || !UUID.test(e.requestId) ||
      (e.storeId !== 6 && e.storeId !== 7) || !Number.isSafeInteger(now) ||
      typeof e.issuedAt !== 'number' || !Number.isSafeInteger(e.issuedAt) || e.issuedAt < 0 || e.issuedAt > now + 5000 ||
      typeof e.expiresAt !== 'number' || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= now ||
      e.expiresAt <= e.issuedAt || e.expiresAt - e.issuedAt > 120_000 || typeof e.signature !== 'string' || !HEX.test(e.signature)) reject()
}

/** 認可済みの店舗と通知UUIDだけを署名する。URL・資格情報・CSVを要求に含めない。 */
export function signProductMasterSyncRequest(storeId: 6 | 7, requestId: string, secret: string, now = Date.now()): RequestEnvelope {
  key(secret)
  const e: RequestEnvelope = { version: 1, audience: REQUEST_AUDIENCE, requestId, storeId, issuedAt: now, expiresAt: now + 120_000, signature: '0'.repeat(64) }
  common(e, REQUEST_AUDIENCE, now)
  e.signature = createHmac('sha256', secret).update(text(e), 'utf8').digest('hex')
  return e
}
export function verifyProductMasterSyncRequest(body: unknown, secret: unknown, now = Date.now()): RequestEnvelope {
  key(secret)
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 2048) reject()
  let e: Record<string, unknown>
  try { e = record(JSON.parse(body)) } catch { reject() }
  exact(e, REQUEST_KEYS); common(e, REQUEST_AUDIENCE, now)
  const envelope = e as RequestEnvelope
  if (!equal(envelope.signature, createHmac('sha256', secret).update(text(envelope), 'utf8').digest('hex'))) reject()
  return envelope
}
function safeResult(value: unknown, request: RequestEnvelope): ProductMasterSyncResult {
  const r = record(value)
  if (r.storeId !== request.storeId || typeof r.success !== 'boolean') reject()
  if (r.runId !== undefined && (r.runId !== request.requestId || typeof r.runId !== 'string' || !UUID.test(r.runId))) reject()
  if (r.success === true) {
    exact(r, ['success', 'storeId', 'runId', 'csvRowCount', 'syncResult'])
    const sync = record(r.syncResult)
    exact(sync, ['success', 'count', 'deactivatedCount', 'syncStartedAt'])
    if (r.runId !== request.requestId || typeof r.csvRowCount !== 'number' || !Number.isSafeInteger(r.csvRowCount) || r.csvRowCount < 1 || r.csvRowCount > 10000 ||
        sync.success !== true || sync.count !== r.csvRowCount || typeof sync.deactivatedCount !== 'number' ||
        !Number.isSafeInteger(sync.deactivatedCount) || sync.deactivatedCount < 0 || typeof sync.syncStartedAt !== 'string' || !Number.isFinite(Date.parse(sync.syncStartedAt))) reject()
  } else {
    exact(r, ['success', 'storeId', 'code', 'outcome', ...(r.runId === undefined ? [] : ['runId'])])
    if (!PRODUCT_MASTER_SYNC_CODES.includes(r.code as ProductMasterSyncCode) || !['rejected', 'unknown'].includes(r.outcome as string) ||
        (r.outcome === 'rejected' && r.code === 'PRODUCT_SYNC_UNKNOWN')) reject()
  }
  return r as ProductMasterSyncResult
}
export function signProductMasterSyncResponse(request: RequestEnvelope, value: ProductMasterSyncResult, secret: string, now = Date.now()): ResponseEnvelope {
  key(secret)
  const payload = JSON.stringify(safeResult(value, request))
  const e: ResponseEnvelope = { version: 1, audience: RESPONSE_AUDIENCE, requestId: request.requestId, storeId: request.storeId,
    issuedAt: now, expiresAt: now + 120_000, payload, payloadHash: digest(payload), signature: '0'.repeat(64) }
  common(e, RESPONSE_AUDIENCE, now)
  e.signature = createHmac('sha256', secret).update(text(e, e.payloadHash), 'utf8').digest('hex')
  return e
}
export function verifyProductMasterSyncResponse(value: unknown, request: RequestEnvelope, secret: unknown, now = Date.now()): ProductMasterSyncResult {
  key(secret)
  const e = record(value); exact(e, RESPONSE_KEYS); common(e, RESPONSE_AUDIENCE, now)
  if (Buffer.byteLength(JSON.stringify(e), 'utf8') > 8192 || e.requestId !== request.requestId || e.storeId !== request.storeId ||
      (e.issuedAt as number) < request.issuedAt - 5000 || typeof e.payload !== 'string' || Buffer.byteLength(e.payload, 'utf8') > 4096 ||
      typeof e.payloadHash !== 'string' || !HEX.test(e.payloadHash)) reject()
  const envelope = e as ResponseEnvelope
  if (!equal(envelope.payloadHash, digest(envelope.payload)) ||
      !equal(envelope.signature, createHmac('sha256', secret).update(text(envelope, envelope.payloadHash), 'utf8').digest('hex'))) reject()
  let result: unknown
  try { result = JSON.parse(envelope.payload) } catch { reject() }
  return safeResult(result, request)
}

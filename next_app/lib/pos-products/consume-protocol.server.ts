import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const AUDIENCE = 'kennel.pos-product-consume.v1'
const HEX = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
type Target = { operationId: string; actorId: string; storeId: 6 | 7; dispatchHash: string }
type ConsumeRequest = Target & { version: 1; audience: string; issuedAt: number; expiresAt: number; signature: string }
type Receipt = Target & { accepted: boolean }
function reject(): never { throw new Error('POS_PRODUCT_CONSUME_REJECTED') }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(k => !Object.hasOwn(value, k))) reject()
  return value as Record<string, unknown>
}
function key(value: unknown): asserts value is string { if (typeof value !== 'string' || !HEX.test(value)) reject() }
function target(r: Record<string, unknown>): Target {
  if (typeof r.operationId !== 'string' || !UUID.test(r.operationId) || typeof r.actorId !== 'string' || !UUID.test(r.actorId) ||
      (r.storeId !== 6 && r.storeId !== 7) || typeof r.dispatchHash !== 'string' || !HEX.test(r.dispatchHash)) reject()
  return { operationId: r.operationId, actorId: r.actorId, storeId: r.storeId, dispatchHash: r.dispatchHash }
}
function mac(value: unknown[], secret: string) { return createHmac('sha256', secret).update(JSON.stringify(value), 'utf8').digest('hex') }
function equal(a: unknown, b: string) { return typeof a === 'string' && HEX.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')) }
function requestText(r: ConsumeRequest) { return [1, AUDIENCE, r.operationId, r.actorId, r.storeId, r.issuedAt, r.expiresAt, r.dispatchHash] }
function readRequest(value: unknown, now: number): ConsumeRequest {
  const r = object(value, ['version', 'audience', 'operationId', 'actorId', 'storeId', 'issuedAt', 'expiresAt', 'dispatchHash', 'signature'])
  const t = target(r)
  if (r.version !== 1 || r.audience !== AUDIENCE || !Number.isSafeInteger(now) || now < 0 ||
      typeof r.issuedAt !== 'number' || !Number.isSafeInteger(r.issuedAt) || r.issuedAt < 0 || r.issuedAt > now + 5000 ||
      typeof r.expiresAt !== 'number' || !Number.isSafeInteger(r.expiresAt) || r.expiresAt <= now ||
      r.expiresAt <= r.issuedAt || r.expiresAt - r.issuedAt > 30000 || typeof r.signature !== 'string' || !HEX.test(r.signature)) reject()
  return { ...t, version: 1, audience: AUDIENCE, issuedAt: r.issuedAt, expiresAt: r.expiresAt, signature: r.signature }
}
export function signProductEditConsumeRequest(input: Target, secret: string, now = Date.now()): ConsumeRequest {
  key(secret)
  const t = target(object(input, ['operationId', 'actorId', 'storeId', 'dispatchHash']))
  const r = readRequest({ ...t, version: 1, audience: AUDIENCE, issuedAt: now, expiresAt: now + 30000, signature: '0'.repeat(64) }, now)
  return { ...r, signature: mac(requestText(r), secret) }
}
export function verifyProductEditConsumeRequest(body: unknown, secret: unknown, now = Date.now()): ConsumeRequest {
  key(secret)
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 8192) reject()
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { reject() }
  const r = readRequest(parsed, now)
  if (!equal(r.signature, mac(requestText(r), secret))) reject()
  return r
}
function readReceipt(value: unknown, request: ConsumeRequest): Receipt {
  const r = object(value, ['operationId', 'actorId', 'storeId', 'dispatchHash', 'accepted']), t = target(r)
  if (typeof r.accepted !== 'boolean' || t.operationId !== request.operationId || t.actorId !== request.actorId ||
      t.storeId !== request.storeId || t.dispatchHash !== request.dispatchHash) reject()
  return { ...t, accepted: r.accepted }
}
function responseText(r: ConsumeRequest, receipt: Receipt) {
  return [1, 'kennel.pos-product-consume-response.v1', r.signature, receipt.operationId, receipt.actorId, receipt.storeId, receipt.dispatchHash, receipt.accepted]
}
/** 消費済みtrue応答を別の要求へ流用できないよう、要求署名と結果を一緒に署名する。 */
export function signProductEditConsumeResponse(request: ConsumeRequest, value: unknown, secret: string) {
  key(secret)
  const receipt = readReceipt(value, request)
  return { version: 1, requestSignature: request.signature, receipt, signature: mac(responseText(request, receipt), secret) }
}
export function verifyProductEditConsumeResponse(value: unknown, request: ConsumeRequest, secret: string): Receipt {
  key(secret)
  const r = object(value, ['version', 'requestSignature', 'receipt', 'signature']), receipt = readReceipt(r.receipt, request)
  if (r.version !== 1 || r.requestSignature !== request.signature || !equal(r.signature, mac(responseText(request, receipt), secret))) reject()
  return receipt
}

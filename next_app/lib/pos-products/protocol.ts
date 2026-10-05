import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const AUDIENCE = 'kennel.pos-products.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[0-9a-f]{64}$/
const KEYS = ['version', 'audience', 'action', 'operationId', 'actorId', 'storeId', 'issuedAt', 'expiresAt', 'payload', 'payloadHash', 'signature']
type Action = 'inspect' | 'dispatch' | 'reconcile'
type Request = { action: Action; operationId: string; actorId: string; storeId: 6 | 7; payload: Record<string, unknown> }
type Envelope = Omit<Request, 'payload'> & {
  version: 1; audience: string; issuedAt: number; expiresAt: number
  payload: string; payloadHash: string; signature: string
}

function reject(): never { throw new Error('POS_PRODUCT_AUTHORIZATION_REJECTED') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
  return value as Record<string, unknown>
}
function digest(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex') }
function equalHex(a: string, b: string) {
  return HEX.test(a) && HEX.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
function key(value: unknown): asserts value is string {
  // ランダム32byteをhex化した専用鍵。ブラウザに渡さず、既存の同期用tokenと共用しない。
  if (typeof value !== 'string' || !HEX.test(value)) reject()
}
function signedText(e: Envelope) {
  return JSON.stringify([e.version, e.audience, e.action, e.operationId, e.actorId,
    e.storeId, e.issuedAt, e.expiresAt, e.payloadHash])
}
function validate(e: Record<string, unknown>, now: number): Record<string, unknown> {
  if (Object.keys(e).length !== KEYS.length || Object.keys(e).some(k => !KEYS.includes(k))) reject()
  if (e.version !== 1 || e.audience !== AUDIENCE || typeof e.action !== 'string' ||
      !['inspect', 'dispatch', 'reconcile'].includes(e.action)) reject()
  if (typeof e.operationId !== 'string' || !UUID.test(e.operationId) || typeof e.actorId !== 'string' || !UUID.test(e.actorId)) reject()
  if (e.storeId !== 6 && e.storeId !== 7) reject()
  if (!Number.isSafeInteger(now) || typeof e.issuedAt !== 'number' || typeof e.expiresAt !== 'number' ||
      !Number.isSafeInteger(e.issuedAt) || !Number.isSafeInteger(e.expiresAt) || e.issuedAt < 0 ||
      e.issuedAt > now + 5000 || e.expiresAt <= now || e.expiresAt <= e.issuedAt || e.expiresAt - e.issuedAt > 120_000) reject()
  if (typeof e.payload !== 'string' || Buffer.byteLength(e.payload, 'utf8') > 16_384 ||
      typeof e.payloadHash !== 'string' || !HEX.test(e.payloadHash) || typeof e.signature !== 'string' || !HEX.test(e.signature)) reject()
  let payload: Record<string, unknown>
  try { payload = record(JSON.parse(e.payload)) } catch { reject() }
  if (payload.storeId !== e.storeId || payload.operationId !== e.operationId) reject()
  return payload
}

/** 認可・入力検証・DB受付後にサーバー内だけで呼ぶ。署名単独では書込みを許可しない。 */
export function signPosProductRequest(request: Request, secret: string, now = Date.now(), ttlMs = 120_000): Envelope {
  key(secret)
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 120_000) reject()
  const payload = JSON.stringify(request.payload)
  if (typeof payload !== 'string') reject()
  const envelope: Envelope = {
    version: 1, audience: AUDIENCE, action: request.action, operationId: request.operationId,
    actorId: request.actorId, storeId: request.storeId, issuedAt: now, expiresAt: now + ttlMs,
    payload, payloadHash: digest(payload), signature: '0'.repeat(64),
  }
  validate(envelope, now)
  envelope.signature = createHmac('sha256', secret).update(signedText(envelope), 'utf8').digest('hex')
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > 24_576) reject()
  return envelope
}

/** GAS実装との契約テストにも使用。リプレイ抑止は永続DBでの原子的claimが別途必須。 */
export function verifyPosProductRequest(body: unknown, secret: unknown, now = Date.now()) {
  key(secret)
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 24_576) reject()
  let parsed: Record<string, unknown>
  try { parsed = record(JSON.parse(body)) } catch { reject() }
  const payload = validate(parsed, now)
  const envelope = parsed as Envelope
  const expected = createHmac('sha256', secret).update(signedText(envelope), 'utf8').digest('hex')
  if (!equalHex(envelope.payloadHash, digest(envelope.payload)) || !equalHex(envelope.signature, expected)) reject()
  return { action: envelope.action, operationId: envelope.operationId, actorId: envelope.actorId,
    storeId: envelope.storeId, payloadHash: envelope.payloadHash, payload }
}

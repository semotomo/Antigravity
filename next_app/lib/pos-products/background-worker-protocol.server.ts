import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const BACKGROUND_WORKER_AUDIENCE = 'kennel.pos-product-background-worker.v1'
const RESPONSE_AUDIENCE = 'kennel.pos-product-background-worker-response.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[0-9a-f]{64}$/
export type BackgroundWorkerAction = 'claim' | 'prepare' | 'result' | 'fail' | 'recover'
export type BackgroundWorkerRequest = { version: 1; audience: string; action: BackgroundWorkerAction; requestId: string;
  storeId: 6 | 7; issuedAt: number; expiresAt: number; payload: Record<string, unknown>; signature: string }
function reject(): never { throw new Error('POS_PRODUCT_BACKGROUND_REQUEST_REJECTED') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
  return value as Record<string, unknown>
}
/** GASと同じcanonical bytes。別audienceでconsume署名の流用を防ぐ。 */
export function backgroundWorkerCanonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(backgroundWorkerCanonical).join(',')}]`
  const object = record(value)
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${backgroundWorkerCanonical(object[key])}`).join(',')}}`
}
function signature(value: unknown, secret: unknown) {
  if (typeof secret !== 'string' || !HEX.test(secret)) reject()
  return createHmac('sha256', secret).update(backgroundWorkerCanonical(value), 'utf8').digest('hex')
}
export function verifyBackgroundWorkerRequest(body: unknown, secret: unknown, now = Date.now()): BackgroundWorkerRequest {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 524288) reject()
  let value: Record<string, unknown>
  try { value = record(JSON.parse(body)) } catch { reject() }
  const keys = ['version', 'audience', 'action', 'requestId', 'storeId', 'issuedAt', 'expiresAt', 'payload', 'signature']
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      value.version !== 1 || value.audience !== BACKGROUND_WORKER_AUDIENCE ||
      !['claim', 'prepare', 'result', 'fail', 'recover'].includes(String(value.action)) ||
      typeof value.requestId !== 'string' || !UUID.test(value.requestId) || (value.storeId !== 6 && value.storeId !== 7) ||
      typeof value.issuedAt !== 'number' || !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0 || value.issuedAt > now + 5000 ||
      typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now ||
      value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 60000 ||
      !Number.isSafeInteger(now) || typeof value.signature !== 'string' || !HEX.test(value.signature)) reject()
  record(value.payload)
  const { signature: supplied, ...unsigned } = value
  const expected = signature(unsigned, secret)
  if (!timingSafeEqual(Buffer.from(supplied as string, 'hex'), Buffer.from(expected, 'hex'))) reject()
  // 入力をcanonical化してコピーし、検証後の参照差替えを防ぐ。
  return JSON.parse(backgroundWorkerCanonical(value)) as BackgroundWorkerRequest
}
export function signBackgroundWorkerRequest(input: Pick<BackgroundWorkerRequest, 'action' | 'requestId' | 'storeId' | 'payload'>,
  secret: string, now = Date.now()): BackgroundWorkerRequest {
  const unsigned = { version: 1 as const, audience: BACKGROUND_WORKER_AUDIENCE, ...input, issuedAt: now, expiresAt: now + 60000 }
  const request = { ...unsigned, signature: signature(unsigned, secret) }
  return verifyBackgroundWorkerRequest(JSON.stringify(request), secret, now)
}
export function signBackgroundWorkerResponse(request: BackgroundWorkerRequest, success: boolean, data: Record<string, unknown> | null, secret: string) {
  const unsigned = { version: 1, audience: RESPONSE_AUDIENCE, requestId: request.requestId, action: request.action,
    storeId: request.storeId, success, data }
  return { ...unsigned, signature: signature(unsigned, secret) }
}

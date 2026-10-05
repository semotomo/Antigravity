import 'server-only'

import { createHash } from 'node:crypto'
import { signPosProductRequest } from './protocol'
import { postPosProductEnvelope } from './inspection-transport.server'
import { decodeProductEditInspection } from './inspection.server'
import { serializeProductEditSnapshotFingerprint } from './edit-review.server'
import type { ProductEditDispatch } from './edit-dispatch.server'
import type { ProductEditInspection } from './inspection.server'

type NotSentCode = 'POS_PRODUCT_EDIT_DISABLED' | 'POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE' | 'POS_PRODUCT_EDIT_INVALID_REQUEST' |
  'POS_PRODUCT_EDIT_PREPARE_REJECTED' | 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED'
type VerificationCode = 'POS_PRODUCT_EDIT_EXECUTION_RIGHT_UNAVAILABLE' | 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED' | 'POS_PRODUCT_EDIT_VERIFY_REQUIRED'
export type ProductEditDispatchObservation =
  | { outcome: 'not_sent'; code: NotSentCode; saveRequestStarted: false; responseReceived: false }
  | { outcome: 'verification_required'; code: VerificationCode; saveRequestStarted: boolean; responseReceived: boolean }
  | { outcome: 'values_verified'; code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED'; saveRequestStarted: true; responseReceived: boolean; inspection: ProductEditInspection }
export type PosProductDispatcher = { dispatch(record: ProductEditDispatch): Promise<ProductEditDispatchObservation> }

const FAILURE = 'POSの商品保存結果を確認できません。再送せず、操作状態を確認してください。'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[0-9a-f]{64}$/
const COMMAND_KEYS = ['operationId', 'actorId', 'storeId', 'janCode', 'before', 'patch', 'expiresAt']
const PATCH_FIELDS = [['goodsName', 'name'], ['goodsGroup', 'groupId'], ['gddGoodsPrice', 'price'],
  ['gddGoodsCost', 'cost'], ['gddSupplierCd', 'supplierId']] as const
const NOT_SENT_CODES: readonly string[] = ['POS_PRODUCT_EDIT_DISABLED', 'POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE',
  'POS_PRODUCT_EDIT_INVALID_REQUEST', 'POS_PRODUCT_EDIT_PREPARE_REJECTED', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED']
const VERIFICATION_CODES: readonly string[] = ['POS_PRODUCT_EDIT_EXECUTION_RIGHT_UNAVAILABLE',
  'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED', 'POS_PRODUCT_EDIT_VERIFY_REQUIRED']

function reject(): never { throw new Error(FAILURE) }
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
  if (keys && (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) reject()
  return value as Record<string, unknown>
}
function hash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const record = object(value)
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}'
}

function validateDispatch(input: ProductEditDispatch, now: number) {
  const saved = object(input), raw = object(saved.command, COMMAND_KEYS)
  if (!Number.isSafeInteger(now) || now <= 0 || typeof raw.operationId !== 'string' || !UUID.test(raw.operationId) ||
      typeof raw.actorId !== 'string' || !UUID.test(raw.actorId) || (raw.storeId !== 6 && raw.storeId !== 7) ||
      typeof raw.janCode !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(raw.janCode) ||
      typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= now || raw.expiresAt - now > 120000) reject()
  const text = canonical(raw)
  // 既存署名protocolのpayload上限を優先し、保存済み本文/期限を更新しない。
  if (Buffer.byteLength(text, 'utf8') > 16384 || text !== saved.dispatchText || typeof saved.dispatchHash !== 'string' ||
      !HEX.test(saved.dispatchHash) || hash(text) !== saved.dispatchHash) reject()
  const command = JSON.parse(text) as ProductEditDispatch['command']
  const before = object(command.before, ['identity', 'fields', 'settings', 'groups', 'suppliers']), identity = object(before.identity)
  const patch = object(command.patch), patchKeys = Object.keys(patch)
  if (!patchKeys.length || patchKeys.length > PATCH_FIELDS.length || patchKeys.some(key =>
    !PATCH_FIELDS.some(([allowed]) => allowed === key) || typeof patch[key] !== 'string' || (patch[key] as string).length > 1000)) reject()
  const review = object(saved.review), expected = object(review.expectedSnapshot)
  if (typeof saved.reviewedAt !== 'number' || !Number.isSafeInteger(saved.reviewedAt) || saved.reviewedAt <= 0 ||
      saved.reviewedAt > now || saved.reviewedAt !== review.reviewedAt || command.expiresAt - saved.reviewedAt !== 120000 ||
      review.operationId !== command.operationId || review.posProductId !== identity.posProductId || canonical(review.patch) !== canonical(patch) ||
      expected.storeId !== command.storeId || expected.janCode !== command.janCode ||
      typeof expected.productId !== 'number' || !Number.isSafeInteger(expected.productId) || expected.productId <= 0) reject()
  const target = { storeId: command.storeId, productId: expected.productId, janCode: command.janCode }
  // 保存済み業務値を既存DTO検査へ通す。通信時刻やhidden状態を補完しない。
  const inspected = decodeProductEditInspection(target, { storeId: command.storeId, janCode: command.janCode,
    capturedAt: expected.capturedAt, searches: ['schGoodsId', 'schMakerCd'].map(field => ({ field, count: 1, inspected: true,
      internalId: identity.posProductId, internalIdPresent: true, salesKind: '2', storeGroupId: identity.groupId,
      productCodeMatches: identity.productCode === command.janCode, manufacturerCodeMatches: identity.manufacturerCode === command.janCode,
      formInspection: before })) }, saved.reviewedAt)
  if (serializeProductEditSnapshotFingerprint(inspected.snapshot, saved.reviewedAt) !== saved.beforeFingerprintText) reject()
  const fields = { ...inspected.snapshot.fields }
  for (const [key, field] of PATCH_FIELDS) {
    if (!Object.hasOwn(patch, key)) continue
    const value = patch[key] as string
    if (field === 'supplierId') fields.supplierId = value === '' ? null : value
    else fields[field] = value
  }
  if (!inspected.choices.groupIds.includes(fields.groupId) ||
      (fields.supplierId !== null && !inspected.choices.supplierIds.includes(fields.supplierId))) reject()
  const expectedText = serializeProductEditSnapshotFingerprint({ ...inspected.snapshot, fields }, saved.reviewedAt)
  if (serializeProductEditSnapshotFingerprint(expected, saved.reviewedAt) !== expectedText || expectedText !== saved.expectedFingerprintText ||
      hash(expectedText) !== review.expectedResultFingerprint) reject()
  return { command, target, dispatchHash: saved.dispatchHash, expectedFingerprint: hash(expectedText) }
}

function observation(raw: unknown, dispatch: ReturnType<typeof validateDispatch>, sentAt: number): ProductEditDispatchObservation {
  const envelope = object(raw, ['version', 'success', 'operationId', 'actorId', 'storeId', 'dispatchHash', 'result'])
  if (envelope.version !== 1 || envelope.success !== true || envelope.operationId !== dispatch.command.operationId ||
      envelope.actorId !== dispatch.command.actorId || envelope.storeId !== dispatch.command.storeId || envelope.dispatchHash !== dispatch.dispatchHash) reject()
  const result = object(envelope.result)
  object(result, result.outcome === 'values_verified' ? ['outcome', 'code', 'saveRequestStarted', 'responseReceived', 'inspection'] :
    ['outcome', 'code', 'saveRequestStarted', 'responseReceived'])
  if (typeof result.code !== 'string' || typeof result.saveRequestStarted !== 'boolean' || typeof result.responseReceived !== 'boolean' ||
      (!result.saveRequestStarted && result.responseReceived)) reject()
  if (result.outcome === 'not_sent') {
    if (!NOT_SENT_CODES.includes(result.code) || result.saveRequestStarted || result.responseReceived) reject()
    return { outcome: 'not_sent', code: result.code as NotSentCode, saveRequestStarted: false, responseReceived: false }
  }
  if (result.outcome === 'verification_required') {
    if (!VERIFICATION_CODES.includes(result.code) || (result.code === 'POS_PRODUCT_EDIT_VERIFY_REQUIRED') !== result.saveRequestStarted) reject()
    return { outcome: 'verification_required', code: result.code as VerificationCode,
      saveRequestStarted: result.saveRequestStarted, responseReceived: result.responseReceived }
  }
  if (result.outcome !== 'values_verified' || result.code !== 'POS_PRODUCT_EDIT_VALUES_VERIFIED' || result.saveRequestStarted !== true) reject()
  const inspection = decodeProductEditInspection(dispatch.target, result.inspection)
  if (inspection.snapshot.capturedAt <= sentAt || inspection.snapshot.identity.posProductId !== dispatch.command.before.identity.posProductId ||
      inspection.fingerprint !== dispatch.expectedFingerprint) reject()
  return { outcome: 'values_verified', code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED', saveRequestStarted: true,
    responseReceived: result.responseReceived, inspection }
}

/** 認可・永続claim後だけで呼ぶ送信ポート。返す値は観測でありDB完了を確定しない。 */
export function createSignedPosProductDispatcher(config: { enabled: boolean; url: string; secret: string }, fetcher: typeof fetch = fetch): PosProductDispatcher {
  if (!config || config.enabled !== true || typeof config.secret !== 'string' || !HEX.test(config.secret) ||
      typeof config.url !== 'string' || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/.test(config.url)) reject()
  const url = config.url, secret = config.secret
  return {
    async dispatch(record) {
      try {
        const now = Date.now(), checked = validateDispatch(record, now)
        const body = JSON.stringify(signPosProductRequest({ action: 'dispatch', operationId: checked.command.operationId,
          actorId: checked.command.actorId, storeId: checked.command.storeId, payload: checked.command }, secret, now, checked.command.expiresAt - now))
        // 応答消失/不正結果でもこの送信へ戻らない。実行権の消費はGASの別ポートが行う。
        return observation(await postPosProductEnvelope(url, body, fetcher), checked, now)
      } catch { reject() }
    },
  }
}

export function configuredPosProductDispatcher(): PosProductDispatcher {
  return createSignedPosProductDispatcher({ enabled: process.env.POS_PRODUCT_EDIT_GATEWAY_ENABLED === 'true',
    url: process.env.POS_PRODUCT_EDIT_GAS_URL ?? '', secret: process.env.POS_PRODUCT_SIGNING_SECRET ?? '' })
}

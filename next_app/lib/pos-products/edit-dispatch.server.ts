import 'server-only'

import { createHash } from 'node:crypto'
import { parsePosProductCommand } from './validation'
import { productOperationNextStep } from './operations'
import { buildProductEditReview, fingerprintProductEditSnapshot, serializeProductEditSnapshotFingerprint } from './edit-review.server'
import type { ProductOperation } from './operations'
import type { ProductEditInspection } from './inspection.server'
import type { ProductEditSnapshot } from './edit-review.server'

const FAILURE = '商品操作の実行記録を確認できません。再送せず、操作状態を確認してください。'
function reject(): never { throw new Error(FAILURE) }
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
  if (keys && (Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)))) reject()
  return value as Record<string, unknown>
}
function hash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const r = record(value)
  return '{' + Object.keys(r).sort().map(k => JSON.stringify(k) + ':' + canonical(r[k])).join(',') + '}'
}
function choices(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value) || value.length > 5000) reject()
  const ids = new Set<string>()
  return value.map(item => {
    const r = record(item, ['id', 'name'])
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(r.id) || ids.has(r.id) ||
        typeof r.name !== 'string' || !r.name.trim() || r.name.length > 1000 || /[\x00-\x1f\x7f]/.test(r.name)) reject()
    ids.add(r.id)
    return { id: r.id, name: r.name }
  })
}
function fingerprintSnapshot(text: unknown, reviewedAt: number): ProductEditSnapshot {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 24576) reject()
  const r = record(JSON.parse(text), ['version', 'storeId', 'productId', 'janCode', 'identity', 'fields', 'settings'])
  if (r.version !== 'pos-product-edit.v1') reject()
  const snapshot = { storeId: r.storeId, productId: r.productId, janCode: r.janCode, capturedAt: reviewedAt,
    complete: true, identity: r.identity, fields: r.fields, settings: r.settings } as ProductEditSnapshot
  if (serializeProductEditSnapshotFingerprint(snapshot, reviewedAt) !== text) reject()
  return snapshot
}

/** 認可・店舗別DB/POS両検索の後でのみ呼ぶ。通信せず、GASと同じcanonical本文を固定する。 */
export function buildProductEditDispatch(operation: ProductOperation, input: unknown, inspection: ProductEditInspection, now = Date.now()) {
  try {
    if (productOperationNextStep(operation) !== 'dispatch' || !Number.isSafeInteger(now) || now <= 0 || now > Number.MAX_SAFE_INTEGER - 120000) reject()
    const command = parsePosProductCommand(input)
    if (command.kind !== 'update' || command.operationId !== operation.operationId || command.storeId !== operation.storeId ||
        hash(JSON.stringify(command)) !== operation.payloadHash) reject()
    record(inspection, ['snapshot', 'fingerprint', 'choices', 'groups', 'suppliers'])
    const beforeFingerprintText = serializeProductEditSnapshotFingerprint(inspection.snapshot, now)
    if (hash(beforeFingerprintText) !== inspection.fingerprint) reject()
    const groups = choices(inspection.groups), suppliers = choices(inspection.suppliers)
    record(inspection.choices, ['storeId', 'salesKind', 'groupIds', 'supplierIds'])
    if (inspection.choices.storeId !== operation.storeId || inspection.choices.salesKind !== 'retail' ||
        canonical(inspection.choices.groupIds) !== canonical(groups.map(g => g.id)) ||
        canonical(inspection.choices.supplierIds) !== canonical(suppliers.map(s => s.id))) reject()
    const review = buildProductEditReview(command, inspection.snapshot, inspection.choices, now)
    if (review.expectedResultFingerprint !== operation.expectedResultFingerprint) reject()
    const normalized = fingerprintSnapshot(beforeFingerprintText, now)
    if (!groups.some(g => g.id === normalized.fields.groupId) ||
        (normalized.fields.supplierId !== null && !suppliers.some(s => s.id === normalized.fields.supplierId))) reject()
    const before = { identity: normalized.identity, fields: normalized.fields, settings: normalized.settings, groups, suppliers }
    const dispatchCommand = { operationId: operation.operationId, actorId: operation.actorId, storeId: operation.storeId,
      janCode: normalized.janCode, before, patch: { ...review.patch }, expiresAt: now + 120000 }
    const dispatchText = canonical(dispatchCommand)
    if (Buffer.byteLength(dispatchText, 'utf8') > 24576) reject()
    const expectedFingerprintText = serializeProductEditSnapshotFingerprint(review.expectedSnapshot, now)
    return { command: dispatchCommand, dispatchText, dispatchHash: hash(dispatchText), beforeFingerprintText,
      expectedFingerprintText, reviewedAt: now, review }
  } catch { reject() }
}
export type ProductEditDispatch = ReturnType<typeof buildProductEditDispatch>

/** 期限後も読めるが、再送を許可する経路ではない。保存済みの業務値だけから期待照合を復元する。 */
export function restoreProductEditDispatch(rawOperation: unknown, rawDispatch: unknown, rawReceipt: unknown, now = Date.now()) {
  try {
    const o = record(rawOperation)
    if (!Number.isSafeInteger(now) || now <= 0) reject()
    const operation: ProductOperation = {
      operationId: o.id as string, actorId: o.actor_id as string, storeId: o.store_id as 6 | 7,
      payloadHash: o.payload_hash as string, status: o.status as ProductOperation['status'], version: o.row_version as number,
      sendAttempts: o.send_attempts as 0 | 1, expectedResultFingerprint: o.expected_result_fingerprint as string,
      verifiedFingerprint: o.verified_fingerprint as string | null,
    }
    productOperationNextStep(operation)
    if (typeof o.command_text !== 'string' || Buffer.byteLength(o.command_text, 'utf8') > 16384 || hash(o.command_text) !== operation.payloadHash) reject()
    const input = parsePosProductCommand(JSON.parse(o.command_text))
    if (input.kind !== 'update' || input.operationId !== operation.operationId || input.storeId !== operation.storeId ||
        input.productId !== o.product_id_snapshot || typeof o.jan_code !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(o.jan_code) ||
        typeof o.pos_product_id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(o.pos_product_id)) reject()
    if (rawDispatch === null) {
      if (rawReceipt !== null) reject()
      return { operation, dispatch: null, receiptConsumedAt: null }
    }
    const d = record(rawDispatch)
    if (d.operation_id !== operation.operationId || d.store_id !== operation.storeId || typeof d.reviewed_at !== 'number' ||
        !Number.isSafeInteger(d.reviewed_at) || d.reviewed_at <= 0 || d.reviewed_at > now + 5000 ||
        typeof d.dispatch_text !== 'string' || Buffer.byteLength(d.dispatch_text, 'utf8') > 24576 || hash(d.dispatch_text) !== d.dispatch_hash) reject()
    const snapshot = fingerprintSnapshot(d.before_fingerprint_text, d.reviewed_at)
    if (snapshot.janCode !== o.jan_code || snapshot.identity.posProductId !== o.pos_product_id) reject()
    const saved = record(JSON.parse(d.dispatch_text), ['operationId', 'actorId', 'storeId', 'janCode', 'before', 'patch', 'expiresAt'])
    const before = record(saved.before, ['identity', 'fields', 'settings', 'groups', 'suppliers'])
    if (canonical(before.identity) !== canonical(snapshot.identity) || canonical(before.fields) !== canonical(snapshot.fields) ||
        canonical(before.settings) !== canonical(snapshot.settings)) reject()
    const groups = choices(before.groups), suppliers = choices(before.suppliers)
    const inspection: ProductEditInspection = { snapshot, fingerprint: fingerprintProductEditSnapshot(snapshot, d.reviewed_at),
      groups, suppliers, choices: { storeId: operation.storeId, salesKind: 'retail', groupIds: groups.map(g => g.id), supplierIds: suppliers.map(s => s.id) } }
    // preparedを装って再送するのではなく、同じ純粋builderで保存済み本文の全項目を検証する。
    const dispatch = buildProductEditDispatch({ ...operation, status: 'prepared', version: 0, sendAttempts: 0, verifiedFingerprint: null }, input, inspection, d.reviewed_at)
    if (dispatch.dispatchText !== d.dispatch_text || dispatch.dispatchHash !== d.dispatch_hash ||
        dispatch.beforeFingerprintText !== d.before_fingerprint_text || dispatch.expectedFingerprintText !== d.expected_fingerprint_text) reject()
    let receiptConsumedAt: number | null = null
    if (rawReceipt !== null) {
      const receipt = record(rawReceipt)
      if (receipt.operation_id !== operation.operationId || receipt.store_id !== operation.storeId || receipt.dispatch_hash !== dispatch.dispatchHash ||
          typeof receipt.consumed_at !== 'string' || operation.sendAttempts !== 1) reject()
      receiptConsumedAt = Date.parse(receipt.consumed_at)
      if (!Number.isSafeInteger(receiptConsumedAt) || receiptConsumedAt < dispatch.reviewedAt ||
          receiptConsumedAt >= dispatch.command.expiresAt || receiptConsumedAt > now + 5000) reject()
    }
    return { operation, dispatch, receiptConsumedAt }
  } catch { reject() }
}

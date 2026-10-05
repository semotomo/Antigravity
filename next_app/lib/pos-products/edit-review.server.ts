import 'server-only'
import { createHash } from 'node:crypto'
import { resolveWritablePosProduct } from './identity'
import { normalizeProductJan, normalizeProductMoney, parsePosProductCommand, validateProductChoices } from './validation'
import type { PosProductCandidate, PosProductChoices, PosProductFields, PosProductStoreId } from './types'

type Settings = {
  nameKana: string; abbreviation: string; taxId: string
  priceScope: 'all'; priceMode: 'fixed'; supplierScope: 'all'
  otherSettingsFingerprint: string
}
export type ProductEditSnapshot = {
  storeId: PosProductStoreId; productId: number; janCode: string; capturedAt: number; complete: true
  identity: PosProductCandidate; fields: PosProductFields; settings: Settings
}
type EditableField = keyof PosProductFields
export type ProductEditReview = {
  operationId: string; reviewedAt: number; posProductId: string
  expectedResultFingerprint: string; expectedSnapshot: ProductEditSnapshot
  changes: { field: EditableField; label: string; before: string | null; after: string | null }[]
  patch: Record<string, string>
}
const HASH = /^[0-9a-f]{64}$/
const FIELDS = [
  ['name', '商品名', 'goodsName'], ['groupId', '商品グループ', 'goodsGroup'],
  ['price', '商品金額', 'gddGoodsPrice'], ['cost', '商品原価', 'gddGoodsCost'],
  ['supplierId', '仕入先', 'gddSupplierCd'],
] as const

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('POS商品情報の取得項目を確認できません。')
  }
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value) || (!allowEmpty && !value.trim())) {
    throw new Error('POS商品情報の値を確認できません。')
  }
  return value
}
function yen(value: unknown): string {
  const result = normalizeProductMoney(value)
  if (result.includes('.')) throw new Error('POSの商品金額・原価は整数円で入力してください。小数は自動切り捨てしません。')
  return result
}

/** 入力元は認可後にサーバーで再取得したPOS情報のみ。Cookieやhidden状態を含めない。 */
function readSnapshot(value: unknown, now: number): ProductEditSnapshot {
  const s = record(value, ['storeId', 'productId', 'janCode', 'capturedAt', 'complete', 'identity', 'fields', 'settings'])
  if ((s.storeId !== 6 && s.storeId !== 7) || typeof s.productId !== 'number' || !Number.isSafeInteger(s.productId) || s.productId <= 0 ||
      s.complete !== true || !Number.isSafeInteger(now) || now <= 0 || typeof s.capturedAt !== 'number' ||
      !Number.isSafeInteger(s.capturedAt) || s.capturedAt <= 0 || now - s.capturedAt > 120_000 || s.capturedAt - now > 5_000) {
    throw new Error('最新のPOS商品情報を取得し直してください。')
  }
  const janCode = normalizeProductJan(s.janCode)
  if (janCode !== s.janCode) throw new Error('POSのJANが正規形式ではありません。')
  const i = record(s.identity, ['posProductId', 'officeId', 'groupId', 'salesKind', 'productCode', 'manufacturerCode', 'exclusiveStore'])
  const identity: PosProductCandidate = {
    posProductId: text(i.posProductId, 128), officeId: text(i.officeId, 100), groupId: text(i.groupId, 100),
    salesKind: text(i.salesKind, 20), productCode: text(i.productCode, 13, true),
    manufacturerCode: text(i.manufacturerCode, 13, true), exclusiveStore: i.exclusiveStore === true,
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(identity.posProductId)) throw new Error('POS内部商品IDが不正です。')
  // この単一候補の再検査は、アダプターが事前に行う両検索・全ページ照合の代わりではない。
  resolveWritablePosProduct({ storeId: s.storeId, janCode, complete: true, searchedFields: ['productCode', 'manufacturerCode'], candidates: [identity] })
  const f = record(s.fields, ['name', 'groupId', 'price', 'cost', 'supplierId'])
  const fields = { name: text(f.name, 200), groupId: text(f.groupId, 100), price: yen(f.price), cost: yen(f.cost), supplierId: f.supplierId === null ? null : text(f.supplierId, 100) }
  const p = record(s.settings, ['nameKana', 'abbreviation', 'taxId', 'priceScope', 'priceMode', 'supplierScope', 'otherSettingsFingerprint'])
  if (p.priceScope !== 'all' || p.priceMode !== 'fixed' || p.supplierScope !== 'all') {
    throw new Error('この価格・仕入先方式の編集は未対応です。POS画面で確認してください。')
  }
  const settings: Settings = {
    nameKana: text(p.nameKana, 1000, true), abbreviation: text(p.abbreviation, 1000, true), taxId: text(p.taxId, 100),
    priceScope: p.priceScope, priceMode: p.priceMode, supplierScope: p.supplierScope,
    otherSettingsFingerprint: text(p.otherSettingsFingerprint, 64),
  }
  if (!HASH.test(settings.otherSettingsFingerprint)) throw new Error('POSの非対象項目を確認できません。')
  return { storeId: s.storeId, productId: s.productId, janCode, capturedAt: s.capturedAt, complete: true, identity, fields, settings }
}
function fingerprintText(s: ProductEditSnapshot): string {
  // キー順を固定した業務値だけを束縛する。取得時刻・セッション値は含めない。
  const value = { version: 'pos-product-edit.v1', storeId: s.storeId, productId: s.productId, janCode: s.janCode, identity: s.identity, fields: s.fields, settings: s.settings }
  return JSON.stringify(value)
}
function fingerprint(s: ProductEditSnapshot): string {
  return createHash('sha256').update(fingerprintText(s), 'utf8').digest('hex')
}

/** 永続復旧用の業務値だけ。既存指紋と同じキー順を維持し、時刻/セッション値は含めない。 */
export function serializeProductEditSnapshotFingerprint(snapshot: unknown, now = Date.now()): string {
  return fingerprintText(readSnapshot(snapshot, now))
}

export function fingerprintProductEditSnapshot(snapshot: unknown, now = Date.now()): string {
  return fingerprint(readSnapshot(snapshot, now))
}

/** 保存計画だけを作る。認可・両検索・台帳claim・実送信は呼出し側の責務。 */
export function buildProductEditReview(input: unknown, latest: unknown, choices: PosProductChoices, now = Date.now()): ProductEditReview {
  const command = parsePosProductCommand(input)
  if (command.kind !== 'update') throw new Error('通常の商品編集だけを確認できます。')
  const before = readSnapshot(latest, now)
  if (command.storeId !== before.storeId || command.productId !== before.productId) throw new Error('対象店舗・商品が一致しません。')
  if (command.expectedFingerprint !== fingerprint(before)) throw new Error('POS商品が編集開始後に変更されました。入力を保持して差分を確認してください。')
  validateProductChoices(command, choices)
  const nextFields = { ...command.fields, price: yen(command.fields.price), cost: yen(command.fields.cost) }
  const changes: ProductEditReview['changes'] = []
  const patch: Record<string, string> = {}
  for (const [field, label, posField] of FIELDS) {
    if (before.fields[field] === nextFields[field]) continue
    changes.push({ field, label, before: before.fields[field], after: nextFields[field] })
    patch[posField] = nextFields[field] ?? ''
  }
  if (changes.length === 0) throw new Error('変更された項目がありません。POSへの保存は不要です。')
  const expectedSnapshot = { ...before, fields: nextFields }
  return { operationId: command.operationId, reviewedAt: now, posProductId: before.identity.posProductId,
    expectedResultFingerprint: fingerprint(expectedSnapshot), expectedSnapshot, changes, patch }
}

/** 必ず送信後の新規取得を渡す。文字列一致だけではPOS保存そのものを証明しない。 */
export function verifyProductEditResult(review: ProductEditReview, actual: unknown, now = Date.now()): string {
  const expected = readSnapshot(review.expectedSnapshot, review.reviewedAt)
  if (review.posProductId !== expected.identity.posProductId || review.expectedResultFingerprint !== fingerprint(expected)) {
    throw new Error('保存予定のPOS商品情報を確認できません。')
  }
  const result = readSnapshot(actual, now)
  if (result.capturedAt <= review.reviewedAt || fingerprint(result) !== review.expectedResultFingerprint) {
    throw new Error('POS保存後の値が一致しません。再送せず結果を確認してください。')
  }
  return fingerprint(result)
}

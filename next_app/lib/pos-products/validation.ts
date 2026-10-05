import type { PosProductChoices, PosProductCommand, PosProductFields } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FINGERPRINT = /^[0-9a-f]{64}$/

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('入力形式が正しくありません。')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('入力形式が正しくありません。')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('許可されていない入力項目があります。')
}

function text(value: unknown, label: string, maxLength = 200) {
  // ここは通信上の安全上限。POS固有の長さ制限は取得したフォームでも別途検証する。
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label}を正しく入力してください。`)
  }
  return value.trim()
}

export function normalizeProductJan(value: unknown): string {
  if (typeof value !== 'string') throw new Error('JANは文字列で入力してください。')
  const normalized = value.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  // 既存の社内コードも扱うためチェックディジットで既登録商品を排除しない。
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(normalized)) throw new Error('JANは8桁・12桁・13桁の数字で入力してください。')
  return normalized
}

export function normalizeProductMoney(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('金額を入力してください。')
  const raw = String(value).trim()
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) throw new Error('金額は0以上、整数9桁・小数2桁以内で入力してください。')
  const [whole, fraction = ''] = raw.split('.')
  const integer = String(Number(whole))
  const decimal = fraction.replace(/0+$/, '')
  return decimal ? `${integer}.${decimal}` : integer
}

export function suggestProductCost(price: unknown, cost: { mode: 'automatic' | 'manual'; value: string }): string {
  if (cost.mode === 'manual') return cost.value
  const [whole, fraction = ''] = normalizeProductMoney(price).split('.')
  // 1/100円単位の安全な整数で半額を計算し、承認済みの1円未満切り捨てを行う。
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return String(Math.floor(hundredths / 200))
}

function parseFields(value: unknown): PosProductFields {
  const fields = object(value)
  exactKeys(fields, ['name', 'groupId', 'price', 'cost', 'supplierId'])
  return {
    name: text(fields.name, '商品名'),
    groupId: text(fields.groupId, '商品グループ', 100),
    price: normalizeProductMoney(fields.price),
    cost: normalizeProductMoney(fields.cost),
    supplierId: fields.supplierId === null || fields.supplierId === '' || fields.supplierId === undefined
      ? null : text(fields.supplierId, '仕入先', 100),
  }
}

export function parsePosProductCommand(value: unknown): PosProductCommand {
  const input = object(value)
  const { storeId, kind, productId, expectedFingerprint } = input
  if (storeId !== 6 && storeId !== 7) throw new Error('対象店舗を一つ選択してください。')
  const operationId = text(input.operationId, '操作ID', 36).toLowerCase()
  if (!UUID.test(operationId)) throw new Error('操作IDが正しくありません。')
  const base = { storeId, operationId } as const
  const keys = ['storeId', 'kind', 'operationId']
  if (kind === 'create') {
    exactKeys(input, [...keys, 'janCode', 'fields'])
    return { ...base, kind, janCode: normalizeProductJan(input.janCode), fields: parseFields(input.fields) }
  }
  if (typeof productId !== 'number' || !Number.isSafeInteger(productId) || productId <= 0) {
    throw new Error('対象商品を正しく選択してください。')
  }
  if (typeof expectedFingerprint !== 'string' || !FINGERPRINT.test(expectedFingerprint)) {
    throw new Error('最新の商品情報を取得し直してください。')
  }
  const existing = { ...base, productId, expectedFingerprint }
  keys.push('productId', 'expectedFingerprint')
  if (kind === 'update') {
    exactKeys(input, [...keys, 'fields'])
    return { ...existing, kind, fields: parseFields(input.fields) }
  }
  if (kind === 'change_jan') {
    exactKeys(input, [...keys, 'oldJanCode', 'newJanCode', 'confirmationJan', 'reason'])
    const oldJanCode = normalizeProductJan(input.oldJanCode)
    const newJanCode = normalizeProductJan(input.newJanCode)
    if (oldJanCode === newJanCode) throw new Error('現在と異なるJANを入力してください。')
    if (normalizeProductJan(input.confirmationJan) !== oldJanCode) throw new Error('確認用JANが変更前と一致しません。')
    return { ...existing, kind, oldJanCode, newJanCode, reason: text(input.reason, '訂正理由', 1000) }
  }
  if (kind === 'delete') {
    exactKeys(input, [...keys, 'janCode', 'confirmationJan', 'confirmed', 'reason'])
    const janCode = normalizeProductJan(input.janCode)
    if (input.confirmed !== true || normalizeProductJan(input.confirmationJan) !== janCode) {
      throw new Error('削除対象のJANと確認内容を確認してください。')
    }
    return { ...existing, kind, janCode, reason: text(input.reason, '削除理由', 1000) }
  }
  throw new Error('対応していない商品操作です。')
}

/** サーバーで取得・認可済みの選択肢と照合する。ブラウザ由来の選択肢は渡さない。 */
export function validateProductChoices(command: PosProductCommand, choices: PosProductChoices): void {
  if (command.storeId !== choices.storeId || choices.salesKind !== 'retail') throw new Error('店舗・商品区分が一致しません。')
  if (command.kind !== 'create' && command.kind !== 'update') return
  if (!choices.groupIds.includes(command.fields.groupId)) throw new Error('この店舗で選択できる商品グループではありません。')
  if (command.fields.supplierId !== null && !choices.supplierIds.includes(command.fields.supplierId)) {
    throw new Error('この店舗で選択できる仕入先ではありません。')
  }
}

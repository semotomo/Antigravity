import { createHash } from 'node:crypto'

export type InventoryPosRow = {
  storeId: number
  matchedProductId: number | null
  eventKind: 'sale' | 'return' | 'order' | 'adjustment' | 'unknown'
  eventAt: string
  quantity: number
}

export type InventoryTransferRow = {
  id: number
  entryType: 'transfer' | 'usage'
  fromStoreId: number
  toStoreId: number | null
  janCode: string
  quantity: number
  occurredAt: string
}

export type InventoryAdjustmentRow = {
  id: string
  storeId: number
  productId: number
  quantityDelta: number
  effectiveAt: string
}

export type InventoryBalanceInput = {
  storeId: number
  productId: number
  janCode: string
  physicalQuantity: number
  countedAt: string
  calculatedAsOf: string
  posRows: InventoryPosRow[]
  transfers: InventoryTransferRow[]
  adjustments: InventoryAdjustmentRow[]
}

export type InventoryBalanceResult = {
  physicalQuantity: number
  salesQuantity: number
  returnQuantity: number
  transferInQuantity: number
  transferOutQuantity: number
  usageQuantity: number
  adjustmentDelta: number
  calculatedQuantity: number
  appliedPosRowCount: number
  ambiguousPosRowCount: number
}

function parseIsoDate(value: string, label: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label}が不正です。`)
  }
  return parsed.getTime()
}

function requireFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}が不正です。`)
  }
  return value
}

function absoluteQuantity(value: number, label: string) {
  return Math.abs(requireFinite(value, label))
}

function minuteEpoch(value: number) {
  return Math.floor(value / 60_000)
}

function isInsideWindow(eventAt: number, countedAt: number, asOf: number) {
  return eventAt > countedAt && eventAt <= asOf
}

/**
 * 確定済み数量へ差分を継ぎ足さず、計数時刻から毎回すべて再集計する。
 */
export function calculateInventoryBalance(input: InventoryBalanceInput): InventoryBalanceResult {
  const physicalQuantity = requireFinite(input.physicalQuantity, '実在庫数')
  const countedAt = parseIsoDate(input.countedAt, '計数時刻')
  const calculatedAsOf = parseIsoDate(input.calculatedAsOf, '計算基準時刻')
  if (calculatedAsOf < countedAt) {
    throw new Error('計算基準時刻は計数時刻以降である必要があります。')
  }

  let salesQuantity = 0
  let returnQuantity = 0
  let transferInQuantity = 0
  let transferOutQuantity = 0
  let usageQuantity = 0
  let adjustmentDelta = 0
  let appliedPosRowCount = 0
  let ambiguousPosRowCount = 0

  for (const row of input.posRows) {
    if (row.storeId !== input.storeId || row.matchedProductId !== input.productId) continue
    if (row.eventKind !== 'sale' && row.eventKind !== 'return') continue

    const eventAt = parseIsoDate(row.eventAt, 'POS日時')
    if (eventAt > calculatedAsOf) continue
    if (minuteEpoch(eventAt) === minuteEpoch(countedAt)) {
      ambiguousPosRowCount += 1
      continue
    }
    if (!isInsideWindow(eventAt, countedAt, calculatedAsOf)) continue

    const quantity = absoluteQuantity(row.quantity, 'POS数量')
    if (row.eventKind === 'sale') salesQuantity += quantity
    if (row.eventKind === 'return') returnQuantity += quantity
    appliedPosRowCount += 1
  }

  for (const row of input.transfers) {
    if (row.janCode !== input.janCode) continue
    const occurredAt = parseIsoDate(row.occurredAt, '移動日時')
    if (!isInsideWindow(occurredAt, countedAt, calculatedAsOf)) continue
    const quantity = absoluteQuantity(row.quantity, '移動数量')

    if (row.entryType === 'usage') {
      if (row.fromStoreId === input.storeId) usageQuantity += quantity
      continue
    }
    if (row.fromStoreId === input.storeId) transferOutQuantity += quantity
    if (row.toStoreId === input.storeId) transferInQuantity += quantity
  }

  for (const row of input.adjustments) {
    if (row.storeId !== input.storeId || row.productId !== input.productId) continue
    const effectiveAt = parseIsoDate(row.effectiveAt, '調整日時')
    if (!isInsideWindow(effectiveAt, countedAt, calculatedAsOf)) continue
    adjustmentDelta += requireFinite(row.quantityDelta, '調整数')
  }

  return {
    physicalQuantity,
    salesQuantity,
    returnQuantity,
    transferInQuantity,
    transferOutQuantity,
    usageQuantity,
    adjustmentDelta,
    calculatedQuantity:
      physicalQuantity -
      salesQuantity +
      returnQuantity +
      transferInQuantity -
      transferOutQuantity -
      usageQuantity +
      adjustmentDelta,
    appliedPosRowCount,
    ambiguousPosRowCount,
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`

  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`
}

export function createInventorySourceFingerprint(input: unknown) {
  return createHash('sha256').update(stableJson(input), 'utf8').digest('hex')
}

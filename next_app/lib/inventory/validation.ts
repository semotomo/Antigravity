export type InventoryRecalculationRequest = {
  storeId: 6 | 7
  sessionId: string
}

export type InventoryCountMode = 'initial' | 'add' | 'replace'

export type InventoryStartRequest = {
  storeId: 6 | 7
}

export type InventoryWorkspaceRequest = {
  storeId: 6 | 7
  sessionId: string | null
  query: string
  countStatus: 'all' | 'counted' | 'uncounted'
  limit: number
  offset: number
}

export type InventoryCountRequest = {
  storeId: 6 | 7
  sessionId: string
  janCode: string
  quantity: number
  mode: InventoryCountMode
  expectedRowVersion: number
}

export type InventoryProductStatusRequest = {
  storeId: 6 | 7
  janCode: string
  active: boolean
  reason: string
}

export type InventoryExclusionRequest = {
  storeId: 6 | 7
  sessionId: string
  janCode: string
  excluded: boolean
  reason: string
  expectedRowVersion: number
}

export type InventoryFinalizeRequest = {
  storeId: 6 | 7
  sessionId: string
  snapshotId: string
  expectedRowVersion: number
  calculatedAsOf: string
}

export type InventoryCorrectionRequest = {
  storeId: 6 | 7
  sessionId: string
  janCode: string
  quantity: number
  reason: string
  expectedRowVersion: number
}

export type InventoryAdjustmentRequest = {
  storeId: 6 | 7
  sessionId: string
  janCode: string
  quantityDelta: number
  reason: string
  idempotencyKey: string
}

export type InventoryOverviewRequest = {
  storeId: 6 | 7
  query: string
  stockStatus: 'all' | 'negative' | 'adjusted'
  limit: number
  offset: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseStoreId(value: unknown): 6 | 7 {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (parsed !== 6 && parsed !== 7) {
    throw new Error('対象店舗が不正です。')
  }
  return parsed
}

function requireRecord(value: unknown, message: string) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, message: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(message)
  return value
}

function parseJanCode(value: unknown) {
  const janCode = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{1,32}$/.test(janCode)) throw new Error('JANコードが不正です。')
  return janCode
}

function parseReason(value: unknown) {
  const reason = typeof value === 'string' ? value.trim().slice(0, 500) : ''
  if (!reason) throw new Error('理由を入力してください。')
  return reason
}

function parseRowVersion(value: unknown) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) {
    throw new Error('商品の更新番号が不正です。')
  }
  return Number(parsed)
}

function parseQuantity(value: unknown, allowSigned: boolean) {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''
  const pattern = allowSigned ? /^-?\d+(?:\.\d{1,3})?$/ : /^\d+(?:\.\d{1,3})?$/
  if (!pattern.test(text)) {
    throw new Error(allowSigned
      ? '調整数は符号付き、小数3桁以内で入力してください。'
      : '数量は0以上、小数3桁以内で入力してください。')
  }
  const quantity = Number(text)
  if (!Number.isFinite(quantity) || Math.abs(quantity) > 99_999_999_999.999) {
    throw new Error('数量が入力可能な範囲を超えています。')
  }
  return quantity
}

export function parseInventoryRecalculationRequest(value: unknown): InventoryRecalculationRequest {
  const input = requireRecord(value, '棚卸し再計算の入力が不正です。')
  const storeId = parseStoreId(input.storeId)
  if (typeof input.sessionId !== 'string' || !UUID_PATTERN.test(input.sessionId)) {
    throw new Error('棚卸しセッションIDが不正です。')
  }

  return { storeId, sessionId: input.sessionId }
}

export function parseInventoryStartRequest(value: unknown): InventoryStartRequest {
  const input = requireRecord(value, '棚卸し開始の入力が不正です。')
  return { storeId: parseStoreId(input.storeId) }
}

export function parseInventoryWorkspaceRequest(value: unknown): InventoryWorkspaceRequest {
  const input = requireRecord(value, '棚卸し一覧の入力が不正です。')
  const sessionId = input.sessionId === null || input.sessionId === '' || input.sessionId === undefined
    ? null
    : input.sessionId
  if (sessionId !== null && (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId))) {
    throw new Error('棚卸しセッションIDが不正です。')
  }

  const query = typeof input.query === 'string' ? input.query.trim().slice(0, 100) : ''
  const countStatus = input.countStatus ?? 'all'
  if (countStatus !== 'all' && countStatus !== 'counted' && countStatus !== 'uncounted') {
    throw new Error('棚卸し状態の指定が不正です。')
  }

  const rawLimit = typeof input.limit === 'string' ? Number(input.limit) : input.limit
  const rawOffset = typeof input.offset === 'string' ? Number(input.offset) : input.offset
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(Number(rawLimit), 1), 200) : 100
  const offset = Number.isInteger(rawOffset) ? Math.max(Number(rawOffset), 0) : 0

  return {
    storeId: parseStoreId(input.storeId),
    sessionId,
    query,
    countStatus,
    limit,
    offset,
  }
}

export function parseInventoryCountRequest(value: unknown): InventoryCountRequest {
  const input = requireRecord(value, '棚卸し数量の入力が不正です。')
  if (typeof input.sessionId !== 'string' || !UUID_PATTERN.test(input.sessionId)) {
    throw new Error('棚卸しセッションIDが不正です。')
  }

  const janCode = typeof input.janCode === 'string' ? input.janCode.trim() : ''
  if (!/^\d{1,32}$/.test(janCode)) {
    throw new Error('JANコードが不正です。')
  }

  const quantityText = typeof input.quantity === 'number' || typeof input.quantity === 'string'
    ? String(input.quantity).trim()
    : ''
  if (!/^\d+(?:\.\d{1,3})?$/.test(quantityText)) {
    throw new Error('数量は0以上、小数3桁以内で入力してください。')
  }
  const quantity = Number(quantityText)
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 99_999_999_999.999) {
    throw new Error('数量が入力可能な範囲を超えています。')
  }

  if (input.mode !== 'initial' && input.mode !== 'add' && input.mode !== 'replace') {
    throw new Error('数量の保存方法が不正です。')
  }
  const rowVersion = typeof input.expectedRowVersion === 'string'
    ? Number(input.expectedRowVersion)
    : input.expectedRowVersion
  if (!Number.isSafeInteger(rowVersion) || Number(rowVersion) < 1) {
    throw new Error('商品の更新番号が不正です。')
  }

  return {
    storeId: parseStoreId(input.storeId),
    sessionId: input.sessionId,
    janCode,
    quantity,
    mode: input.mode,
    expectedRowVersion: Number(rowVersion),
  }
}

export function parseInventoryProductStatusRequest(value: unknown): InventoryProductStatusRequest {
  const input = requireRecord(value, '商品ステータスの入力が不正です。')
  if (typeof input.active !== 'boolean') throw new Error('商品ステータスが不正です。')
  return {
    storeId: parseStoreId(input.storeId),
    janCode: parseJanCode(input.janCode),
    active: input.active,
    reason: parseReason(input.reason),
  }
}

export function parseInventoryExclusionRequest(value: unknown): InventoryExclusionRequest {
  const input = requireRecord(value, '棚卸し除外の入力が不正です。')
  if (typeof input.excluded !== 'boolean') throw new Error('除外状態が不正です。')
  return {
    storeId: parseStoreId(input.storeId),
    sessionId: parseUuid(input.sessionId, '棚卸しセッションIDが不正です。'),
    janCode: parseJanCode(input.janCode),
    excluded: input.excluded,
    reason: parseReason(input.reason),
    expectedRowVersion: parseRowVersion(input.expectedRowVersion),
  }
}

export function parseInventoryFinalizeRequest(value: unknown): InventoryFinalizeRequest {
  const input = requireRecord(value, '棚卸し確定の入力が不正です。')
  const calculatedAsOf = typeof input.calculatedAsOf === 'string' ? input.calculatedAsOf : ''
  if (!calculatedAsOf || Number.isNaN(new Date(calculatedAsOf).getTime())) {
    throw new Error('計算基準時刻が不正です。')
  }
  return {
    storeId: parseStoreId(input.storeId),
    sessionId: parseUuid(input.sessionId, '棚卸しセッションIDが不正です。'),
    snapshotId: parseUuid(input.snapshotId, 'POSスナップショットIDが不正です。'),
    expectedRowVersion: parseRowVersion(input.expectedRowVersion),
    calculatedAsOf: new Date(calculatedAsOf).toISOString(),
  }
}

export function parseInventoryCorrectionRequest(value: unknown): InventoryCorrectionRequest {
  const input = requireRecord(value, '棚卸し訂正の入力が不正です。')
  return {
    storeId: parseStoreId(input.storeId),
    sessionId: parseUuid(input.sessionId, '棚卸しセッションIDが不正です。'),
    janCode: parseJanCode(input.janCode),
    quantity: parseQuantity(input.quantity, false),
    reason: parseReason(input.reason),
    expectedRowVersion: parseRowVersion(input.expectedRowVersion),
  }
}

export function parseInventoryAdjustmentRequest(value: unknown): InventoryAdjustmentRequest {
  const input = requireRecord(value, '手動調整の入力が不正です。')
  const quantityDelta = parseQuantity(input.quantityDelta, true)
  if (quantityDelta === 0) throw new Error('調整数は0以外を入力してください。')
  return {
    storeId: parseStoreId(input.storeId),
    sessionId: parseUuid(input.sessionId, '棚卸しセッションIDが不正です。'),
    janCode: parseJanCode(input.janCode),
    quantityDelta,
    reason: parseReason(input.reason),
    idempotencyKey: parseUuid(input.idempotencyKey, '冪等キーが不正です。'),
  }
}

export function parseInventoryOverviewRequest(value: unknown): InventoryOverviewRequest {
  const input = requireRecord(value, '現在庫一覧の入力が不正です。')
  const stockStatus = input.stockStatus ?? 'all'
  if (stockStatus !== 'all' && stockStatus !== 'negative' && stockStatus !== 'adjusted') {
    throw new Error('現在庫状態の指定が不正です。')
  }
  const rawLimit = typeof input.limit === 'string' ? Number(input.limit) : input.limit
  const rawOffset = typeof input.offset === 'string' ? Number(input.offset) : input.offset
  return {
    storeId: parseStoreId(input.storeId),
    query: typeof input.query === 'string' ? input.query.trim().slice(0, 100) : '',
    stockStatus,
    limit: Number.isInteger(rawLimit) ? Math.min(Math.max(Number(rawLimit), 1), 200) : 100,
    offset: Number.isInteger(rawOffset) ? Math.max(Number(rawOffset), 0) : 0,
  }
}

export function isSameOriginInventoryRequest(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

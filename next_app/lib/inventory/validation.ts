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

export function isSameOriginInventoryRequest(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

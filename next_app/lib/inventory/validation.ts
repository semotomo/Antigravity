export type InventoryRecalculationRequest = {
  storeId: 6 | 7
  sessionId: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseInventoryRecalculationRequest(value: unknown): InventoryRecalculationRequest {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('棚卸し再計算の入力が不正です。')
  }

  const input = value as Record<string, unknown>
  if (input.storeId !== 6 && input.storeId !== 7) {
    throw new Error('対象店舗が不正です。')
  }
  if (typeof input.sessionId !== 'string' || !UUID_PATTERN.test(input.sessionId)) {
    throw new Error('棚卸しセッションIDが不正です。')
  }

  return { storeId: input.storeId, sessionId: input.sessionId }
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

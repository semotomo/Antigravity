import { createHash } from 'node:crypto'

import type { HistoryRow } from '../realtimeHistory.ts'

export type PosEventKind = 'sale' | 'return' | 'order' | 'adjustment' | 'unknown'

export type NormalizedPosSnapshotRow = {
  storeId: 6 | 7
  janCode: string | null
  productName: string
  eventKind: PosEventKind
  eventAt: string
  eventTimePrecision: 'minute'
  quantity: number
  unitCost: number | null
  totalCost: number | null
  signatureHash: string
  signatureOrdinal: number
  rawPayload: HistoryRow
}

export type NormalizedPosSnapshot = {
  payloadSha256: string
  rows: NormalizedPosSnapshotRow[]
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalizeEventKind(value: string): PosEventKind {
  switch (value.trim()) {
    case '販売':
      return 'sale'
    case '返品':
      return 'return'
    case '注文':
      return 'order'
    case '調整':
      return 'adjustment'
    default:
      return 'unknown'
  }
}

function normalizeJan(value: string) {
  const jan = value.trim()
  return /^\d+$/.test(jan) ? jan : null
}

function normalizeOptionalNumber(value: number) {
  return Number.isFinite(value) ? value : null
}

/** POSの分精度日時をJSTとして厳密に解釈する。 */
function parsePosDateTime(value: string) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) throw new Error(`POS日時が不正です: ${value}`)

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const utcMillis = Date.UTC(year, month - 1, day, hour - 9, minute)
  const date = new Date(utcMillis)

  // JavaScriptの存在しない日付の繰り上がりを拒否する。
  const jst = new Date(utcMillis + 9 * 60 * 60 * 1_000)
  if (
    jst.getUTCFullYear() !== year ||
    jst.getUTCMonth() !== month - 1 ||
    jst.getUTCDate() !== day ||
    jst.getUTCHours() !== hour ||
    jst.getUTCMinutes() !== minute
  ) {
    throw new Error(`POS日時が不正です: ${value}`)
  }
  return date.toISOString()
}

function canonicalSignature(row: Omit<NormalizedPosSnapshotRow, 'signatureHash' | 'signatureOrdinal'>) {
  return JSON.stringify([
    row.storeId,
    row.janCode,
    row.productName,
    row.eventKind,
    row.eventAt,
    row.quantity,
    row.unitCost,
    row.totalCost,
  ])
}

export function normalizePosSnapshot(
  sourceRows: HistoryRow[],
  storeId: 6 | 7,
): NormalizedPosSnapshot {
  const ordinalBySignature = new Map<string, number>()
  const rows = sourceRows.map((source): NormalizedPosSnapshotRow => {
    if (!Number.isFinite(source.quantity)) {
      throw new Error('POS数量が不正です。')
    }

    const base = {
      storeId,
      janCode: normalizeJan(source.productCode),
      productName: source.productName.trim(),
      eventKind: normalizeEventKind(source.taskContent),
      eventAt: parsePosDateTime(source.taskDateTime),
      eventTimePrecision: 'minute' as const,
      quantity: Math.abs(source.quantity),
      unitCost: normalizeOptionalNumber(source.cost),
      totalCost: normalizeOptionalNumber(source.totalCost),
      rawPayload: { ...source },
    }
    const signatureHash = sha256(canonicalSignature(base))
    const signatureOrdinal = (ordinalBySignature.get(signatureHash) ?? 0) + 1
    ordinalBySignature.set(signatureHash, signatureOrdinal)
    return { ...base, signatureHash, signatureOrdinal }
  })

  const payloadSha256 = sha256(JSON.stringify(rows.map((row) => [
    row.signatureHash,
    row.signatureOrdinal,
  ])))
  return { payloadSha256, rows }
}

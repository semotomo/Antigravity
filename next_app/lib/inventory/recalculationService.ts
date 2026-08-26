import type { SupabaseClient } from '@supabase/supabase-js'

import {
  fetchGasHistoryRows,
  HISTORY_STORES,
  type HistoryTargetStore,
} from '@/lib/realtimeHistory'
import type { Database, Json } from '@/lib/types/database'
import { normalizePosSnapshot } from './posSnapshot'

const MAX_POS_ROWS = 100_000
const PRESERVED_DRAFT_MESSAGE = '入力済みの棚卸し数量は保存されています。'

type InventorySynchronizationStage =
  | 'context'
  | 'configuration'
  | 'pos_fetch'
  | 'snapshot_save'
  | 'preview'
  | 'recalculation'

export class InventorySynchronizationError extends Error {
  readonly detail: string
  readonly stage: InventorySynchronizationStage

  constructor(stage: InventorySynchronizationStage, message: string, detail: string) {
    super(message)
    this.name = 'InventorySynchronizationError'
    this.stage = stage
    this.detail = detail
  }
}

type RecalculationContext = {
  calculation_from: string
  source_from: string
}

type InventoryRpcError = { message: string }

type InventoryRpcDefinitions = {
  get_inventory_recalculation_context: {
    args: { p_session_id: string; p_store_id: 6 | 7 }
    result: RecalculationContext[]
  }
  save_inventory_pos_snapshot: {
    args: {
      p_fetched_at: string
      p_payload_sha256: string
      p_rows: Json
      p_source_from: string
      p_source_to: string
      p_store_id: 6 | 7
    }
    result: Array<{ snapshot_id: string }>
  }
  recalculate_inventory_session: {
    args: {
      p_calculated_as_of: string
      p_session_id: string
      p_snapshot_id: string
      p_store_id: 6 | 7
    }
    result: Array<Record<string, unknown>>
  }
  preview_inventory_finalization: {
    args: {
      p_calculated_as_of: string
      p_session_id: string
      p_snapshot_id: string
      p_store_id: 6 | 7
    }
    result: unknown
  }
  record_inventory_pos_snapshot_failure: {
    args: {
      p_failure_message: string
      p_fetched_at: string
      p_payload_sha256: string
      p_source_from: string
      p_source_to: string
      p_store_id: 6 | 7
    }
    result: string
  }
}

export type InventoryFinalizationIssue = {
  kind: 'unmatched' | 'same_minute'
  rowNo: number
  janCode: string | null
  productName: string
  eventKind: string
  eventAt: string
  quantity: number
  matchStatus: string
}

export type InventoryFinalizationReview = {
  snapshotId: string
  calculatedAsOf: string
  pendingCount: number
  unmatchedCount: number
  ambiguousCount: number
  duplicateCount: number
  negativeCount: number
  largeAdjustmentCount: number
  balanceCount: number
  canFinalize: boolean
  issues: InventoryFinalizationIssue[]
}

type InventoryRpcClient = {
  rpc: <Name extends keyof InventoryRpcDefinitions>(
    name: Name,
    args: InventoryRpcDefinitions[Name]['args'],
  ) => Promise<{
    data: InventoryRpcDefinitions[Name]['result'] | null
    error: InventoryRpcError | null
  }>
}

function inventoryRpc(supabase: SupabaseClient<Database>) {
  // 既存の手書きDatabase型を崩さず、Phase 2 RPCだけを局所的に厳密化する。
  return supabase as unknown as InventoryRpcClient
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function synchronizationError(
  stage: InventorySynchronizationStage,
  message: string,
  error: unknown,
) {
  return new InventorySynchronizationError(
    stage,
    `${message}${PRESERVED_DRAFT_MESSAGE}時間をおいて再試行してください。`,
    errorDetail(error),
  )
}

function getStore(storeId: 6 | 7): HistoryTargetStore {
  return storeId === 7 ? HISTORY_STORES.main : HISTORY_STORES.wanwan
}

function toJstDate(value: string) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value
  return `${part('year')}/${part('month')}/${part('day')}`
}

function snapshotRowsToJson(rows: ReturnType<typeof normalizePosSnapshot>['rows']): Json {
  return rows.map((row, index) => ({
    rowNo: index + 1,
    signatureHash: row.signatureHash,
    eventKind: row.eventKind,
    eventAt: row.eventAt,
    eventTimePrecision: row.eventTimePrecision,
    janCode: row.janCode,
    productName: row.productName || '商品名なし',
    quantity: row.quantity,
    unitPrice: row.unitCost,
    totalAmount: row.totalCost,
    rawPayload: row.rawPayload as unknown as Json,
  }))
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label}の応答が不正です。`)
  }
  return value as Record<string, unknown>
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}の応答が不正です。`)
  }
  return value
}

function parseFinalizationReview(value: unknown): InventoryFinalizationReview {
  const source = record(value, '確定前チェック')
  if (!Array.isArray(source.issues)) throw new Error('確定前問題一覧の応答が不正です。')
  return {
    snapshotId: String(source.snapshotId ?? ''),
    calculatedAsOf: String(source.calculatedAsOf ?? ''),
    pendingCount: finiteNumber(source.pendingCount, '未棚卸し数'),
    unmatchedCount: finiteNumber(source.unmatchedCount, '未照合数'),
    ambiguousCount: finiteNumber(source.ambiguousCount, '同分時刻件数'),
    duplicateCount: finiteNumber(source.duplicateCount, '重複候補数'),
    negativeCount: finiteNumber(source.negativeCount, 'マイナス在庫数'),
    largeAdjustmentCount: finiteNumber(source.largeAdjustmentCount, '差異警告数'),
    balanceCount: finiteNumber(source.balanceCount, '計算商品数'),
    canFinalize: source.canFinalize === true,
    issues: source.issues.map((value) => {
      const issue = record(value, '確定前問題')
      return {
        kind: issue.kind === 'same_minute' ? 'same_minute' : 'unmatched',
        rowNo: finiteNumber(issue.rowNo, 'POS行番号'),
        janCode: typeof issue.janCode === 'string' ? issue.janCode : null,
        productName: String(issue.productName ?? ''),
        eventKind: String(issue.eventKind ?? ''),
        eventAt: String(issue.eventAt ?? ''),
        quantity: finiteNumber(issue.quantity, 'POS数量'),
        matchStatus: String(issue.matchStatus ?? ''),
      }
    }),
  }
}

async function createInventoryPosSnapshot(
  supabase: SupabaseClient<Database>,
  input: { storeId: 6 | 7; sessionId: string },
) {
  const calculatedAsOf = new Date().toISOString()
  const rpcClient = inventoryRpc(supabase)
  const { data: contextRows, error: contextError } = await rpcClient.rpc(
    'get_inventory_recalculation_context',
    { p_session_id: input.sessionId, p_store_id: input.storeId },
  )
  if (contextError) {
    throw synchronizationError(
      'context',
      '棚卸しの再計算範囲を確認できませんでした。',
      contextError.message,
    )
  }

  const context = contextRows?.[0]
  if (!context) throw new Error('再計算できる棚卸し数量がありません。')

  const store = getStore(input.storeId)
  // 既存のGAS連携で使用中の設定名を正本とし、誤設定名は移行互換だけ残す。
  const gasWebAppUrl = process.env.GAS_WEBAPP_URL ?? process.env.GAS_WEB_APP_URL

  let payloadSha256 = '0'.repeat(64)
  try {
    if (!gasWebAppUrl) {
      throw new InventorySynchronizationError(
        'configuration',
        `販売・返品履歴の接続設定が見つかりません。${PRESERVED_DRAFT_MESSAGE}管理者へ連絡してください。`,
        'GAS_WEBAPP_URLが設定されていません。',
      )
    }

    let sourceRows
    try {
      sourceRows = await fetchGasHistoryRows(
        gasWebAppUrl,
        store,
        toJstDate(context.source_from),
        toJstDate(calculatedAsOf),
      )
    } catch (error) {
      throw synchronizationError(
        'pos_fetch',
        '販売・返品のPOS履歴の取得に失敗しました。',
        error,
      )
    }
    if (sourceRows.length > MAX_POS_ROWS) {
      throw new InventorySynchronizationError(
        'pos_fetch',
        `POS履歴が上限を超えたため処理できません。${PRESERVED_DRAFT_MESSAGE}管理者へ連絡してください。`,
        `POS履歴が上限${MAX_POS_ROWS.toLocaleString()}件を超えています。`,
      )
    }

    const snapshot = normalizePosSnapshot(sourceRows, input.storeId)
    payloadSha256 = snapshot.payloadSha256
    const { data: savedRows, error: saveError } = await rpcClient.rpc(
      'save_inventory_pos_snapshot',
      {
        p_fetched_at: calculatedAsOf,
        p_payload_sha256: snapshot.payloadSha256,
        p_rows: snapshotRowsToJson(snapshot.rows),
        p_source_from: context.source_from,
        p_source_to: calculatedAsOf,
        p_store_id: input.storeId,
      },
    )
    if (saveError) {
      throw synchronizationError(
        'snapshot_save',
        'POS snapshotの保存に失敗しました。',
        saveError.message,
      )
    }

    const snapshotId = savedRows?.[0]?.snapshot_id
    if (!snapshotId) {
      throw synchronizationError(
        'snapshot_save',
        'POS snapshotの保存結果を確認できませんでした。',
        '保存したPOS snapshot IDを取得できませんでした。',
      )
    }
    return { snapshotId, calculatedAsOf }
  } catch (error) {
    const failure = error instanceof InventorySynchronizationError
      ? error
      : synchronizationError('pos_fetch', '販売・返品履歴の同期に失敗しました。', error)
    try {
      await rpcClient.rpc('record_inventory_pos_snapshot_failure', {
        p_failure_message: failure.detail.slice(0, 1_000),
        p_fetched_at: calculatedAsOf,
        p_payload_sha256: payloadSha256,
        p_source_from: context.source_from,
        p_source_to: calculatedAsOf,
        p_store_id: input.storeId,
      })
    } catch {
      // 失敗監査の記録エラーで、利用者へ返す元の同期エラーを上書きしない。
    }
    throw failure
  }
}

export async function recalculateInventorySession(
  supabase: SupabaseClient<Database>,
  input: { storeId: 6 | 7; sessionId: string },
) {
  const rpcClient = inventoryRpc(supabase)
  const { snapshotId, calculatedAsOf } = await createInventoryPosSnapshot(supabase, input)
  const { data: calculationRows, error: calculationError } = await rpcClient.rpc(
    'recalculate_inventory_session',
    {
      p_calculated_as_of: calculatedAsOf,
      p_session_id: input.sessionId,
      p_snapshot_id: snapshotId,
      p_store_id: input.storeId,
    },
  )
  if (calculationError) {
    throw synchronizationError(
      'recalculation',
      '最新履歴による現在庫の再計算に失敗しました。',
      calculationError.message,
    )
  }
  return { snapshotId, calculatedAsOf, result: calculationRows?.[0] ?? null }
}

export async function prepareInventoryFinalization(
  supabase: SupabaseClient<Database>,
  input: { storeId: 6 | 7; sessionId: string },
) {
  const { snapshotId, calculatedAsOf } = await createInventoryPosSnapshot(supabase, input)
  const { data, error } = await inventoryRpc(supabase).rpc('preview_inventory_finalization', {
    p_calculated_as_of: calculatedAsOf,
    p_session_id: input.sessionId,
    p_snapshot_id: snapshotId,
    p_store_id: input.storeId,
  })
  if (error) {
    throw synchronizationError(
      'preview',
      '確定前チェックのDB集計に失敗しました。',
      error.message,
    )
  }
  try {
    return parseFinalizationReview(data)
  } catch (error) {
    throw synchronizationError(
      'preview',
      '確定前チェック結果の読み取りに失敗しました。',
      error,
    )
  }
}

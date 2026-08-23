import type { SupabaseClient } from '@supabase/supabase-js'

import {
  fetchGasHistoryRows,
  HISTORY_STORES,
  type HistoryTargetStore,
} from '@/lib/realtimeHistory'
import type { Database, Json } from '@/lib/types/database'
import { normalizePosSnapshot } from './posSnapshot'

const MAX_POS_ROWS = 100_000

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

export async function recalculateInventorySession(
  supabase: SupabaseClient<Database>,
  input: { storeId: 6 | 7; sessionId: string },
) {
  const calculatedAsOf = new Date().toISOString()
  const rpcClient = inventoryRpc(supabase)
  const { data: contextRows, error: contextError } = await rpcClient.rpc(
    'get_inventory_recalculation_context',
    { p_session_id: input.sessionId, p_store_id: input.storeId },
  )
  if (contextError) throw new Error(`再計算範囲の取得に失敗しました: ${contextError.message}`)

  const context = contextRows?.[0]
  if (!context) throw new Error('再計算できる棚卸し数量がありません。')

  const store = getStore(input.storeId)
  const gasWebAppUrl = process.env.GAS_WEB_APP_URL
  if (!gasWebAppUrl) throw new Error('GAS_WEB_APP_URLが設定されていません。')

  let payloadSha256 = '0'.repeat(64)
  try {
    // 表示用キャッシュは参照せず、POS履歴だけを同じ期間で直接取得する。
    const sourceRows = await fetchGasHistoryRows(
      gasWebAppUrl,
      store,
      toJstDate(context.source_from),
      toJstDate(calculatedAsOf),
    )
    if (sourceRows.length > MAX_POS_ROWS) {
      throw new Error(`POS履歴が上限${MAX_POS_ROWS.toLocaleString()}件を超えています。`)
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
    if (saveError) throw new Error(`POS snapshotの保存に失敗しました: ${saveError.message}`)

    const snapshotId = savedRows?.[0]?.snapshot_id
    if (!snapshotId) throw new Error('保存したPOS snapshot IDを取得できませんでした。')

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
      throw new Error(`在庫の再計算に失敗しました: ${calculationError.message}`)
    }

    return {
      snapshotId,
      calculatedAsOf,
      result: calculationRows?.[0] ?? null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'POS同期に失敗しました。'
    // 失敗監査の保存に失敗しても、元のエラーを優先して返す。
    await rpcClient.rpc('record_inventory_pos_snapshot_failure', {
      p_failure_message: message.slice(0, 1_000),
      p_fetched_at: calculatedAsOf,
      p_payload_sha256: payloadSha256,
      p_source_from: context.source_from,
      p_source_to: calculatedAsOf,
      p_store_id: input.storeId,
    })
    throw error
  }
}

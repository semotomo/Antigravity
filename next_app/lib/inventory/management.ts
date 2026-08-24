import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/types/database'
import type {
  InventoryAdjustmentRequest,
  InventoryCorrectionRequest,
  InventoryExclusionRequest,
  InventoryFinalizeRequest,
  InventoryOverviewRequest,
  InventoryProductStatusRequest,
} from './validation'

type RpcError = { message: string }

type ManagementRpcDefinitions = {
  set_inventory_product_status: {
    args: { p_active: boolean; p_jan_code: string; p_reason: string; p_store_id: 6 | 7 }
    result: Json
  }
  set_inventory_item_exclusion: {
    args: {
      p_excluded: boolean
      p_expected_row_version: number
      p_jan_code: string
      p_reason: string
      p_session_id: string
      p_store_id: 6 | 7
    }
    result: Json
  }
  finalize_inventory_session: {
    args: {
      p_calculated_as_of: string
      p_expected_row_version: number
      p_session_id: string
      p_snapshot_id: string
      p_store_id: 6 | 7
    }
    result: Array<Record<string, unknown>>
  }
  correct_finalized_inventory_count: {
    args: {
      p_expected_row_version: number
      p_jan_code: string
      p_quantity: number
      p_reason: string
      p_session_id: string
      p_store_id: 6 | 7
    }
    result: Json
  }
  add_inventory_adjustment: {
    args: {
      p_idempotency_key: string
      p_jan_code: string
      p_quantity_delta: number
      p_reason: string
      p_session_id: string
      p_store_id: 6 | 7
    }
    result: Json
  }
  get_inventory_overview: {
    args: {
      p_limit: number
      p_offset: number
      p_query: string
      p_stock_status: 'all' | 'negative' | 'adjusted'
      p_store_id: 6 | 7
    }
    result: Json
  }
  get_inventory_print_data: {
    args: {
      p_mode: 'blank' | 'result'
      p_session_id: string | null
      p_sort: 'category' | 'supplier' | 'shelf' | 'name'
      p_store_id: 6 | 7
    }
    result: Json
  }
}

type ManagementRpcClient = {
  rpc: <Name extends keyof ManagementRpcDefinitions>(
    name: Name,
    args: ManagementRpcDefinitions[Name]['args'],
  ) => Promise<{ data: ManagementRpcDefinitions[Name]['result'] | null; error: RpcError | null }>
}

export type InventoryOverviewItem = {
  sessionId: string
  sessionItemId: string
  storeId: 6 | 7
  productId: number
  janCode: string
  productName: string
  category: string | null
  supplierName: string | null
  shelfCode: string | null
  isActive: boolean
  physicalQuantity: number
  countedAt: string
  salesQuantity: number
  returnQuantity: number
  transferInQuantity: number
  transferOutQuantity: number
  usageQuantity: number
  adjustmentDelta: number
  calculatedQuantity: number
  calculatedAsOf: string
  rowVersion: number
  varianceThreshold: number
  isLargeAdjustment: boolean
}

export type InventoryOverview = {
  session: null | {
    id: string
    storeId: 6 | 7
    status: 'finalized'
    startedAt: string
    finalizedAt: string
    rowVersion: number
  }
  summary: { totalCount: number; negativeCount: number; adjustedCount: number }
  items: InventoryOverviewItem[]
  filteredCount: number
  limit: number
  offset: number
}

export type InventoryPrintItem = {
  janCode: string
  productName: string
  category: string | null
  supplierName: string | null
  shelfCode: string | null
  isActive: boolean
  excluded: boolean
  countedQuantity: number | null
  countedAt: string | null
  physicalQuantity: number | null
  salesQuantity: number | null
  returnQuantity: number | null
  transferInQuantity: number | null
  transferOutQuantity: number | null
  usageQuantity: number | null
  adjustmentDelta: number | null
  calculatedQuantity: number | null
  calculatedAsOf: string | null
  isLargeAdjustment: boolean
}

export type InventoryPrintData = {
  storeId: 6 | 7
  sessionId: string
  status: 'draft' | 'finalizing' | 'finalized' | 'cancelled'
  startedAt: string
  finalizedAt: string | null
  mode: 'blank' | 'result'
  sort: 'category' | 'supplier' | 'shelf' | 'name'
  items: InventoryPrintItem[]
}

function rpc(supabase: SupabaseClient<Database>) {
  return supabase as unknown as ManagementRpcClient
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label}の応答が不正です。`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label}の応答が不正です。`)
  return value
}

function nullableText(value: unknown) {
  return typeof value === 'string' ? value : null
}

function number(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}の応答が不正です。`)
  return value
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function storeId(value: unknown): 6 | 7 {
  if (value !== 6 && value !== 7) throw new Error('店舗IDの応答が不正です。')
  return value
}

function parseOverviewItem(value: unknown): InventoryOverviewItem {
  const item = record(value, '現在庫商品')
  return {
    sessionId: text(item.sessionId, 'セッションID'),
    sessionItemId: text(item.sessionItemId, 'セッション商品ID'),
    storeId: storeId(item.storeId),
    productId: number(item.productId, '商品ID'),
    janCode: text(item.janCode, 'JAN'),
    productName: text(item.productName, '商品名'),
    category: nullableText(item.category),
    supplierName: nullableText(item.supplierName),
    shelfCode: nullableText(item.shelfCode),
    isActive: item.isActive === true,
    physicalQuantity: number(item.physicalQuantity, '実在庫数'),
    countedAt: text(item.countedAt, '計数時刻'),
    salesQuantity: number(item.salesQuantity, '販売数'),
    returnQuantity: number(item.returnQuantity, '返品数'),
    transferInQuantity: number(item.transferInQuantity, '移動入数'),
    transferOutQuantity: number(item.transferOutQuantity, '移動出数'),
    usageQuantity: number(item.usageQuantity, '物品使用数'),
    adjustmentDelta: number(item.adjustmentDelta, '調整数'),
    calculatedQuantity: number(item.calculatedQuantity, '現在庫'),
    calculatedAsOf: text(item.calculatedAsOf, '計算基準時刻'),
    rowVersion: number(item.rowVersion, '更新番号'),
    varianceThreshold: number(item.varianceThreshold, '差異閾値'),
    isLargeAdjustment: item.isLargeAdjustment === true,
  }
}

export function parseInventoryOverview(value: unknown): InventoryOverview {
  const source = record(value, '現在庫一覧')
  const summary = record(source.summary, '現在庫集計')
  if (!Array.isArray(source.items)) throw new Error('現在庫商品一覧の応答が不正です。')
  let session: InventoryOverview['session'] = null
  if (source.session) {
    const sourceSession = record(source.session, '確定棚卸し')
    session = {
      id: text(sourceSession.id, 'セッションID'),
      storeId: storeId(sourceSession.storeId),
      status: 'finalized',
      startedAt: text(sourceSession.startedAt, '開始日時'),
      finalizedAt: text(sourceSession.finalizedAt, '確定日時'),
      rowVersion: number(sourceSession.rowVersion, '更新番号'),
    }
  }
  return {
    session,
    summary: {
      totalCount: number(summary.totalCount, '商品数'),
      negativeCount: number(summary.negativeCount, 'マイナス在庫数'),
      adjustedCount: number(summary.adjustedCount, '調整商品数'),
    },
    items: source.items.map(parseOverviewItem),
    filteredCount: number(source.filteredCount, '検索件数'),
    limit: number(source.limit, '取得件数'),
    offset: number(source.offset, '取得位置'),
  }
}

export function parseInventoryPrintData(value: unknown): InventoryPrintData {
  const source = record(value, '印刷データ')
  if (!Array.isArray(source.items)) throw new Error('印刷商品一覧の応答が不正です。')
  const status = source.status
  if (status !== 'draft' && status !== 'finalizing' && status !== 'finalized' && status !== 'cancelled') {
    throw new Error('印刷対象の棚卸し状態が不正です。')
  }
  const mode = source.mode === 'result' ? 'result' : 'blank'
  const sort = source.sort
  if (sort !== 'category' && sort !== 'supplier' && sort !== 'shelf' && sort !== 'name') {
    throw new Error('印刷並び順の応答が不正です。')
  }
  return {
    storeId: storeId(source.storeId),
    sessionId: text(source.sessionId, 'セッションID'),
    status,
    startedAt: text(source.startedAt, '開始日時'),
    finalizedAt: nullableText(source.finalizedAt),
    mode,
    sort,
    items: source.items.map((value) => {
      const item = record(value, '印刷商品')
      return {
        janCode: text(item.janCode, 'JAN'),
        productName: text(item.productName, '商品名'),
        category: nullableText(item.category),
        supplierName: nullableText(item.supplierName),
        shelfCode: nullableText(item.shelfCode),
        isActive: item.isActive === true,
        excluded: item.excluded === true,
        countedQuantity: nullableNumber(item.countedQuantity),
        countedAt: nullableText(item.countedAt),
        physicalQuantity: nullableNumber(item.physicalQuantity),
        salesQuantity: nullableNumber(item.salesQuantity),
        returnQuantity: nullableNumber(item.returnQuantity),
        transferInQuantity: nullableNumber(item.transferInQuantity),
        transferOutQuantity: nullableNumber(item.transferOutQuantity),
        usageQuantity: nullableNumber(item.usageQuantity),
        adjustmentDelta: nullableNumber(item.adjustmentDelta),
        calculatedQuantity: nullableNumber(item.calculatedQuantity),
        calculatedAsOf: nullableText(item.calculatedAsOf),
        isLargeAdjustment: item.isLargeAdjustment === true,
      }
    }),
  }
}

async function mutation(
  promise: Promise<{ data: Json | null; error: RpcError | null }>,
  label: string,
) {
  const { data, error } = await promise
  if (error) throw new Error(`${label}に失敗しました: ${error.message}`)
  return record(data, label)
}

export function setInventoryProductStatus(supabase: SupabaseClient<Database>, input: InventoryProductStatusRequest) {
  return mutation(rpc(supabase).rpc('set_inventory_product_status', {
    p_active: input.active,
    p_jan_code: input.janCode,
    p_reason: input.reason,
    p_store_id: input.storeId,
  }), '商品ステータスの変更')
}

export function setInventoryItemExclusion(supabase: SupabaseClient<Database>, input: InventoryExclusionRequest) {
  return mutation(rpc(supabase).rpc('set_inventory_item_exclusion', {
    p_excluded: input.excluded,
    p_expected_row_version: input.expectedRowVersion,
    p_jan_code: input.janCode,
    p_reason: input.reason,
    p_session_id: input.sessionId,
    p_store_id: input.storeId,
  }), '棚卸し対象の変更')
}

export async function finalizeInventorySession(supabase: SupabaseClient<Database>, input: InventoryFinalizeRequest) {
  const { data, error } = await rpc(supabase).rpc('finalize_inventory_session', {
    p_calculated_as_of: input.calculatedAsOf,
    p_expected_row_version: input.expectedRowVersion,
    p_session_id: input.sessionId,
    p_snapshot_id: input.snapshotId,
    p_store_id: input.storeId,
  })
  if (error) throw new Error(`棚卸しの確定に失敗しました: ${error.message}`)
  const row = data?.[0]
  if (!row) throw new Error('棚卸し確定結果を取得できませんでした。')
  return row
}

export function correctFinalizedInventoryCount(supabase: SupabaseClient<Database>, input: InventoryCorrectionRequest) {
  return mutation(rpc(supabase).rpc('correct_finalized_inventory_count', {
    p_expected_row_version: input.expectedRowVersion,
    p_jan_code: input.janCode,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_session_id: input.sessionId,
    p_store_id: input.storeId,
  }), '確定済み数量の訂正')
}

export function addInventoryAdjustment(supabase: SupabaseClient<Database>, input: InventoryAdjustmentRequest) {
  return mutation(rpc(supabase).rpc('add_inventory_adjustment', {
    p_idempotency_key: input.idempotencyKey,
    p_jan_code: input.janCode,
    p_quantity_delta: input.quantityDelta,
    p_reason: input.reason,
    p_session_id: input.sessionId,
    p_store_id: input.storeId,
  }), '手動調整')
}

export async function getInventoryOverview(supabase: SupabaseClient<Database>, input: InventoryOverviewRequest) {
  const { data, error } = await rpc(supabase).rpc('get_inventory_overview', {
    p_limit: input.limit,
    p_offset: input.offset,
    p_query: input.query,
    p_stock_status: input.stockStatus,
    p_store_id: input.storeId,
  })
  if (error) throw new Error(`現在庫一覧の取得に失敗しました: ${error.message}`)
  return parseInventoryOverview(data)
}

export async function getInventoryPrintData(
  supabase: SupabaseClient<Database>,
  input: { storeId: 6 | 7; sessionId: string | null; mode: 'blank' | 'result'; sort: 'category' | 'supplier' | 'shelf' | 'name' },
) {
  const { data, error } = await rpc(supabase).rpc('get_inventory_print_data', {
    p_mode: input.mode,
    p_session_id: input.sessionId,
    p_sort: input.sort,
    p_store_id: input.storeId,
  })
  if (error) throw new Error(`印刷データの取得に失敗しました: ${error.message}`)
  return parseInventoryPrintData(data)
}

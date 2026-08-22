import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoreView } from '@/lib/storeAuth'
import type { Database, Json } from '@/lib/types/database'

export type HistoryRow = {
  productCode: string
  productName: string
  taskContent: string
  storeName: string
  taskDateTime: string
  quantity: number
  cost: number
  totalCost: number
}

export type HistoryTargetStore = {
  key: 'main' | 'wanwan'
  name: '本店' | 'わんわん'
  storeId: 7 | 6
  displayStoreId: '11053' | '11054'
  tenpoGroupId: '11098' | '11099'
  tenpoGroupName: 'からつケンネル本店' | 'わんわんペットセンター'
}

type GasHistoryResponse = {
  success?: boolean
  message?: string
  history?: {
    success?: boolean
    message?: string
    data?: HistoryRow[]
  }
  logs?: string
}

export type HistorySnapshot = {
  store: HistoryTargetStore
  startDate: string
  endDate: string
  rows: HistoryRow[]
  count: number
  gasCount: number
  transferCount: number
  fetchedAt: string
}

export const HISTORY_STORES = {
  main: {
    key: 'main',
    name: '本店',
    storeId: 7,
    displayStoreId: '11053',
    tenpoGroupId: '11098',
    tenpoGroupName: 'からつケンネル本店',
  },
  wanwan: {
    key: 'wanwan',
    name: 'わんわん',
    storeId: 6,
    displayStoreId: '11054',
    tenpoGroupId: '11099',
    tenpoGroupName: 'わんわんペットセンター',
  },
} as const satisfies Record<string, HistoryTargetStore>

export function getHistoryTargetStores(view: StoreView): HistoryTargetStore[] {
  if (view === 'wanwan') return [HISTORY_STORES.wanwan]
  if (view === 'main') return [HISTORY_STORES.main]
  return [HISTORY_STORES.main, HISTORY_STORES.wanwan]
}

export function getJstToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('日本時間の当日日付を取得できませんでした。')
  }

  return `${year}/${month}/${day}`
}

export function isHistoryDate(value: string) {
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return false
  const normalized = value.replace(/\//g, '-')
  const parsed = new Date(`${normalized}T00:00:00+09:00`)
  return !Number.isNaN(parsed.getTime()) && getJstToday(parsed) === value
}

function normalizeDateTime(value: string) {
  return value.replace(/\//g, '-')
}

export function sortHistoryRows(rows: HistoryRow[]) {
  return [...rows].sort((left, right) =>
    normalizeDateTime(right.taskDateTime).localeCompare(normalizeDateTime(left.taskDateTime)),
  )
}

type SalesReturnGroup = {
  sales: HistoryRow[]
  returns: HistoryRow[]
}

function getSalesReturnGroupKey(row: HistoryRow) {
  const productKey = row.productCode.trim()
    ? `code:${row.productCode.trim()}`
    : `name:${row.productName.trim()}`

  return `${row.storeName.trim()}\u0000${productKey}`
}

function positiveQuantity(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function absoluteAmount(value: number) {
  return Number.isFinite(value) ? Math.abs(value) : 0
}

/**
 * 同一店舗・同一商品の販売と返品を相殺する。
 * 返品がない販売履歴は明細を維持し、返品がある商品だけ最新行へ集約する。
 */
export function netHistorySalesAndReturns(rows: HistoryRow[]) {
  const groups = new Map<string, SalesReturnGroup>()
  const result: HistoryRow[] = []

  rows.forEach((row) => {
    const taskContent = row.taskContent.trim()
    if (taskContent !== '販売' && taskContent !== '返品') {
      result.push(row)
      return
    }

    const groupKey = getSalesReturnGroupKey(row)
    const group = groups.get(groupKey) ?? { sales: [], returns: [] }
    if (taskContent === '返品') {
      group.returns.push(row)
    } else {
      group.sales.push(row)
    }
    groups.set(groupKey, group)
  })

  groups.forEach((group) => {
    if (group.returns.length === 0) {
      result.push(...group.sales)
      return
    }

    const salesQuantity = group.sales.reduce(
      (sum, row) => sum + positiveQuantity(row.quantity),
      0,
    )
    const returnQuantity = group.returns.reduce(
      (sum, row) => sum + absoluteAmount(row.quantity),
      0,
    )
    const netQuantity = salesQuantity - returnQuantity

    if (netQuantity <= 0) {
      return
    }

    const latestRow = sortHistoryRows([...group.sales, ...group.returns])[0]
    const salesTotalCost = group.sales.reduce(
      (sum, row) => sum + absoluteAmount(row.totalCost),
      0,
    )
    const returnTotalCost = group.returns.reduce(
      (sum, row) => sum + absoluteAmount(row.totalCost),
      0,
    )

    result.push({
      ...latestRow,
      taskContent: '販売',
      quantity: netQuantity,
      totalCost: salesTotalCost - returnTotalCost,
    })
  })

  return sortHistoryRows(result)
}

function isHistoryRow(value: Json): value is HistoryRow & Json {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false
  return (
    typeof value.productCode === 'string' &&
    typeof value.productName === 'string' &&
    typeof value.taskContent === 'string' &&
    typeof value.storeName === 'string' &&
    typeof value.taskDateTime === 'string' &&
    typeof value.quantity === 'number' &&
    typeof value.cost === 'number' &&
    typeof value.totalCost === 'number'
  )
}

async function fetchGasRows(
  gasWebAppUrl: string,
  store: HistoryTargetStore,
  startDate: string,
  endDate: string,
) {
  const gasResponse = await fetch(gasWebAppUrl, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'history',
      startDate,
      endDate,
      targetStoreName: store.name,
      tenpoGroupId: store.tenpoGroupId,
      tenpoGroupName: store.tenpoGroupName,
    }),
  })

  const responseText = await gasResponse.text()
  let gasResult: GasHistoryResponse | null = null
  try {
    gasResult = JSON.parse(responseText) as GasHistoryResponse
  } catch {
    // 下の共通エラーで応答先頭を返す
  }

  if (!gasResponse.ok || !gasResult || gasResult.success === false) {
    throw new Error(
      `[${store.name}] GAS履歴取得に失敗しました: ${gasResult?.message || responseText.slice(0, 300)}`,
    )
  }

  if (gasResult.history?.success === false || !Array.isArray(gasResult.history?.data)) {
    throw new Error(
      `[${store.name}] ${gasResult.history?.message || 'GASから履歴データが返されませんでした。'}`,
    )
  }

  return gasResult.history.data
}

async function fetchTransferRows(
  supabase: SupabaseClient<Database>,
  store: HistoryTargetStore,
  startDate: string,
  endDate: string,
) {
  let query = supabase
    .from('transfers')
    .select(`
      transfer_date,
      from_store_id,
      jan_code,
      product_name,
      quantity,
      cost_price,
      total_cost,
      entry_type,
      stores!transfers_from_store_id_fkey(name)
    `)
    .in('entry_type', ['transfer', 'usage'])
    .eq('from_store_id', store.storeId)
    .order('transfer_date', { ascending: false })

  query = query
    .gte('transfer_date', startDate.replace(/\//g, '-'))
    .lte('transfer_date', endDate.replace(/\//g, '-'))

  const { data, error } = await query
  if (error) {
    throw new Error(`[${store.name}] Supabase店舗間移動履歴の取得に失敗しました: ${error.message}`)
  }

  const entryTypeLabel: Record<string, string> = {
    transfer: '店舗間移動',
    usage: '物品使用',
  }

  return (data as Array<Record<string, unknown>>).map((row) => ({
    taskDateTime: String(row.transfer_date ?? ''),
    storeName: (row.stores as { name?: string } | null)?.name ?? '',
    taskContent: entryTypeLabel[String(row.entry_type ?? '')] ?? String(row.entry_type ?? ''),
    productName: String(row.product_name ?? ''),
    productCode: String(row.jan_code ?? ''),
    quantity: Number(row.quantity ?? 0),
    cost: Number(row.cost_price ?? 0),
    totalCost: Number(row.total_cost ?? 0),
  }))
}

export async function refreshHistorySnapshot(
  supabase: SupabaseClient<Database>,
  gasWebAppUrl: string,
  store: HistoryTargetStore,
  startDate: string,
  endDate: string,
): Promise<HistorySnapshot> {
  const gasRows = await fetchGasRows(gasWebAppUrl, store, startDate, endDate)
  const transferRows = await fetchTransferRows(supabase, store, startDate, endDate)
  const rows = sortHistoryRows([...gasRows, ...transferRows])
  const fetchedAt = new Date().toISOString()

  const cachePayload = {
    store_id: store.storeId,
    start_date: startDate.replace(/\//g, '-'),
    end_date: endDate.replace(/\//g, '-'),
    history_rows: rows as unknown as Json,
    item_count: rows.length,
    gas_count: gasRows.length,
    transfer_count: transferRows.length,
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  }
  const { error } = await supabase.from('realtime_history_cache').upsert(cachePayload as never)

  if (error) {
    throw new Error(`[${store.name}] 履歴キャッシュの保存に失敗しました: ${error.message}`)
  }

  return {
    store,
    startDate,
    endDate,
    rows,
    count: rows.length,
    gasCount: gasRows.length,
    transferCount: transferRows.length,
    fetchedAt,
  }
}

export async function refreshHistorySnapshots(
  supabase: SupabaseClient<Database>,
  gasWebAppUrl: string,
  stores: HistoryTargetStore[],
  startDate: string,
  endDate: string,
) {
  const snapshots: HistorySnapshot[] = []
  for (const store of stores) {
    snapshots.push(
      await refreshHistorySnapshot(supabase, gasWebAppUrl, store, startDate, endDate),
    )
  }
  return snapshots
}

export async function readHistorySnapshots(
  supabase: SupabaseClient<Database>,
  stores: HistoryTargetStore[],
) {
  const { data, error } = await supabase
    .from('realtime_history_cache')
    .select('store_id, start_date, end_date, history_rows, item_count, gas_count, transfer_count, fetched_at')
    .in('store_id', stores.map((store) => store.storeId))

  if (error) {
    throw new Error(`保存済み履歴の取得に失敗しました: ${error.message}`)
  }

  type CacheRow = Database['public']['Tables']['realtime_history_cache']['Row']
  return ((data ?? []) as unknown as CacheRow[]).map((cacheRow) => {
    const store = stores.find((candidate) => candidate.storeId === cacheRow.store_id)
    if (!store) throw new Error('履歴キャッシュの店舗IDが不正です。')
    const rows = Array.isArray(cacheRow.history_rows)
      ? cacheRow.history_rows.filter(isHistoryRow)
      : []

    return {
      store,
      startDate: cacheRow.start_date.replace(/-/g, '/'),
      endDate: cacheRow.end_date.replace(/-/g, '/'),
      rows,
      count: cacheRow.item_count,
      gasCount: cacheRow.gas_count,
      transferCount: cacheRow.transfer_count,
      fetchedAt: cacheRow.fetched_at,
    } satisfies HistorySnapshot
  })
}

export function combineHistorySnapshots(snapshots: HistorySnapshot[]) {
  const displaySnapshots = snapshots.map((snapshot) => {
    const rows = netHistorySalesAndReturns(snapshot.rows)
    return {
      ...snapshot,
      rows,
      count: rows.length,
    }
  })

  return {
    data: sortHistoryRows(displaySnapshots.flatMap((snapshot) => snapshot.rows)),
    count: displaySnapshots.reduce((sum, snapshot) => sum + snapshot.count, 0),
    gasCount: displaySnapshots.reduce((sum, snapshot) => sum + snapshot.gasCount, 0),
    transferCount: displaySnapshots.reduce((sum, snapshot) => sum + snapshot.transferCount, 0),
    fetchedAt: displaySnapshots
      .map((snapshot) => snapshot.fetchedAt)
      .sort()
      .at(0) ?? null,
    startDate: displaySnapshots.at(0)?.startDate ?? null,
    endDate: displaySnapshots.at(0)?.endDate ?? null,
    cacheDetails: displaySnapshots.map((snapshot) => ({
      storeId: snapshot.store.storeId,
      storeName: snapshot.store.name,
      count: snapshot.count,
      fetchedAt: snapshot.fetchedAt,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
    })),
  }
}

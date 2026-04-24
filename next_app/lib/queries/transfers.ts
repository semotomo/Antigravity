import { createClient } from '@/lib/supabase/server'
import { buildJanCodeCandidates } from '@/lib/transfers'
import type {
  TransferHistoryFilter,
  TransferListRow,
  TransferProductOption,
  TransferStoreOption,
} from '@/lib/transfers'

const TRANSFER_PRODUCT_BATCH_SIZE = 1000

type BatchedQueryResult<T> = {
  data: T[] | null
  error: unknown | null
}

async function fetchAllRows<T>(
  fetchBatch: (from: number, to: number) => Promise<BatchedQueryResult<T>>,
  label: string
) {
  const rows: T[] = []
  let from = 0

  while (true) {
    const to = from + TRANSFER_PRODUCT_BATCH_SIZE - 1
    const { data, error } = await fetchBatch(from, to)

    if (error) {
      console.error(`Error fetching ${label}:`, error)
      return []
    }

    const batch = data ?? []
    rows.push(...batch)

    if (batch.length < TRANSFER_PRODUCT_BATCH_SIZE) {
      break
    }

    from += batch.length
  }

  return rows
}

function pickPreferredTransferProduct(products: TransferProductOption[]) {
  const candidates = products.filter(
    (product) => Boolean(product.product_name) && Boolean(product.jan_code)
  )

  if (candidates.length === 0) {
    return null
  }

  return [...candidates].sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1
    }

    const leftName = left.product_name ?? ''
    const rightName = right.product_name ?? ''
    const nameOrder = leftName.localeCompare(rightName, 'ja')

    if (nameOrder !== 0) {
      return nameOrder
    }

    return left.id - right.id
  })[0]
}

export async function fetchStores(): Promise<TransferStoreOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('stores').select('id, name').order('id')

  if (error) {
    console.error('Error fetching stores for transfers:', error)
    return []
  }

  return (data ?? []) as TransferStoreOption[]
}

export async function fetchTransferProducts(): Promise<TransferProductOption[]> {
  const supabase = await createClient()
  const products = await fetchAllRows<TransferProductOption>(
    async (from, to) =>
      await supabase
        .from('products')
        .select('id, jan_code, product_name, cost_price, selling_price, category, is_active')
        .order('is_active', { ascending: false })
        .order('product_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'transfer products'
  )

  return products.filter(
    (product) => Boolean(product.product_name) && Boolean(product.jan_code)
  )
}

export async function searchProductByJan(janCode: string): Promise<TransferProductOption | null> {
  const supabase = await createClient()
  const candidates = buildJanCodeCandidates(janCode)

  if (candidates.length === 0) {
    return null
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, jan_code, product_name, cost_price, selling_price, category, is_active')
    .in('jan_code', candidates)

  if (error) {
    console.error('Error searching transfer product by JAN:', error)
    return null
  }

  const exactMatch = pickPreferredTransferProduct((data ?? []) as TransferProductOption[])

  if (exactMatch) {
    return exactMatch
  }

  const allProducts = await fetchAllRows<TransferProductOption>(
    async (from, to) =>
      await supabase
        .from('products')
        .select('id, jan_code, product_name, cost_price, selling_price, category, is_active')
        .order('is_active', { ascending: false })
        .order('product_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'transfer products fallback lookup'
  )

  const candidateSet = new Set(candidates)
  return pickPreferredTransferProduct(
    allProducts.filter((product) =>
      buildJanCodeCandidates(product.jan_code ?? '').some((candidate) => candidateSet.has(candidate))
    )
  )
}

export async function fetchTransferHistory(
  filter: TransferHistoryFilter,
  limit = 500
): Promise<TransferListRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from('transfers')
    .select(
      `
        id,
        transfer_date,
        from_store_id,
        to_store_id,
        jan_code,
        product_name,
        quantity,
        cost_price,
        total_cost,
        selling_price,
        entry_type,
        usage_category,
        memo,
        created_at,
        from_store:stores!transfers_from_store_id_fkey(id, name),
        to_store:stores!transfers_to_store_id_fkey(id, name)
      `
    )
    .order('transfer_date', { ascending: false })
    .limit(limit)

  if (filter.fromStoreId) {
    query = query.eq('from_store_id', filter.fromStoreId)
  }

  if (filter.toStoreId) {
    query = query.eq('to_store_id', filter.toStoreId)
  }

  if (filter.dateFrom) {
    query = query.gte('transfer_date', `${filter.dateFrom}T00:00:00+09:00`)
  }

  if (filter.dateTo) {
    query = query.lte('transfer_date', `${filter.dateTo}T23:59:59+09:00`)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching transfer history:', error)
    return []
  }

  return (data ?? []) as TransferListRow[]
}

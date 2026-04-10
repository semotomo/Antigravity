import { createClient } from '@/lib/supabase/server'
import type {
  TransferHistoryFilter,
  TransferListRow,
  TransferProductOption,
  TransferStoreOption,
} from '@/lib/transfers'

export async function fetchStores(): Promise<TransferStoreOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('stores').select('id, name').order('id')

  if (error) {
    console.error('Error fetching stores for transfers:', error)
    return []
  }

  return (data ?? []) as TransferStoreOption[]
}

export async function fetchTransferProducts(limit = 4000): Promise<TransferProductOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, jan_code, product_name, cost_price, selling_price, category')
    .eq('is_active', true)
    .order('product_name', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Error fetching transfer products:', error)
    return []
  }

  return ((data ?? []) as TransferProductOption[]).filter(
    (product) => Boolean(product.product_name) && Boolean(product.jan_code)
  )
}

export async function searchProductByJan(janCode: string): Promise<TransferProductOption | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, jan_code, product_name, cost_price, selling_price, category')
    .eq('jan_code', janCode)
    .maybeSingle()

  if (error) {
    console.error('Error searching transfer product by JAN:', error)
    return null
  }

  return (data as TransferProductOption | null) ?? null
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

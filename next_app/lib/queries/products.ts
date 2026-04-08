import { createClient } from '@/lib/supabase/server'
import {
  buildUnmatchedProductSummaries,
  type ProductAliasListRow,
  type ProductAliasRow,
  type ProductListRow,
  type ProductOption,
  type SalesEnrichedRow,
  type UnmatchedProductSummary,
} from '@/lib/products'

const PRODUCT_BATCH_SIZE = 1000

type BatchedQueryResult<T> = {
  data: T[] | null
  error: unknown | null
}

async function fetchAllRows<T>(
  fetchBatch: (from: number, to: number) => Promise<BatchedQueryResult<T>>,
  label: string,
  limit?: number
) {
  const rows: T[] = []
  let from = 0

  while (true) {
    const remaining = typeof limit === 'number' ? limit - rows.length : PRODUCT_BATCH_SIZE

    if (remaining <= 0) {
      break
    }

    const batchSize = Math.min(PRODUCT_BATCH_SIZE, remaining)
    const to = from + batchSize - 1
    const { data, error } = await fetchBatch(from, to)

    if (error) {
      console.error(`Error fetching ${label}:`, error)
      return []
    }

    const batch = data ?? []
    rows.push(...batch)

    if (batch.length < batchSize) {
      break
    }

    from += batch.length
  }

  return rows
}

export async function fetchUnmatchedProducts(limit = 2000): Promise<UnmatchedProductSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_enriched_v')
    .select('product_name, sale_date, store_name, quantity, sales_amount, category')
    .eq('unmatched_master', true)
    .order('sale_date', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching unmatched products:', error)
    return []
  }

  return buildUnmatchedProductSummaries((data ?? []) as SalesEnrichedRow[])
}

export async function fetchActiveProducts(limit?: number): Promise<ProductOption[]> {
  const supabase = await createClient()
  const products = await fetchAllRows<ProductOption>(
    async (from, to) =>
      await supabase
        .from('products')
        .select('id, product_name, jan_code, category, selling_price, cost_price, is_active')
        .eq('is_active', true)
        .order('product_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'active products',
    limit
  )

  return products.filter((product) => Boolean(product.product_name))
}

export async function fetchProducts(limit?: number): Promise<ProductListRow[]> {
  const supabase = await createClient()

  return fetchAllRows<ProductListRow>(
    async (from, to) =>
      await supabase
        .from('products')
        .select(
          'id, jan_code, product_name, cost_price, selling_price, category, markup_rate, product_group, brand, is_active, updated_at'
        )
        .order('product_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'products',
    limit
  )
}

export async function fetchProductAliases(limit?: number): Promise<ProductAliasListRow[]> {
  const supabase = await createClient()
  const [aliases, products] = await Promise.all([
    fetchAllRows<ProductAliasRow>(
      async (from, to) =>
        await supabase
          .from('product_aliases')
          .select('id, alias_name, product_id, source_system, is_active, created_at, updated_at')
          .order('updated_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      'product aliases',
      limit
    ),
    fetchAllRows<ProductOption>(
      async (from, to) =>
        await supabase
          .from('products')
          .select('id, product_name, jan_code, category, selling_price, cost_price, is_active')
          .order('product_name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      'products for aliases'
    ),
  ])

  const productMap = new Map(products.map((product) => [product.id, product]))

  return aliases.map((alias) => ({
    ...alias,
    product: productMap.get(alias.product_id) ?? null,
  }))
}

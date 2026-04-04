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

export async function fetchActiveProducts(): Promise<ProductOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, product_name, jan_code, category, selling_price, cost_price, is_active')
    .eq('is_active', true)
    .order('product_name', { ascending: true })

  if (error) {
    console.error('Error fetching active products:', error)
    return []
  }

  return ((data ?? []) as ProductOption[]).filter((product) => Boolean(product.product_name))
}

export async function fetchProducts(limit = 2000): Promise<ProductListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, jan_code, product_name, cost_price, selling_price, category, markup_rate, product_group, brand, is_active, updated_at'
    )
    .order('product_name', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Error fetching products:', error)
    return []
  }

  return (data ?? []) as ProductListRow[]
}

export async function fetchProductAliases(limit = 2000): Promise<ProductAliasListRow[]> {
  const supabase = await createClient()
  const [{ data: aliases, error: aliasesError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase
        .from('product_aliases')
        .select('id, alias_name, product_id, source_system, is_active, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit),
      supabase
        .from('products')
        .select('id, product_name, jan_code, category, selling_price, cost_price, is_active'),
    ])

  if (aliasesError) {
    console.error('Error fetching product aliases:', aliasesError)
    return []
  }

  if (productsError) {
    console.error('Error fetching products for aliases:', productsError)
  }

  const productMap = new Map(
    (((products ?? []) as ProductOption[]).map((product) => [product.id, product]))
  )

  return ((aliases ?? []) as ProductAliasRow[]).map((alias) => ({
    ...alias,
    product: productMap.get(alias.product_id) ?? null,
  }))
}

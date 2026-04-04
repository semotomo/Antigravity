import { createClient } from '@/lib/supabase/server'
import { Database } from '../types/database'

export type SaleRow = Database['public']['Views']['sales_enriched_v']['Row']
type ProductCategoryRow = Pick<Database['public']['Tables']['products']['Row'], 'category'>

export type SalesFilter = {
  dateFrom?: string
  dateTo?: string
  storeName?: string
  category?: string
  unmatchedOnly?: boolean
}

export async function fetchSales(filter: SalesFilter): Promise<SaleRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from('sales_enriched_v')
    .select('*')
    .order('sale_date', { ascending: false })
    .order('sales_amount', { ascending: false })

  if (filter.dateFrom) query = query.gte('sale_date', filter.dateFrom)
  if (filter.dateTo) query = query.lte('sale_date', filter.dateTo)
  if (filter.storeName) query = query.eq('store_name', filter.storeName)
  if (filter.category) query = query.eq('category', filter.category)
  if (filter.unmatchedOnly) query = query.eq('unmatched_master', true)

  const { data, error } = await query
  if (error) {
    console.error('Error fetching sales:', error)
    return []
  }

  return data || []
}

function uniqueSortedValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? '')
        .filter((value): value is string => value.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right, 'ja'))
}

export async function fetchSalesFilterOptions() {
  const supabase = await createClient()

  const [
    { data: stores, error: storesError },
    { data: salesCategories, error: salesCategoriesError },
    { data: productCategories, error: productCategoriesError },
  ] = await Promise.all([
    supabase.from('sales_enriched_v').select('store_name'),
    supabase.from('sales_enriched_v').select('category'),
    supabase.from('products').select('category').eq('is_active', true),
  ])

  if (storesError) {
    console.error('Error fetching sales stores:', storesError)
  }

  if (salesCategoriesError) {
    console.error('Error fetching sales categories:', salesCategoriesError)
  }

  if (productCategoriesError) {
    console.error('Error fetching product categories:', productCategoriesError)
  }

  return {
    stores: uniqueSortedValues(
      ((stores ?? []) as Pick<SaleRow, 'store_name'>[]).map((store) => store.store_name)
    ),
    categories: uniqueSortedValues([
      ...((salesCategories ?? []) as Pick<SaleRow, 'category'>[]).map(
        (categoryRow) => categoryRow.category
      ),
      ...((productCategories ?? []) as ProductCategoryRow[]).map((product) => product.category),
    ]),
  }
}

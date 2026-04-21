import { createClient } from '@/lib/supabase/server'
import { Database } from '../types/database'

export type SaleRow = Database['public']['Views']['sales_enriched_v']['Row']
type ProductCategoryRow = Pick<Database['public']['Tables']['products']['Row'], 'category'>
type ServiceProductRow = Pick<
  Database['public']['Tables']['products']['Row'],
  'product_name' | 'product_group'
>
export type ServiceLikeCandidate = Pick<SaleRow, 'category' | 'product_group' | 'product_name'>

const SERVICE_CATEGORY = 'サービス'
const SERVICE_PRODUCT_GROUPS = new Set(['トリミング', 'オプション', '送迎', 'ホテル'])
const SERVICE_KEYWORDS = ['マイクロチップ', 'ホテル', '一時預かり', '１時間毎', '1時間毎']
const SERVICE_NAME_PATTERNS = [
  /（[CcＣｃ]）$/,
  /\([Cc]\)$/,
  /一時預かり/,
  /送迎料/,
  /保定料/,
  /爪切り/,
  /足裏バリカン/,
  /耳掃除/,
  /肛門腺/,
  /部分カット/,
  /ハミガキ/,
  /歯みがき/,
  /歯磨き/,
]
const ANIMAL_WEIGHT_SERVICE_PATTERN =
  /^(犬|ネコ|猫|ウサギ|フェレット|小動物)(?:[（(]|[\s　]|$).*(\d|[０-９]).*(kg|ｋｇ|KG|ＫＧ|㎏)/i

export type SalesFilter = {
  dateFrom?: string
  dateTo?: string
  storeName?: string
  category?: string
  excludeCategory?: string
  unmatchedOnly?: boolean
  sortOrder?: 'asc' | 'desc'
}

function normalizeServiceLabel(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, '')
}

async function fetchServiceProductNameSet() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('product_name, product_group')
    .eq('category', SERVICE_CATEGORY)
    .eq('is_active', true)

  if (error) {
    console.error('Error fetching service product names:', error)
    return new Set<string>()
  }

  return new Set(
    ((data ?? []) as ServiceProductRow[])
      .flatMap((product) => [product.product_name, product.product_group])
      .map((value) => normalizeServiceLabel(value))
      .filter((value): value is string => value.length > 0)
  )
}

export function isServiceLikeSaleRow(
  row: ServiceLikeCandidate,
  serviceProductNames: ReadonlySet<string>
) {
  const category = normalizeServiceLabel(row.category)
  const productGroup = normalizeServiceLabel(row.product_group)
  const productName = normalizeServiceLabel(row.product_name)

  if (category === SERVICE_CATEGORY) {
    return true
  }

  if (SERVICE_PRODUCT_GROUPS.has(productGroup)) {
    return true
  }

  if (productName && serviceProductNames.has(productName)) {
    return true
  }

  return (
    SERVICE_KEYWORDS.some((keyword) => productName.includes(keyword)) ||
    ANIMAL_WEIGHT_SERVICE_PATTERN.test(productName) ||
    SERVICE_NAME_PATTERNS.some((pattern) => pattern.test(productName))
  )
}

export async function applyServiceCategoryFilter<T extends ServiceLikeCandidate>(
  rows: T[],
  mode: 'include' | 'exclude'
) {
  const serviceProductNames = await fetchServiceProductNameSet()

  return rows.filter((row) => {
    const isService = isServiceLikeSaleRow(row, serviceProductNames)
    return mode === 'include' ? isService : !isService
  })
}

export async function fetchSales(filter: SalesFilter): Promise<SaleRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from('sales_enriched_v')
    .select('*')
    .order('sale_date', { ascending: filter.sortOrder === 'asc' })
    .order('sales_amount', { ascending: false })

  if (filter.dateFrom) query = query.gte('sale_date', filter.dateFrom)
  if (filter.dateTo) query = query.lte('sale_date', filter.dateTo)
  if (filter.storeName) query = query.eq('store_name', filter.storeName)
  if (filter.category && filter.category !== SERVICE_CATEGORY) query = query.eq('category', filter.category)
  if (filter.excludeCategory && filter.excludeCategory !== SERVICE_CATEGORY) {
    query = query.neq('category', filter.excludeCategory)
  }
  if (filter.unmatchedOnly) query = query.eq('unmatched_master', true)

  const { data, error } = await query
  if (error) {
    console.error('Error fetching sales:', error)
    return []
  }

  let rows = data || []

  if (filter.category === SERVICE_CATEGORY) {
    rows = await applyServiceCategoryFilter(rows, 'include')
  }

  if (filter.excludeCategory === SERVICE_CATEGORY) {
    rows = await applyServiceCategoryFilter(rows, 'exclude')
  }

  return rows
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

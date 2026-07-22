import type { Database } from '@/lib/types/database'

export type ProductRow = Database['public']['Tables']['products']['Row']
export type ProductInsert = Database['public']['Tables']['products']['Insert']
export type ProductUpdate = Database['public']['Tables']['products']['Update']
export type ProductAliasRow = Database['public']['Tables']['product_aliases']['Row']
export type ProductAliasInsert = Database['public']['Tables']['product_aliases']['Insert']
export type SalesEnrichedRow = Database['public']['Views']['sales_enriched_v']['Row']

export type ProductOption = Pick<
  ProductRow,
  'id' | 'product_name' | 'jan_code' | 'category' | 'selling_price' | 'cost_price' | 'is_active'
>

export type ProductListRow = ProductRow

export type ProductAliasListRow = ProductAliasRow & {
  product: Pick<ProductRow, 'id' | 'product_name' | 'jan_code' | 'category' | 'is_active'> | null
}

export type UnmatchedProductSummary = {
  posProductName: string
  occurrenceCount: number
  totalQuantity: number
  totalSalesAmount: number
  lastSaleDate: string
  storeNames: string[]
  categoryHints: string[]
}

export type ProductActionField =
  | 'alias_name'
  | 'product_id'
  | 'product_name'
  | 'jan_code'
  | 'category'
  | 'product_group'
  | 'brand'
  | 'supplier_name'
  | 'cost_price'
  | 'selling_price'
  | 'is_active'
  | 'tags'

export type ProductMutationState = {
  status: 'idle' | 'success' | 'error'
  message: string
  fieldErrors: Partial<Record<ProductActionField, string>>
}

export const initialProductMutationState: ProductMutationState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
}

export function normalizeOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

export function formatYen(value: number | null | undefined) {
  return `¥${(value ?? 0).toLocaleString('ja-JP')}`
}

export function formatProductMarkupRate(value: number | null | undefined) {
  return `${(((value ?? 0) * 10000) / 100).toFixed(1)}%`
}

export function formatProductDateTime(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function buildUnmatchedProductSummaries(rows: SalesEnrichedRow[]) {
  const buckets = new Map<string, UnmatchedProductSummary>()

  rows.forEach((row) => {
    const productName = row.product_name.trim()
    if (!productName) {
      return
    }

    const current = buckets.get(productName) ?? {
      posProductName: productName,
      occurrenceCount: 0,
      totalQuantity: 0,
      totalSalesAmount: 0,
      lastSaleDate: row.sale_date,
      storeNames: [],
      categoryHints: [],
    }

    current.occurrenceCount += 1
    current.totalQuantity += row.quantity ?? 0
    current.totalSalesAmount += row.sales_amount ?? 0

    if (!current.lastSaleDate || row.sale_date > current.lastSaleDate) {
      current.lastSaleDate = row.sale_date
    }

    if (row.store_name && !current.storeNames.includes(row.store_name)) {
      current.storeNames.push(row.store_name)
    }

    if (row.category && !current.categoryHints.includes(row.category)) {
      current.categoryHints.push(row.category)
    }

    buckets.set(productName, current)
  })

  return Array.from(buckets.values()).sort((left, right) => {
    if (right.occurrenceCount !== left.occurrenceCount) {
      return right.occurrenceCount - left.occurrenceCount
    }

    return right.lastSaleDate.localeCompare(left.lastSaleDate)
  })
}

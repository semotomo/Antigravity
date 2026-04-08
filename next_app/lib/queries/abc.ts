import { createClient } from '@/lib/supabase/server'
import type { ProductSummaryRow } from '@/lib/queries/summary'

export type AbcRank = 'A' | 'B' | 'C'

export type AbcAnalysisRow = {
  key: string
  jan_code: string
  product_name: string
  category: string
  total_quantity: number
  total_sales_amount: number
  estimated_profit: number
  salesShare: number
  cumulativeSalesShare: number
  rank: AbcRank
}

function buildGroupKey(row: ProductSummaryRow) {
  return [row.product_id ?? 'unknown', row.jan_code, row.product_name].join(':')
}

function resolveRank(cumulativeSalesShare: number): AbcRank {
  if (cumulativeSalesShare <= 0.7) {
    return 'A'
  }

  if (cumulativeSalesShare <= 0.9) {
    return 'B'
  }

  return 'C'
}

export async function fetchAbcAnalysis(
  dateFrom: string,
  dateTo: string,
  storeName?: string
): Promise<AbcAnalysisRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from('sales_product_summary_v')
    .select('*')
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)

  if (storeName) {
    query = query.eq('store_name', storeName)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching ABC analysis source data:', error)
    return []
  }

  const grouped = new Map<string, AbcAnalysisRow>()

  for (const row of (data ?? []) as ProductSummaryRow[]) {
    const key = buildGroupKey(row)
    const current =
      grouped.get(key) ??
      ({
        key,
        jan_code: row.jan_code,
        product_name: row.product_name,
        category: row.category,
        total_quantity: 0,
        total_sales_amount: 0,
        estimated_profit: 0,
        salesShare: 0,
        cumulativeSalesShare: 0,
        rank: 'C',
      } satisfies AbcAnalysisRow)

    current.total_quantity += row.total_quantity ?? 0
    current.total_sales_amount += row.total_sales_amount ?? 0
    current.estimated_profit += row.estimated_profit ?? 0
    grouped.set(key, current)
  }

  const rows = Array.from(grouped.values()).sort(
    (left, right) => right.total_sales_amount - left.total_sales_amount
  )
  const totalSales = rows.reduce((sum, row) => sum + row.total_sales_amount, 0)

  let cumulativeSales = 0

  return rows.map((row) => {
    cumulativeSales += row.total_sales_amount
    const salesShare = totalSales > 0 ? row.total_sales_amount / totalSales : 0
    const cumulativeSalesShare = totalSales > 0 ? cumulativeSales / totalSales : 0

    return {
      ...row,
      salesShare,
      cumulativeSalesShare,
      rank: resolveRank(cumulativeSalesShare),
    }
  })
}

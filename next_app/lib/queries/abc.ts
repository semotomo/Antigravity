import { createClient } from '@/lib/supabase/server'
import type { ProductSummaryRow } from '@/lib/queries/summary'
import { applyServiceCategoryFilter } from '@/lib/queries/sales'

export type AbcRank = 'A' | 'B' | 'C'

export type AbcAnalysisRow = {
  key: string
  label: string
  jan_code: string
  category: string
  total_quantity: number
  total_sales_amount: number
  estimated_profit: number
  salesShare: number
  cumulativeSalesShare: number
  rank: AbcRank
}

function normalizeCategory(category: string | null | undefined) {
  const text = category?.trim() ?? ''
  return text.length > 0 ? text : '未分類'
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
  storeName?: string,
  category?: string,
  excludeCategory?: string,
  searchQuery?: string,
  target: 'amount' | 'quantity' = 'quantity'
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

  if (category && category !== 'サービス') {
    query = query.eq('category', category)
  }

  if (excludeCategory && excludeCategory !== 'サービス') {
    query = query.neq('category', excludeCategory)
  }

  if (searchQuery) {
    // 商品名またはJANコードの部分一致
    query = query.or(`product_name.ilike.%${searchQuery}%,jan_code.ilike.%${searchQuery}%`)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching ABC analysis source data:', error)
    return []
  }

  let sourceRows = (data ?? []) as ProductSummaryRow[]

  if (category === 'サービス') {
    sourceRows = await applyServiceCategoryFilter(sourceRows, 'include')
  }

  if (excludeCategory === 'サービス') {
    sourceRows = await applyServiceCategoryFilter(sourceRows, 'exclude')
    // さらに「未分類」（null, 空文字, または '未分類'）も除外
    sourceRows = sourceRows.filter((row) => {
      const cat = row.category?.trim() ?? ''
      return cat.length > 0 && cat !== '未分類'
    })
  }

  const grouped = new Map<string, AbcAnalysisRow>()

  for (const row of sourceRows) {
    const key = buildGroupKey(row)
    const current =
      grouped.get(key) ??
      ({
        key,
        label: row.product_name?.trim() || '商品名未設定',
        jan_code: row.jan_code?.trim() ?? '',
        category: normalizeCategory(row.category),
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

  // ターゲット（金額 or 数量）に応じてソート順を切り替える
  const rows = Array.from(grouped.values()).sort(
    (left, right) => {
      if (target === 'amount') {
        return right.total_sales_amount - left.total_sales_amount
      } else {
        return right.total_quantity - left.total_quantity
      }
    }
  )

  // ターゲットに応じた総計を算出
  const totalValue = rows.reduce((sum, row) => {
    return sum + (target === 'amount' ? row.total_sales_amount : row.total_quantity)
  }, 0)

  let cumulativeValue = 0

  return rows.map((row) => {
    const currentValue = target === 'amount' ? row.total_sales_amount : row.total_quantity
    cumulativeValue += currentValue
    const salesShare = totalValue > 0 ? currentValue / totalValue : 0
    const cumulativeSalesShare = totalValue > 0 ? cumulativeValue / totalValue : 0

    return {
      ...row,
      salesShare,
      cumulativeSalesShare,
      rank: resolveRank(cumulativeSalesShare),
    }
  })
}

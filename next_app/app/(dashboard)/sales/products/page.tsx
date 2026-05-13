import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { type ProductSummaryRow } from '@/lib/queries/summary'
import { fetchSales } from '@/lib/queries/sales'

export const metadata = {
  title: '商品別トレンド（今月） | Kennel Dashboard',
}

function getStartOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default async function ProductSummaryPage() {
  const startOfMonth = getStartOfMonth()
  const sales = await fetchSales({ dateFrom: startOfMonth })

  // Aggregate sales into ProductSummaryRow format
  const summaryMap = new Map<string, ProductSummaryRow>()

  for (const row of sales) {
    const key = `${row.product_name}-${row.jan_code}`
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        category: row.category,
        product_name: row.product_name,
        brand: row.brand || null,
        jan_code: row.jan_code,
        unmatched_master: row.unmatched_master,
        total_quantity: 0,
        total_sales_amount: 0,
        estimated_profit: 0,
      } as unknown as ProductSummaryRow)
    }

    const item = summaryMap.get(key)!
    item.total_quantity = (item.total_quantity || 0) + (row.quantity || 0)
    item.total_sales_amount = (item.total_sales_amount || 0) + (row.sales_amount || 0)
    // We do not have estimated_profit from sale directly, so we mock or calculate roughly if cost is available.
    // For now, let's leave it as 0 unless we know markup_rate.
  }

  const data = Array.from(summaryMap.values())
    .sort((a, b) => (b.total_sales_amount || 0) - (a.total_sales_amount || 0))

  const columns: DataTableColumn<ProductSummaryRow>[] = [
    { key: 'category', header: 'カテゴリ' },
    { 
      key: 'product_name', 
      header: '商品情報',
      render: (item) => (
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-2">
            {item.product_name}
            {item.unmatched_master && (
              <StatusBadge variant="danger">! 未紐付</StatusBadge>
            )}
          </div>
          <div className="text-xs text-gray-500">
            {item.brand && <span>{item.brand} | </span>}
            JAN: {item.jan_code || '-'}
          </div>
        </div>
      )
    },
    { 
      key: 'total_quantity', 
      header: '累計販売数', 
      align: 'right' as const,
      render: (item) => <span className="font-medium">{item.total_quantity?.toLocaleString()}</span>
    },
    { 
      key: 'total_sales_amount', 
      header: '累計売上', 
      align: 'right' as const,
      render: (item) => (
        <span className="font-semibold text-gray-900">
          ¥{item.total_sales_amount?.toLocaleString()}
        </span>
      )
    },
    { 
      key: 'estimated_profit', 
      header: '粗利見込', 
      align: 'right' as const,
      render: (item) => (
        <span
          className={(item.estimated_profit ?? 0) > 0 ? 'text-green-600' : 'text-gray-500'}
        >
          ¥{item.estimated_profit?.toLocaleString() ?? '0'}
        </span>
      )
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">商品別トレンド（今月）</h1>
        <p className="text-sm text-gray-500 mt-1">今月（{startOfMonth} 以降）の商品別売上ランキングです。</p>
      </div>

      <DataTable 
        data={data} 
        columns={columns} 
        keyExtractor={(item, idx) => `${item.product_name}-${idx}`}
      />
    </div>
  )
}

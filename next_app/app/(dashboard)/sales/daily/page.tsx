import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { fetchDailySummary, type DailySummaryRow } from '@/lib/queries/summary'

  export const metadata = {
  title: '日次集計 | Kennel Dashboard',
}

export default async function DailySummaryPage() {
  const data = await fetchDailySummary()

  const columns: DataTableColumn<DailySummaryRow>[] = [
    { key: 'sale_date', header: '営業日', align: 'left' as const },
    { key: 'store_name', header: '店舗', align: 'left' as const },
    { 
      key: 'total_quantity', 
      header: '総販売数', 
      align: 'right' as const,
      render: (item) => item.total_quantity?.toLocaleString() ?? '0'
    },
    { 
      key: 'product_count', 
      header: '販売商品種類数', 
      align: 'right' as const,
      render: (item) => `${item.product_count?.toLocaleString()} 品`
    },
    { 
      key: 'total_sales_amount', 
      header: '総売上金額', 
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">日次集計</h1>
        <p className="text-sm text-gray-500 mt-1">店舗ごとの日別の売上サマリーです。</p>
      </div>

      <DataTable 
        data={data} 
        columns={columns} 
        keyExtractor={(item, idx) => `${item.sale_date}-${item.store_name}-${idx}`}
      />
    </div>
  )
}

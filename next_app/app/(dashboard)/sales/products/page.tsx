import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { fetchProductSummary, type ProductSummaryRow } from '@/lib/queries/summary'

export const metadata = {
  title: '商品別集計 | Kennel Dashboard',
}

export default async function ProductSummaryPage() {
  const data = await fetchProductSummary()

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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">商品別集計</h1>
        <p className="text-sm text-gray-500 mt-1">集計された全期間での商品別売上ランキングです。</p>
      </div>

      <DataTable 
        data={data} 
        columns={columns} 
        keyExtractor={(item, idx) => `${item.product_name}-${idx}`}
      />
    </div>
  )
}

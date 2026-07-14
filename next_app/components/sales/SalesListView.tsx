'use client'

import { useState } from 'react'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ProductSalesTrendsModal } from '@/components/sales/ProductSalesTrendsModal'
import type { SaleRow } from '@/lib/queries/sales'

type SalesListViewProps = {
  salesData: SaleRow[]
}

export function SalesListView({ salesData }: SalesListViewProps) {
  const [selectedProduct, setSelectedProduct] = useState<{
    janCode: string | null
    productName: string
  } | null>(null)

  const columns: DataTableColumn<SaleRow>[] = [
    { key: 'sale_date', header: '日付' },
    { key: 'store_name', header: '店舗名' },
    { key: 'category', header: 'カテゴリ' },
    {
      key: 'product_name',
      header: '商品名 (クリックで過去売上推移を表示)',
      render: (item) => (
        <div className="flex flex-col">
          <button
            onClick={() => setSelectedProduct({ janCode: item.jan_code, productName: item.product_name })}
            className="font-semibold text-left text-gray-900 hover:text-indigo-600 hover:underline transition"
          >
            {item.product_name}
          </button>
          <span className="text-xs text-gray-500">JAN: {item.jan_code || '-'}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: '数量',
      align: 'right',
      render: (item) => item.quantity.toLocaleString(),
    },
    {
      key: 'sales_amount',
      header: '売上金額',
      align: 'right',
      render: (item) => `¥${item.sales_amount.toLocaleString()}`,
    },
    {
      key: 'status',
      header: '紐付け状態',
      align: 'center',
      render: (item) => {
        if (item.unmatched_master) {
          return <StatusBadge variant="danger">未紐付け</StatusBadge>
        }

        if (item.match_source === 'alias') {
          return <StatusBadge variant="info">エイリアス</StatusBadge>
        }

        return <StatusBadge variant="success">直接一致</StatusBadge>
      },
    },
  ]

  return (
    <>
      <DataTable
        data={salesData}
        columns={columns}
        keyExtractor={(item) => String(item.sales_row_id)}
        emptyMessage="条件に一致する売上が見つかりませんでした。"
        rowClassName={(item) => (item.unmatched_master ? 'bg-red-50 hover:bg-red-100' : '')}
      />

      <ProductSalesTrendsModal
        isOpen={selectedProduct !== null}
        onClose={() => setSelectedProduct(null)}
        janCode={selectedProduct?.janCode}
        productName={selectedProduct?.productName || ''}
      />
    </>
  )
}

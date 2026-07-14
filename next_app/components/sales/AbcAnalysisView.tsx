'use client'

import { useState } from 'react'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ProductSalesTrendsModal } from '@/components/sales/ProductSalesTrendsModal'
import type { AbcAnalysisRow } from '@/lib/queries/abc'

type AbcAnalysisViewProps = {
  rows: AbcAnalysisRow[]
}

export function AbcAnalysisView({ rows }: AbcAnalysisViewProps) {
  const [selectedProduct, setSelectedProduct] = useState<{
    janCode: string | null
    productName: string
  } | null>(null)

  const columns: DataTableColumn<AbcAnalysisRow>[] = [
    {
      key: 'rank',
      header: 'ランク',
      align: 'center',
      render: (item) => (
        <StatusBadge
          variant={item.rank === 'A' ? 'success' : item.rank === 'B' ? 'info' : 'warning'}
        >
          {item.rank}
        </StatusBadge>
      ),
    },
    {
      key: 'label',
      header: '商品 (クリックで過去売上推移を表示)',
      render: (item) => (
        <div className="min-w-[240px]">
          <button
            onClick={() => setSelectedProduct({ janCode: item.jan_code, productName: item.label })}
            className="font-semibold text-left text-gray-900 hover:text-indigo-600 hover:underline transition"
          >
            {item.label}
          </button>
          <p className="mt-1 text-xs text-gray-500">
            JAN: {item.jan_code || '-'} / カテゴリ: {item.category || '-'}
          </p>
        </div>
      ),
    },
    {
      key: 'total_quantity',
      header: '販売数',
      align: 'right',
      render: (item) => item.total_quantity.toLocaleString('ja-JP'),
    },
    {
      key: 'total_sales_amount',
      header: '売上金額',
      align: 'right',
      render: (item) => `¥${item.total_sales_amount.toLocaleString('ja-JP')}`,
    },
    {
      key: 'estimated_profit',
      header: '粗利見込',
      align: 'right',
      render: (item) => `¥${item.estimated_profit.toLocaleString('ja-JP')}`,
    },
    {
      key: 'salesShare',
      header: '売上構成比',
      align: 'right',
      render: (item) => `${(item.salesShare * 100).toFixed(1)}%`,
    },
    {
      key: 'cumulativeSalesShare',
      header: '累積構成比',
      align: 'right',
      render: (item) => `${(item.cumulativeSalesShare * 100).toFixed(1)}%`,
    },
  ]

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(item) => item.key}
        emptyMessage="指定期間に集計できる商品データが見つかりませんでした。"
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

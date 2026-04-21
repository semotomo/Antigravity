'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { Search, SquarePen } from 'lucide-react'
import { JanCodeScannerField } from '@/components/orders/JanCodeScannerField'
import { ProductFormModal } from '@/components/products/ProductFormModal'
import { ProductsSubnav } from '@/components/products/ProductsSubnav'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  formatProductDateTime,
  formatProductMarkupRate,
  formatYen,
  type ProductListRow,
} from '@/lib/products'

type ProductsBoardProps = {
  products: ProductListRow[]
}

type DialogState = {
  product: ProductListRow
  nonce: number
} | null

function buildSearchText(product: ProductListRow) {
  return [
    product.product_name ?? '',
    product.jan_code ?? '',
    product.category ?? '',
    product.product_group ?? '',
    product.brand ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

export function ProductsBoard({ products }: ProductsBoardProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const filteredProducts = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()

    if (!normalized) {
      return products
    }

    return products.filter((product) => buildSearchText(product).includes(normalized))
  }, [deferredQuery, products])

  const counts = useMemo(
    () => ({
      total: products.length,
      active: products.filter((product) => product.is_active).length,
      inactive: products.filter((product) => !product.is_active).length,
    }),
    [products]
  )

  const columns: DataTableColumn<ProductListRow>[] = [
    {
      key: 'jan_code',
      header: 'JAN',
      render: (product) => product.jan_code || '-',
    },
    {
      key: 'product_name',
      header: '商品情報',
      render: (product) => (
        <div className="min-w-[240px]">
          <p className="font-semibold text-gray-900">{product.product_name ?? '商品名未設定'}</p>
          <p className="mt-1 text-xs text-gray-500">
            {product.category || 'カテゴリ未設定'}
            {product.product_group ? ` / ${product.product_group}` : ''}
            {product.brand ? ` / ${product.brand}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'pricing',
      header: '価格',
      render: (product) => (
        <div className="space-y-1 text-sm">
          <p className="text-gray-700">原価 {formatYen(product.cost_price)}</p>
          <p className="font-semibold text-gray-900">売価 {formatYen(product.selling_price)}</p>
          <p className="text-xs text-gray-500">
            粗利率 {formatProductMarkupRate(product.markup_rate)}
          </p>
        </div>
      ),
      align: 'right',
    },
    {
      key: 'status',
      header: '状態',
      align: 'center',
      render: (product) => (
        <StatusBadge variant={product.is_active ? 'success' : 'gray'}>
          {product.is_active ? '有効' : '停止'}
        </StatusBadge>
      ),
    },
    {
      key: 'updated_at',
      header: '更新日',
      render: (product) => formatProductDateTime(product.updated_at),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'center',
      render: (product) => (
        <button
          type="button"
          onClick={() =>
            setDialogState({
              product,
              nonce: Date.now(),
            })
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <SquarePen className="h-4 w-4" />
          編集
        </button>
      ),
    },
  ]

  return (
    <>
      <div className="space-y-6">
        <ProductsSubnav />

        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-sky-700 px-6 py-7 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200">
              Product Master
            </p>
            <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">商品マスタ</h1>
                <p className="mt-2 max-w-2xl text-sm text-sky-50/90">
                  売上分析やエイリアス解決で使う商品マスタを一覧で確認し、価格やステータスを編集します。
                </p>
              </div>
              <div className="rounded-3xl bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100">
                  表示件数
                </p>
                <p className="mt-2 text-2xl font-bold">{filteredProducts.length}</p>
                <p className="text-xs text-sky-50/90">検索条件に一致した商品</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                総商品数
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.total}</p>
              <p className="mt-1 text-sm text-gray-500">停止中の商品も含みます</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                有効
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.active}</p>
              <p className="mt-1 text-sm text-gray-500">通常運用中の商品</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                停止中
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.inactive}</p>
              <p className="mt-1 text-sm text-gray-500">販売停止や整理対象の商品</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-gray-700">商品を検索</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="商品名 / JAN / カテゴリ / ブランド"
                    className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                  />
                </div>
              </label>
              <JanCodeScannerField
                label="JANコード検索"
                showInput={false}
                wrapperClassName="space-y-2"
                helpText="読み取ったJAN / UPCコードで商品を絞り込みます。"
                onValueChange={(value) => setQuery(value)}
              />
            </div>
          </div>

          <DataTable
            data={filteredProducts}
            columns={columns}
            keyExtractor={(product) => String(product.id)}
            emptyMessage="条件に一致する商品が見つかりませんでした。"
          />
        </section>
      </div>

      {dialogState ? (
        <ProductFormModal
          key={`${dialogState.product.id}-${dialogState.nonce}`}
          open
          product={dialogState.product}
          onClose={() => setDialogState(null)}
        />
      ) : null}
    </>
  )
}

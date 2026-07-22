'use client'

import { useEffect, useState } from 'react'
import { Search, SquarePen, Loader2 } from 'lucide-react'
import { JanCodeScannerField } from '@/components/orders/JanCodeScannerField'
import { ProductFormModal } from '@/components/products/ProductFormModal'
import { ProductsSubnav } from '@/components/products/ProductsSubnav'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { BarcodeToggle } from '@/components/ui/BarcodeToggle'
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

export function ProductsBoard({ products: _initialProducts }: ProductsBoardProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  // 300ms のデバウンス付きでサーバーサイド検索APIを呼び出す
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(trimmed)}`)
        if (res.ok) {
          const result = await res.json()
          if (result.success && Array.isArray(result.data)) {
            setResults(result.data)
          }
        }
      } catch (e) {
        console.error('商品検索エラー:', e)
      } finally {
        setLoading(false)
      }
    }, 300) // 300ms デバウンス

    return () => clearTimeout(timer)
  }, [query])

  const columns: DataTableColumn<ProductListRow>[] = [
    {
      key: 'jan_code',
      header: 'JAN',
      render: (product) => <BarcodeToggle janCode={product.jan_code} />,
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
      key: 'supplier_name',
      header: '仕入れ先',
      render: (product) => (
        <span className="text-sm font-medium text-gray-700">
          {product.supplier_name || '-'}
        </span>
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
      key: 'tags',
      header: 'タグ',
      render: (product) => {
        if (!product.tags) return <span className="text-gray-400 text-xs">-</span>
        return (
          <div className="flex flex-wrap gap-1">
            {product.tags.split(',').map((tag) => (
              <span key={tag} className="inline-flex items-center rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-700/10">
                {tag.trim()}
              </span>
            ))}
          </div>
        )
      },
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
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">商品マスタ</h1>
                <p className="mt-2 max-w-2xl text-sm text-sky-50/90">
                  売上分析やエイリアス解決で使う商品マスタをデータベースから高速検索し、編集します。
                </p>
              </div>
              <div className="rounded-3xl bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100">
                  ヒット件数
                </p>
                <p className="mt-2 text-2xl font-bold">{results.length}</p>
                <p className="text-xs text-sky-50/90">現在表示中の商品数</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">商品を検索</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="商品名 / JAN / カテゴリ / ブランド を入力して検索"
                  className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-36 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {loading && (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-600 animate-pulse" />
                  )}
                  <JanCodeScannerField
                    buttonOnly={true}
                    wrapperClassName="shrink-0"
                    onValueChange={(value) => setQuery(value)}
                  />
                </div>
              </div>
            </label>
          </div>

          {query.trim() === '' ? (
            <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                <Search className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-gray-900">商品を検索してください</h2>
              <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
                上部の検索窓に「商品名」「JANコード」「カテゴリ」などを入力すると、データベースから高速に検索して結果を表示します。
              </p>
            </div>
          ) : (
            <DataTable
              data={results}
              columns={columns}
              keyExtractor={(product) => String(product.id)}
              emptyMessage={loading ? '検索中...' : '条件に一致する商品が見つかりませんでした。'}
            />
          )}
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

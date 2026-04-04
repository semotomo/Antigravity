'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, TrendingUp } from 'lucide-react'
import { ProductsSubnav } from '@/components/products/ProductsSubnav'
import { ResolveMatchPanel } from '@/components/products/ResolveMatchPanel'
import { UnmatchedList } from '@/components/products/UnmatchedList'
import {
  formatYen,
  type ProductOption,
  type UnmatchedProductSummary,
} from '@/lib/products'

type UnmatchedBoardProps = {
  unmatchedProducts: UnmatchedProductSummary[]
  products: ProductOption[]
}

export function UnmatchedBoard({
  unmatchedProducts,
  products,
}: UnmatchedBoardProps) {
  const [selectedName, setSelectedName] = useState(
    unmatchedProducts[0]?.posProductName ?? ''
  )

  const effectiveSelectedName = unmatchedProducts.some(
    (item) => item.posProductName === selectedName
  )
    ? selectedName
    : unmatchedProducts[0]?.posProductName ?? ''

  const selectedProduct = useMemo(
    () =>
      unmatchedProducts.find((item) => item.posProductName === effectiveSelectedName) ??
      unmatchedProducts[0] ??
      null,
    [effectiveSelectedName, unmatchedProducts]
  )

  const totals = useMemo(() => {
    return unmatchedProducts.reduce(
      (accumulator, item) => {
        accumulator.occurrences += item.occurrenceCount
        accumulator.salesAmount += item.totalSalesAmount
        accumulator.quantity += item.totalQuantity
        return accumulator
      },
      {
        occurrences: 0,
        salesAmount: 0,
        quantity: 0,
      }
    )
  }, [unmatchedProducts])

  if (unmatchedProducts.length === 0) {
    return (
      <div className="space-y-6">
        <ProductsSubnav />

        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-lime-500 px-6 py-8 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-100">
              Product Matching
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">未一致商品の解消</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50/90">
              いま未一致の商品はありません。売上データと商品マスタの紐付けは整っています。
            </p>
          </div>

          <div className="px-6 py-12 text-center">
            <Boxes className="mx-auto h-10 w-10 text-emerald-500" />
            <h2 className="mt-4 text-xl font-semibold text-gray-900">すべて解消済みです</h2>
            <p className="mt-2 text-sm text-gray-500">
              新しい未一致商品が発生した場合は、この画面に自動で表示されます。
            </p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ProductsSubnav />

      <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-amber-500 px-6 py-7 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-100">
            Phase 2
          </p>
          <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">未一致商品の解消</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-100/90">
                POS から流入した未一致商品を既存マスタへ紐付けるか、新規商品として登録して即時に解消します。
              </p>
            </div>
            <div className="rounded-3xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-100">
                検索候補
              </p>
              <p className="mt-2 text-2xl font-bold">{products.length}</p>
              <p className="text-xs text-amber-50/90">既存の有効商品マスタ</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              未一致商品名
            </p>
            <p className="mt-3 text-3xl font-bold text-gray-900">{unmatchedProducts.length}</p>
            <p className="mt-1 text-sm text-gray-500">POS 名単位で集約した残件数</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              未一致売上行
            </p>
            <p className="mt-3 text-3xl font-bold text-gray-900">{totals.occurrences}</p>
            <p className="mt-1 text-sm text-gray-500">解消すると売上一覧の未一致表示が消えます</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              関連売上
            </p>
            <p className="mt-3 text-3xl font-bold text-gray-900">{formatYen(totals.salesAmount)}</p>
            <p className="mt-1 text-sm text-gray-500">数量 {totals.quantity} / 集計対象の売上総額</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                同じ POS 名が複数店舗で使われている場合も、1 回の紐付けでまとめて解消されます。
              </p>
            </div>
          </div>
          <UnmatchedList
            items={unmatchedProducts}
            selectedName={selectedProduct?.posProductName ?? ''}
            onSelect={setSelectedName}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-4 w-4 text-emerald-600" />
              <p className="text-sm text-gray-600">
                既存商品に寄せられるものは Pattern A、新しいサービスや独立商品は Pattern B で処理すると運用が安定します。
              </p>
            </div>
          </div>

          <ResolveMatchPanel
            key={selectedProduct?.posProductName ?? 'empty'}
            selected={selectedProduct}
            products={products}
          />
        </div>
      </div>
    </div>
  )
}

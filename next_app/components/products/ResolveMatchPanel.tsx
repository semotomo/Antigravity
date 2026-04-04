'use client'

import { useActionState, useDeferredValue, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  ArrowRightLeft,
  CheckCircle2,
  CirclePlus,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  createNewProductAndMatchAction,
  matchToExistingProductAction,
} from '@/app/actions/products'
import {
  formatYen,
  initialProductMutationState,
  type ProductMutationState,
  type ProductOption,
  type UnmatchedProductSummary,
} from '@/lib/products'

type ResolveMatchPanelProps = {
  selected: UnmatchedProductSummary | null
  products: ProductOption[]
}

type ResolveMode = 'existing' | 'create'

function formatDate(date: string) {
  if (!date) {
    return '-'
  }

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date))
}

function buildSuggestedSellingPrice(item: UnmatchedProductSummary) {
  if (!item.totalQuantity) {
    return 0
  }

  return Math.max(0, Math.round(item.totalSalesAmount / item.totalQuantity))
}

function SubmitButton({
  label,
  disabled = false,
}: {
  label: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
    >
      {pending ? '保存中...' : label}
    </button>
  )
}

function StateMessage({ state }: { state: ProductMutationState }) {
  if (!state.message) {
    return null
  }

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        state.status === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {state.message}
    </div>
  )
}

function ProductOptionCard({ product }: { product: ProductOption }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <p className="font-semibold text-gray-900">{product.product_name ?? '商品名未設定'}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
          JAN: {product.jan_code || '-'}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
          区分: {product.category || '-'}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
          原価 {formatYen(product.cost_price ?? 0)}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
          売価 {formatYen(product.selling_price ?? 0)}
        </span>
      </div>
    </div>
  )
}

function ExistingMatchForm({
  selected,
  products,
}: {
  selected: UnmatchedProductSummary
  products: ProductOption[]
}) {
  const [state, formAction] = useActionState(
    matchToExistingProductAction,
    initialProductMutationState
  )
  const [query, setQuery] = useState(selected.posProductName)
  const deferredQuery = useDeferredValue(query)

  const filteredProducts = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    const fallback = selected.posProductName.toLowerCase()
    const terms = (normalized || fallback).split(/\s+/).filter(Boolean)

    const ranked = products.map((product) => {
      const haystack = [
        product.product_name ?? '',
        product.jan_code ?? '',
        product.category ?? '',
      ]
        .join(' ')
        .toLowerCase()

      let score = 0
      terms.forEach((term) => {
        if (haystack.startsWith(term)) {
          score += 6
        } else if (haystack.includes(term)) {
          score += 3
        }
      })

      if ((product.product_name ?? '').toLowerCase() === selected.posProductName.toLowerCase()) {
        score += 8
      }

      return { product, score }
    })

    return ranked
      .filter((entry) => entry.score > 0 || !normalized)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }

        return (left.product.product_name ?? '').localeCompare(right.product.product_name ?? '')
      })
      .slice(0, 40)
      .map((entry) => entry.product)
  }, [deferredQuery, products, selected.posProductName])

  const [selectedProductId, setSelectedProductId] = useState(() => {
    const firstProduct = filteredProducts[0]
    return firstProduct ? String(firstProduct.id) : ''
  })
  const effectiveSelectedProductId = filteredProducts.some(
    (product) => String(product.id) === selectedProductId
  )
    ? selectedProductId
    : filteredProducts[0]
      ? String(filteredProducts[0].id)
      : ''

  const selectedProduct = useMemo(
    () =>
      filteredProducts.find((product) => String(product.id) === effectiveSelectedProductId) ??
      null,
    [effectiveSelectedProductId, filteredProducts]
  )

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="alias_name" value={selected.posProductName} />

      <div className="rounded-3xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
              Pattern A
            </p>
            <h3 className="mt-2 text-lg font-bold text-gray-900">既存マスタへ紐付ける</h3>
            <p className="mt-2 text-sm text-gray-500">
              POS 名「{selected.posProductName}」を、既存の `products` レコードへ別名登録します。
            </p>
          </div>
          <ArrowRightLeft className="h-5 w-5 text-gray-400" />
        </div>

        <div className="mt-4 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-gray-700">候補を検索</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="商品名 / JAN / 区分で絞り込み"
                className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
            </div>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-gray-700">紐付け先商品</span>
            <select
              name="product_id"
              value={effectiveSelectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              className="w-full rounded-2xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            >
              <option value="">商品を選択してください</option>
              {filteredProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name ?? '商品名未設定'}
                  {product.category ? ` / ${product.category}` : ''}
                  {product.jan_code ? ` / JAN:${product.jan_code}` : ''}
                </option>
              ))}
            </select>
            {state.fieldErrors.product_id ? (
              <span className="text-xs text-red-600">{state.fieldErrors.product_id}</span>
            ) : null}
          </label>

          {selectedProduct ? <ProductOptionCard product={selectedProduct} /> : null}

          {filteredProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
              条件に合う商品が見つかりません。新規作成タブに切り替えて商品マスタを作成できます。
            </div>
          ) : null}
        </div>
      </div>

      <StateMessage state={state} />

      <div className="flex justify-end">
        <SubmitButton label="既存商品へ紐付ける" disabled={!effectiveSelectedProductId} />
      </div>
    </form>
  )
}

function CreateProductForm({ selected }: { selected: UnmatchedProductSummary }) {
  const [state, formAction] = useActionState(
    createNewProductAndMatchAction,
    initialProductMutationState
  )
  const suggestedSellingPrice = buildSuggestedSellingPrice(selected)

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="alias_name" value={selected.posProductName} />

      <div className="rounded-3xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
              Pattern B
            </p>
            <h3 className="mt-2 text-lg font-bold text-gray-900">新規商品を作成して紐付ける</h3>
            <p className="mt-2 text-sm text-gray-500">
              商品マスタを新規作成し、同時に POS 名「{selected.posProductName}」を別名登録します。
            </p>
          </div>
          <CirclePlus className="h-5 w-5 text-emerald-500" />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-gray-700">商品名 *</span>
            <input
              name="product_name"
              required
              defaultValue={selected.posProductName}
              className="w-full rounded-2xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
            {state.fieldErrors.product_name ? (
              <span className="text-xs text-red-600">{state.fieldErrors.product_name}</span>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">JAN コード</span>
            <input
              name="jan_code"
              inputMode="numeric"
              placeholder="未設定なら空欄"
              className="w-full rounded-2xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
            {state.fieldErrors.jan_code ? (
              <span className="text-xs text-red-600">{state.fieldErrors.jan_code}</span>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">区分</span>
            <input
              name="category"
              defaultValue={selected.categoryHints[0] ?? ''}
              placeholder="例: サービス"
              className="w-full rounded-2xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
            {state.fieldErrors.category ? (
              <span className="text-xs text-red-600">{state.fieldErrors.category}</span>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">原価</span>
            <input
              name="cost_price"
              type="number"
              min={0}
              step={1}
              defaultValue={0}
              className="w-full rounded-2xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
            {state.fieldErrors.cost_price ? (
              <span className="text-xs text-red-600">{state.fieldErrors.cost_price}</span>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">売価</span>
            <input
              name="selling_price"
              type="number"
              min={0}
              step={1}
              defaultValue={suggestedSellingPrice}
              className="w-full rounded-2xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
            <span className="text-xs text-gray-500">
              参考値: 売上合計と数量から算出した推定単価 {formatYen(suggestedSellingPrice)}
            </span>
            {state.fieldErrors.selling_price ? (
              <span className="text-xs text-red-600">{state.fieldErrors.selling_price}</span>
            ) : null}
          </label>
        </div>
      </div>

      <StateMessage state={state} />

      <div className="flex justify-end">
        <SubmitButton label="新規商品を作成して紐付ける" />
      </div>
    </form>
  )
}

export function ResolveMatchPanel({ selected, products }: ResolveMatchPanelProps) {
  const [mode, setMode] = useState<ResolveMode>('existing')

  if (!selected) {
    return (
      <section className="rounded-[2rem] border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
        <Sparkles className="mx-auto h-8 w-8 text-gray-400" />
        <h2 className="mt-4 text-xl font-semibold text-gray-900">未一致商品を選択してください</h2>
        <p className="mt-2 text-sm text-gray-500">
          左の一覧から POS 商品名を選ぶと、ここに紐付けフォームが表示されます。
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4 xl:sticky xl:top-6">
      <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-emerald-700 px-6 py-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
            Resolve Panel
          </p>
          <h2 className="mt-3 text-2xl font-bold">{selected.posProductName}</h2>
          <p className="mt-2 max-w-2xl text-sm text-emerald-50/90">
            最新売上 {formatDate(selected.lastSaleDate)} / 売上行 {selected.occurrenceCount} 件 /
            数量 {selected.totalQuantity} / 売上 {formatYen(selected.totalSalesAmount)}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">店舗</p>
              <p className="mt-2 text-sm text-gray-700">{selected.storeNames.join(' / ') || '未設定'}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                カテゴリ候補
              </p>
              <p className="mt-2 text-sm text-gray-700">
                {selected.categoryHints.length > 0
                  ? selected.categoryHints.join(' / ')
                  : 'カテゴリ未設定'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 rounded-3xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`flex-1 rounded-[1.25rem] px-4 py-2.5 text-sm font-medium transition ${
                mode === 'existing'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              既存商品へ紐付け
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`flex-1 rounded-[1.25rem] px-4 py-2.5 text-sm font-medium transition ${
                mode === 'create'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              新規商品を作成
            </button>
          </div>

          <div className="rounded-3xl bg-gray-50 p-4 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              <p>
                保存後は `product_aliases` が更新され、`sales_enriched_v` の未一致行は自動的に解消されます。
              </p>
            </div>
          </div>
        </div>
      </div>

      {mode === 'existing' ? (
        <ExistingMatchForm selected={selected} products={products} />
      ) : (
        <CreateProductForm selected={selected} />
      )}
    </section>
  )
}

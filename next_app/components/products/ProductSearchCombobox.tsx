'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { formatYen, type ProductOption } from '@/lib/products'

type ProductSearchComboboxProps = {
  products: ProductOption[]
  name: string
  initialValue?: string
  defaultQuery?: string
  placeholder?: string
  emptyMessage?: string
}

function buildSearchText(product: ProductOption) {
  return [
    product.product_name ?? '',
    product.jan_code ?? '',
    product.category ?? '',
    product.is_active ? 'active' : 'inactive',
  ]
    .join(' ')
    .toLowerCase()
}

export function ProductSearchCombobox({
  products,
  name,
  initialValue = '',
  defaultQuery = '',
  placeholder = '商品名 / JAN / 区分で絞り込み',
  emptyMessage = '条件に合う商品が見つかりません。',
}: ProductSearchComboboxProps) {
  const [query, setQuery] = useState(defaultQuery)
  const deferredQuery = useDeferredValue(query)
  const [selectedProductId, setSelectedProductId] = useState(initialValue)

  const filteredProducts = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()

    if (!normalized) {
      return products.slice(0, 60)
    }

    const terms = normalized.split(/\s+/).filter(Boolean)

    return products
      .map((product) => {
        const searchText = buildSearchText(product)
        let score = 0

        terms.forEach((term) => {
          if (searchText.startsWith(term)) {
            score += 6
          } else if (searchText.includes(term)) {
            score += 3
          }

          if ((product.product_name ?? '').toLowerCase() === term) {
            score += 8
          }
        })

        return { product, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }

        return (left.product.product_name ?? '').localeCompare(right.product.product_name ?? '')
      })
      .slice(0, 60)
      .map((entry) => entry.product)
  }, [deferredQuery, products])

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === selectedProductId) ?? null,
    [products, selectedProductId]
  )

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={selectedProductId} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-3xl border border-gray-200 bg-white">
        {filteredProducts.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {filteredProducts.map((product) => {
              const isSelected = String(product.id) === selectedProductId

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setSelectedProductId(String(product.id))}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${
                    isSelected ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {product.product_name ?? '商品名未設定'}
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        isSelected ? 'text-gray-200' : 'text-gray-500'
                      }`}
                    >
                      JAN: {product.jan_code || '-'} / 区分: {product.category || '-'} / 原価{' '}
                      {formatYen(product.cost_price)} / 売価 {formatYen(product.selling_price)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {isSelected ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : (
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          product.is_active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {product.is_active ? '有効' : '停止'}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-gray-500">{emptyMessage}</div>
        )}
      </div>

      {selectedProduct ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-semibold">{selectedProduct.product_name ?? '商品名未設定'}</p>
          <p className="mt-1 text-xs text-emerald-700">
            JAN: {selectedProduct.jan_code || '-'} / 区分: {selectedProduct.category || '-'} / 原価{' '}
            {formatYen(selectedProduct.cost_price)} / 売価 {formatYen(selectedProduct.selling_price)}
          </p>
        </div>
      ) : null}
    </div>
  )
}

'use client'

import { AlertTriangle, Clock3, Store } from 'lucide-react'
import { formatYen, type UnmatchedProductSummary } from '@/lib/products'

type UnmatchedListProps = {
  items: UnmatchedProductSummary[]
  selectedName: string
  onSelect: (name: string) => void
}

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

export function UnmatchedList({ items, selectedName, onSelect }: UnmatchedListProps) {
  return (
    <section className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-600">
            Unmatched Queue
          </p>
          <h2 className="mt-2 text-xl font-bold text-gray-900">未一致 POS 商品一覧</h2>
          <p className="mt-2 text-sm text-gray-500">
            クリックすると右側で既存商品への紐付け、または新規商品登録を進められます。
          </p>
        </div>
        <div className="rounded-2xl bg-amber-50 px-3 py-2 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
            対象件数
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{items.length}</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {items.map((item) => {
          const isSelected = item.posProductName === selectedName

          return (
            <button
              key={item.posProductName}
              type="button"
              onClick={() => onSelect(item.posProductName)}
              className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                isSelected
                  ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                  : 'border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={`h-4 w-4 ${isSelected ? 'text-amber-300' : 'text-amber-500'}`}
                    />
                    <p className="truncate text-base font-semibold">{item.posProductName}</p>
                  </div>
                  <p className={`mt-2 text-sm ${isSelected ? 'text-gray-200' : 'text-gray-500'}`}>
                    売上行 {item.occurrenceCount} 件 / 数量 {item.totalQuantity} / 売上{' '}
                    {formatYen(item.totalSalesAmount)}
                  </p>
                </div>
                <div
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    isSelected ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  最新 {formatDate(item.lastSaleDate)}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div
                  className={`rounded-2xl px-3 py-2 ${
                    isSelected ? 'bg-white/10 text-gray-100' : 'bg-gray-50 text-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Store className="h-3.5 w-3.5" />
                    <span className="font-medium">店舗</span>
                  </div>
                  <p className="mt-1 line-clamp-2">{item.storeNames.join(' / ') || '未設定'}</p>
                </div>

                <div
                  className={`rounded-2xl px-3 py-2 ${
                    isSelected ? 'bg-white/10 text-gray-100' : 'bg-gray-50 text-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span className="font-medium">カテゴリ候補</span>
                  </div>
                  <p className="mt-1 line-clamp-2">
                    {item.categoryHints.length > 0
                      ? item.categoryHints.join(' / ')
                      : 'カテゴリ未設定'}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

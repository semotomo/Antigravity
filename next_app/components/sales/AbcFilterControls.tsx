'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, Search, BarChart3, Hash } from 'lucide-react'
import { BarcodeScannerModal } from './BarcodeScannerModal'

type AbcSearchParams = { [key: string]: string | string[] | undefined }

interface AbcFilterControlsProps {
  currentSearchParams: AbcSearchParams
  q: string
  dateFrom: string
  dateTo: string
  storeName: string
  target: 'amount' | 'quantity'
  stores: string[]
  category: string
  excludeCategory: string
}

function buildSearchParams(
  params: AbcSearchParams,
  updates: Partial<
    Record<
      'dateFrom' | 'dateTo' | 'store' | 'category' | 'excludeCategory' | 'q' | 'target',
      string | undefined
    >
  >
) {
  const nextParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => nextParams.append(key, entry))
      return
    }

    if (typeof value === 'string') {
      nextParams.set(key, value)
    }
  })

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      nextParams.set(key, value)
      return
    }

    nextParams.delete(key)
  })

  return nextParams.toString()
}

export function AbcFilterControls({
  currentSearchParams,
  q: initialQ,
  dateFrom: initialDateFrom,
  dateTo: initialDateTo,
  storeName: initialStoreName,
  target: initialTarget,
  stores,
  category,
  excludeCategory,
}: AbcFilterControlsProps) {
  const router = useRouter()
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [qValue, setQValue] = useState(initialQ)
  const formRef = useRef<HTMLFormElement>(null)

  // バーコードスキャン成功時のハンドラー
  const handleScanSuccess = (barcode: string) => {
    setQValue(barcode)
    
    // スキャンに成功したら、クエリパラメータを直接書き換えて自動で検索を実行する
    const nextParams = buildSearchParams(currentSearchParams, {
      q: barcode,
    })
    router.push(`/sales/abc?${nextParams}`)
  }

  // 分析基準（数量・金額）切り替えタブの変更ハンドラー
  const handleTargetChange = (newTarget: 'amount' | 'quantity') => {
    const nextParams = buildSearchParams(currentSearchParams, {
      target: newTarget,
    })
    router.push(`/sales/abc?${nextParams}`)
  }

  // フォームサブミット時のハンドラー
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    const dateFrom = formData.get('dateFrom') as string
    const dateTo = formData.get('dateTo') as string
    const store = formData.get('store') as string
    const q = formData.get('q') as string
    const target = formData.get('target') as string

    const nextParams = buildSearchParams(currentSearchParams, {
      dateFrom,
      dateTo,
      store: store || undefined,
      q: q || undefined,
      target,
    })

    router.push(`/sales/abc?${nextParams}`)
  }

  return (
    <div className="space-y-6">
      {/* 指標切り替えタブ (数量・金額) */}
      <div className="flex justify-between items-center bg-gray-50 p-1.5 rounded-2xl border border-gray-150 max-w-sm">
        <button
          type="button"
          onClick={() => handleTargetChange('quantity')}
          className={`flex items-center justify-center gap-2 flex-1 py-2 text-xs font-bold rounded-xl transition ${
            initialTarget === 'quantity'
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <Hash className="h-3.5 w-3.5 text-indigo-500" />
          数量ベースで分析（標準）
        </button>
        <button
          type="button"
          onClick={() => handleTargetChange('amount')}
          className={`flex items-center justify-center gap-2 flex-1 py-2 text-xs font-bold rounded-xl transition ${
            initialTarget === 'amount'
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5 text-emerald-500" />
          売上金額ベースで分析
        </button>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr)),auto] xl:items-end">
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="excludeCategory" value={excludeCategory} />
          <input type="hidden" name="target" value={initialTarget} />

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">商品名・JANコードで検索</span>
            <div className="relative flex items-center">
              <input
                type="text"
                name="q"
                value={qValue}
                onChange={(e) => setQValue(e.target.value)}
                placeholder="商品名またはJANコード"
                className="w-full rounded-xl border border-gray-300 pl-3 pr-20 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
              <div className="absolute right-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  title="カメラでバーコードをスキャン"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <button
                  type="submit"
                  title="検索を実行"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </div>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">期間 (From)</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={initialDateFrom}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">期間 (To)</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={initialDateTo}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">店舗</span>
            <select
              name="store"
              defaultValue={initialStoreName}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            >
              <option value="">すべて</option>
              {stores.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 cursor-pointer"
            >
              分析する
            </button>
            <Link
              href="/sales/abc"
              onClick={() => setQValue('')}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              リセット
            </Link>
          </div>
        </form>
      </div>

      {/* カメラバーコードスキャナー */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  )
}

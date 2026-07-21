'use client'

import { useRouter } from 'next/navigation'
import { Hash, BarChart3 } from 'lucide-react'

type AbcSearchParams = { [key: string]: string | string[] | undefined }

interface AbcMetricTogglerProps {
  currentSearchParams: AbcSearchParams
  target: 'amount' | 'quantity'
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

export function AbcMetricToggler({ currentSearchParams, target }: AbcMetricTogglerProps) {
  const router = useRouter()

  const handleTargetChange = (newTarget: 'amount' | 'quantity') => {
    const nextParams = buildSearchParams(currentSearchParams, {
      target: newTarget,
    })
    router.push(`/sales/abc?${nextParams}`)
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-gray-100 p-1 border border-gray-200">
      <button
        type="button"
        onClick={() => handleTargetChange('quantity')}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer ${
          target === 'quantity'
            ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
            : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        <Hash className="h-3 w-3 text-indigo-500" />
        数量
      </button>
      <button
        type="button"
        onClick={() => handleTargetChange('amount')}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer ${
          target === 'amount'
            ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
            : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        <BarChart3 className="h-3 w-3 text-emerald-500" />
        金額
      </button>
    </div>
  )
}

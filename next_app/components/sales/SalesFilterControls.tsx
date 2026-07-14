'use client'

import { useRouter } from 'next/navigation'

type SalesSearchParams = { [key: string]: string | string[] | undefined }

interface SalesFilterControlsProps {
  currentSearchParams: SalesSearchParams
  unmatchedOnly: boolean
  sortOrder: 'asc' | 'desc'
}

function buildSearchParams(
  params: SalesSearchParams,
  updates: Partial<
    Record<
      'dateFrom' | 'dateTo' | 'store' | 'category' | 'unmatched' | 'excludeCategory' | 'sort',
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

export function SalesFilterControls({
  currentSearchParams,
  unmatchedOnly,
  sortOrder,
}: SalesFilterControlsProps) {
  const router = useRouter()

  const handleUnmatchedChange = (checked: boolean) => {
    const nextParams = buildSearchParams(currentSearchParams, {
      unmatched: checked ? 'true' : undefined,
    })
    router.push(`/sales?${nextParams}`)
  }

  const handleSortChange = (value: string) => {
    const nextParams = buildSearchParams(currentSearchParams, {
      sort: value || undefined,
    })
    router.push(`/sales?${nextParams}`)
  }

  return (
    <>
      <div className="flex flex-wrap gap-4 py-2 lg:py-0">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={unmatchedOnly}
            onChange={(e) => handleUnmatchedChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          未紐付けのみ表示
        </label>
      </div>

      <div className="flex items-center gap-2 self-start lg:self-end">
        <span className="text-xs font-medium text-gray-500">並び順</span>
        <select
          value={sortOrder}
          onChange={(e) => handleSortChange(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 cursor-pointer outline-none transition focus:border-gray-500"
        >
          <option value="desc">日付の新しい順</option>
          <option value="asc">日付の古い順</option>
        </select>
      </div>
    </>
  )
}

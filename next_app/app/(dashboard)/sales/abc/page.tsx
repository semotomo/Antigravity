import Link from 'next/link'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { fetchAbcAnalysis, type AbcAnalysisRow } from '@/lib/queries/abc'
import { fetchSalesFilterOptions } from '@/lib/queries/sales'

type AbcSearchParams = { [key: string]: string | string[] | undefined }

function buildSearchParams(
  params: AbcSearchParams,
  updates: Partial<
    Record<'dateFrom' | 'dateTo' | 'store' | 'category' | 'excludeCategory', string | undefined>
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

function getTodayInJst() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return `${year}-${month}-${day}`
}

function getMonthStartInJst() {
  const today = getTodayInJst()
  return `${today.slice(0, 7)}-01`
}

function getStringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

export const metadata = {
  title: 'ABC分析 | Kennel Dashboard',
}

export default async function SalesAbcPage({
  searchParams,
}: {
  searchParams: Promise<AbcSearchParams>
}) {
  const resolvedParams = await searchParams
  let dateFrom = getStringParam(resolvedParams.dateFrom) || getMonthStartInJst()
  let dateTo = getStringParam(resolvedParams.dateTo) || getTodayInJst()

  if (dateFrom && dateTo && dateFrom > dateTo) {
    ;[dateFrom, dateTo] = [dateTo, dateFrom]
  }

  const storeName = getStringParam(resolvedParams.store)
  const category = getStringParam(resolvedParams.category)
  const excludeCategory = getStringParam(resolvedParams.excludeCategory)

  const currentSearchParams: AbcSearchParams = {
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(storeName ? { store: storeName } : {}),
    ...(category ? { category } : {}),
    ...(excludeCategory ? { excludeCategory } : {}),
  }

  const [rows, { stores, categories }] = await Promise.all([
    fetchAbcAnalysis(
      dateFrom,
      dateTo,
      storeName || undefined,
      category || undefined,
      excludeCategory || undefined
    ),
    fetchSalesFilterOptions(),
  ])

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
      header: '商品',
      render: (item) => (
        <div className="min-w-[240px]">
          <p className="font-semibold text-gray-900">{item.label}</p>
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
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">ABC分析</h1>
        <p className="text-sm text-gray-500">
          商品ごとの売上構成比でランク分けしています。カテゴリは売上一覧と同じ条件で絞り込めます。
        </p>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <form className="grid gap-4 md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr)),auto] xl:items-end">
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="excludeCategory" value={excludeCategory} />

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">期間 (From)</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={dateFrom}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">期間 (To)</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={dateTo}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">店舗</span>
            <select
              name="store"
              defaultValue={storeName}
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
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              分析する
            </button>
            <Link
              href="/sales/abc"
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              リセット
            </Link>
          </div>
        </form>
      </div>

      <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:grid-cols-[max-content,minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">表示店舗</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Link
              href={`/sales/abc?${buildSearchParams(currentSearchParams, { store: undefined })}`}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                !storeName
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600'
              }`}
            >
              すべて
            </Link>
            {stores.map((store) => (
              <Link
                key={store}
                href={`/sales/abc?${buildSearchParams(currentSearchParams, { store })}`}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                  storeName === store
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 bg-white text-gray-600'
                }`}
              >
                {store}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">カテゴリ</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Link
              href={`/sales/abc?${buildSearchParams(currentSearchParams, {
                category: undefined,
                excludeCategory: undefined,
              })}`}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                !category && !excludeCategory
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600'
              }`}
            >
              すべて
            </Link>
            <Link
              href={`/sales/abc?${buildSearchParams(currentSearchParams, {
                category: undefined,
                excludeCategory: 'サービス',
              })}`}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                !category && excludeCategory === 'サービス'
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600'
              }`}
            >
              サービス以外
            </Link>
            {categories.map((categoryOption) => (
              <Link
                key={categoryOption}
                href={`/sales/abc?${buildSearchParams(currentSearchParams, {
                  category: categoryOption,
                  excludeCategory: undefined,
                })}`}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                  category === categoryOption
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 bg-white text-gray-600'
                }`}
              >
                {categoryOption}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">対象商品数</p>
          <p className="mt-3 text-3xl font-bold text-gray-900">{rows.length.toLocaleString('ja-JP')}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Aランク商品数</p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.filter((row) => row.rank === 'A').length.toLocaleString('ja-JP')}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">B/Cランク商品数</p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.filter((row) => row.rank !== 'A').length.toLocaleString('ja-JP')}
          </p>
        </div>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(item) => item.key}
        emptyMessage="指定期間に集計できる商品データが見つかりませんでした。"
      />
    </div>
  )
}

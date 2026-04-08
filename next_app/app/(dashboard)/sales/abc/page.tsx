import Link from 'next/link'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  fetchAbcAnalysis,
  type AbcAnalysisRow,
  type AbcAnalysisView,
} from '@/lib/queries/abc'
import { fetchSalesFilterOptions } from '@/lib/queries/sales'

type AbcSearchParams = { [key: string]: string | string[] | undefined }

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

function getViewParam(value: string | string[] | undefined): AbcAnalysisView {
  return getStringParam(value) === 'category' ? 'category' : 'product'
}

function buildAbcHref(params: {
  dateFrom: string
  dateTo: string
  storeName: string
  view: AbcAnalysisView
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('dateFrom', params.dateFrom)
  searchParams.set('dateTo', params.dateTo)
  searchParams.set('view', params.view)

  if (params.storeName) {
    searchParams.set('store', params.storeName)
  }

  return `/sales/abc?${searchParams.toString()}`
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
  const dateFrom = getStringParam(resolvedParams.dateFrom) || getMonthStartInJst()
  const dateTo = getStringParam(resolvedParams.dateTo) || getTodayInJst()
  const storeName = getStringParam(resolvedParams.store)
  const view = getViewParam(resolvedParams.view)

  const [rows, { stores }] = await Promise.all([
    fetchAbcAnalysis(dateFrom, dateTo, storeName || undefined, view),
    fetchSalesFilterOptions(),
  ])

  const subjectLabel = view === 'category' ? 'カテゴリ' : '商品'
  const productViewHref = buildAbcHref({ dateFrom, dateTo, storeName, view: 'product' })
  const categoryViewHref = buildAbcHref({ dateFrom, dateTo, storeName, view: 'category' })

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
      header: subjectLabel,
      render: (item) =>
        view === 'category' ? (
          <div className="min-w-[220px]">
            <p className="font-semibold text-gray-900">{item.label}</p>
            <p className="mt-1 text-xs text-gray-500">カテゴリ別の売上構成を集計しています。</p>
          </div>
        ) : (
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
          {subjectLabel}ごとの売上構成比でランク分けしています。A=70%以下、B=70〜90%以下、C=90〜100%
          です。
        </p>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={productViewHref}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              view === 'product'
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            商品別ABC
          </Link>
          <Link
            href={categoryViewHref}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              view === 'category'
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            カテゴリ別ABC
          </Link>
        </div>

        <form className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr)),auto] xl:items-end">
          <input type="hidden" name="view" value={view} />

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
              href={`/sales/abc?view=${view}`}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              リセット
            </Link>
          </div>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
            対象{subjectLabel}数
          </p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.length.toLocaleString('ja-JP')}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
            Aランク{subjectLabel}数
          </p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.filter((row) => row.rank === 'A').length.toLocaleString('ja-JP')}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
            B/Cランク{subjectLabel}数
          </p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.filter((row) => row.rank !== 'A').length.toLocaleString('ja-JP')}
          </p>
        </div>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(item) => item.key}
        emptyMessage={`指定期間に集計できる${subjectLabel}データが見つかりませんでした。`}
      />
    </div>
  )
}

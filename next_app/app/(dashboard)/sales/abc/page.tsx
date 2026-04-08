import Link from 'next/link'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { fetchAbcAnalysis, type AbcAnalysisRow } from '@/lib/queries/abc'
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

  const [rows, { stores }] = await Promise.all([
    fetchAbcAnalysis(dateFrom, dateTo, storeName || undefined),
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
      key: 'product_name',
      header: '商品',
      render: (item) => (
        <div className="min-w-[240px]">
          <p className="font-semibold text-gray-900">{item.product_name}</p>
          <p className="mt-1 text-xs text-gray-500">
            JAN: {item.jan_code || '-'} / 区分: {item.category || '-'}
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
      header: '売上高',
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
          指定期間の売上を構成比で並べ、A=上位70%、B=70〜90%、C=90〜100% で分類します。
        </p>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <form className="grid gap-4 md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr)),auto] xl:items-end">
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">対象商品数</p>
          <p className="mt-3 text-3xl font-bold text-gray-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Aランク数</p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.filter((row) => row.rank === 'A').length}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">B/Cランク数</p>
          <p className="mt-3 text-3xl font-bold text-gray-900">
            {rows.filter((row) => row.rank !== 'A').length}
          </p>
        </div>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(item) => item.key}
        emptyMessage="指定条件に一致する売上データが見つかりませんでした。"
      />
    </div>
  )
}

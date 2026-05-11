import Link from 'next/link'
import { ArrowUpDown } from 'lucide-react'
import { SalesImportButton } from '@/components/sales/SalesImportButton'
import { ProductMasterSyncButton } from '@/components/sales/ProductMasterSyncButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { fetchSales, fetchSalesFilterOptions, type SaleRow } from '@/lib/queries/sales'

type SalesSearchParams = { [key: string]: string | string[] | undefined }

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

function getStringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

function hasSearchParam(params: SalesSearchParams, key: string) {
  return Object.prototype.hasOwnProperty.call(params, key)
}

export const metadata = {
  title: '売上一覧 | Kennel Dashboard',
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SalesSearchParams>
}) {
  const resolvedParams = await searchParams
  const today = getTodayInJst()

  const hasDateFrom = hasSearchParam(resolvedParams, 'dateFrom')
  const hasDateTo = hasSearchParam(resolvedParams, 'dateTo')

  let dateFrom = getStringParam(resolvedParams.dateFrom)
  let dateTo = getStringParam(resolvedParams.dateTo)

  if (!hasDateFrom && !hasDateTo) {
    dateFrom = today
    dateTo = today
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    ;[dateFrom, dateTo] = [dateTo, dateFrom]
  }

  const storeName = getStringParam(resolvedParams.store)
  const category = getStringParam(resolvedParams.category)
  const excludeCategory = getStringParam(resolvedParams.excludeCategory)
  const unmatchedOnly = resolvedParams.unmatched === 'true'
  const sortOrder = resolvedParams.sort === 'asc' ? 'asc' : 'desc'

  const currentSearchParams: SalesSearchParams = {
    ...(hasDateFrom || dateFrom ? { dateFrom } : {}),
    ...(hasDateTo || dateTo ? { dateTo } : {}),
    ...(storeName ? { store: storeName } : {}),
    ...(category ? { category } : {}),
    ...(excludeCategory ? { excludeCategory } : {}),
    ...(unmatchedOnly ? { unmatched: 'true' } : {}),
    ...(sortOrder !== 'desc' ? { sort: sortOrder } : {}),
  }

  const [salesData, { stores, categories }] = await Promise.all([
    fetchSales({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      storeName: storeName || undefined,
      category: category || undefined,
      excludeCategory: excludeCategory || undefined,
      unmatchedOnly,
      sortOrder,
    }),
    fetchSalesFilterOptions(),
  ])

  const columns: DataTableColumn<SaleRow>[] = [
    { key: 'sale_date', header: '日付' },
    { key: 'store_name', header: '店舗名' },
    { key: 'category', header: 'カテゴリ' },
    {
      key: 'product_name',
      header: '商品名',
      render: (item) => (
        <div className="flex flex-col">
          <span className="font-medium text-gray-900">{item.product_name}</span>
          <span className="text-xs text-gray-500">JAN: {item.jan_code || '-'}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: '数量',
      align: 'right',
      render: (item) => item.quantity.toLocaleString(),
    },
    {
      key: 'sales_amount',
      header: '売上金額',
      align: 'right',
      render: (item) => `¥${item.sales_amount.toLocaleString()}`,
    },
    {
      key: 'status',
      header: '紐付け状態',
      align: 'center',
      render: (item) => {
        if (item.unmatched_master) {
          return <StatusBadge variant="danger">未紐付け</StatusBadge>
        }

        if (item.match_source === 'alias') {
          return <StatusBadge variant="info">エイリアス</StatusBadge>
        }

        return <StatusBadge variant="success">直接一致</StatusBadge>
      },
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">売上一覧</h1>
          <p className="mt-1 text-sm text-gray-500">POSデータから集計された日々の販売記録です。</p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="text-sm font-medium text-gray-500">全 {salesData.length} 件</div>
          <div className="flex items-center gap-2">
            <ProductMasterSyncButton />
            <SalesImportButton />
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr),max-content] lg:items-end">
        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="store" value={storeName} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="excludeCategory" value={excludeCategory} />
          <input type="hidden" name="sort" value={sortOrder} />
          {unmatchedOnly ? <input type="hidden" name="unmatched" value="true" /> : null}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">期間検索 (From)</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={dateFrom}
              className="w-40 rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">期間検索 (To)</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={dateTo}
              className="w-40 rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>

          <button
            type="submit"
            className="rounded border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            適用
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/sales?${buildSearchParams(currentSearchParams, {
              unmatched: unmatchedOnly ? undefined : 'true',
            })}`}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${
              unmatchedOnly
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            要対応（未紐付け）のみ表示
          </Link>
          <Link
            href={`/sales?${buildSearchParams(currentSearchParams, {
              sort: sortOrder === 'desc' ? 'asc' : undefined,
            })}`}
            className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <ArrowUpDown className="h-4 w-4" />
            {sortOrder === 'desc' ? '日付: 新しい順' : '日付: 古い順'}
          </Link>
        </div>

        <div className="text-sm text-gray-500 lg:text-right">
          サービス除外や未紐付け確認、日付並び替えをここから切り替えられます。
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:grid-cols-[max-content,minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">表示店舗</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Link
              href={`/sales?${buildSearchParams(currentSearchParams, { store: undefined })}`}
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
                href={`/sales?${buildSearchParams(currentSearchParams, { store })}`}
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
              href={`/sales?${buildSearchParams(currentSearchParams, {
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
              href={`/sales?${buildSearchParams(currentSearchParams, {
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
                href={`/sales?${buildSearchParams(currentSearchParams, {
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

      <DataTable
        data={salesData}
        columns={columns}
        keyExtractor={(item) => String(item.sales_row_id)}
        emptyMessage="条件に一致する売上が見つかりませんでした。"
        rowClassName={(item) => (item.unmatched_master ? 'bg-red-50 hover:bg-red-100' : '')}
      />
    </div>
  )
}

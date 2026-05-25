import { TransfersBoard } from '@/components/transfers/TransfersBoard'
import {
  fetchStores,
  fetchTransferHistory,
  fetchTransferProducts,
} from '@/lib/queries/transfers'

type TransfersSearchParams = { [key: string]: string | string[] | undefined }

function getStringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

function getStoreIdParam(value: string | string[] | undefined) {
  const rawValue = getStringParam(value)
  const parsed = Number(rawValue)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export const metadata = {
  title: '店舗間移動 | Kennel Dashboard',
}

export default async function ProductTransfersPage({
  searchParams,
}: {
  searchParams: Promise<TransfersSearchParams>
}) {
  const resolvedParams = await searchParams
  let dateFrom = getStringParam(resolvedParams.dateFrom)
  let dateTo = getStringParam(resolvedParams.dateTo)
  const fromStoreId = getStoreIdParam(resolvedParams.fromStore)
  const toStoreId = getStoreIdParam(resolvedParams.toStore)

  // 初期ロード時（日付や店舗フィルタの指定が何もない状態）は、直近1週間分をデフォルト範囲とする
  const isInitialLoad = !dateFrom && !dateTo && fromStoreId === undefined && toStoreId === undefined
  if (isInitialLoad) {
    const today = new Date()
    const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const formatDate = (date: Date) => {
      const parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date)
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
      return `${values.year}-${values.month}-${values.day}`
    }
    dateFrom = formatDate(oneWeekAgo)
    dateTo = formatDate(today)
  }

  const [stores, products, transfers] = await Promise.all([
    fetchStores(),
    fetchTransferProducts(),
    fetchTransferHistory({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      fromStoreId,
      toStoreId,
    }),
  ])

  return (
    <TransfersBoard
      transfers={transfers}
      stores={stores}
      products={products}
      filters={{
        dateFrom,
        dateTo,
        fromStoreId,
        toStoreId,
      }}
    />
  )
}

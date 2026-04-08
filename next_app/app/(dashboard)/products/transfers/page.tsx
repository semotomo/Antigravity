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
  const dateFrom = getStringParam(resolvedParams.dateFrom)
  const dateTo = getStringParam(resolvedParams.dateTo)
  const fromStoreId = getStoreIdParam(resolvedParams.fromStore)
  const toStoreId = getStoreIdParam(resolvedParams.toStore)

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

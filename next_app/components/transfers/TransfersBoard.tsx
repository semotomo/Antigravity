'use client'

import { useMemo, useState } from 'react'
import { PlusCircle, Printer, SquarePen } from 'lucide-react'
import { printTransferReport } from '@/lib/transferPrint'
import { ProductsSubnav } from '@/components/products/ProductsSubnav'
import { TransferFormModal } from '@/components/transfers/TransferFormModal'
import { TransferEditModal } from '@/components/transfers/TransferEditModal'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatYen } from '@/lib/products'
import {
  formatTransferEntryTypeLabel,
  formatTransferDateKey,
  formatTransferDateTime,
  type TransferListRow,
  type TransferProductOption,
  type TransferStoreOption,
} from '@/lib/transfers'

type TransfersBoardProps = {
  transfers: TransferListRow[]
  stores: TransferStoreOption[]
  products: TransferProductOption[]
  filters: {
    dateFrom: string
    dateTo: string
    fromStoreId?: number
    toStoreId?: number
  }
}

function buildSearchParams(
  filters: TransfersBoardProps['filters'],
  updates: Partial<Record<'dateFrom' | 'dateTo' | 'fromStore' | 'toStore', string | undefined>>
) {
  const nextParams = new URLSearchParams()

  if (filters.dateFrom) {
    nextParams.set('dateFrom', filters.dateFrom)
  }

  if (filters.dateTo) {
    nextParams.set('dateTo', filters.dateTo)
  }

  if (filters.fromStoreId) {
    nextParams.set('fromStore', String(filters.fromStoreId))
  }

  if (filters.toStoreId) {
    nextParams.set('toStore', String(filters.toStoreId))
  }

  Object.entries(updates).forEach(([key, value]) => {
    if (value) {
      nextParams.set(key, value)
      return
    }

    nextParams.delete(key)
  })

  return nextParams.toString()
}

function getTodayInJst() {
  return formatTransferDateKey(new Date().toISOString())
}

function getCurrentMonthKey(today: string) {
  return today.slice(0, 7)
}

export function TransfersBoard({ transfers, stores, products, filters }: TransfersBoardProps) {
  const [editTarget, setEditTarget] = useState<TransferListRow | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const summary = useMemo(() => {
    const today = getTodayInJst()
    const monthKey = getCurrentMonthKey(today)

    return {
      todayCount: transfers.filter((transfer) => formatTransferDateKey(transfer.transfer_date) === today)
        .length,
      monthCount: transfers.filter((transfer) =>
        formatTransferDateKey(transfer.transfer_date).startsWith(monthKey)
      ).length,
      totalCost: transfers.reduce((sum, transfer) => sum + (transfer.total_cost ?? 0), 0),
    }
  }, [transfers])

  const columns: DataTableColumn<TransferListRow>[] = [
    {
      key: 'transfer_date',
      header: '登録日時',
      render: (transfer) => formatTransferDateTime(transfer.transfer_date),
    },
    {
      key: 'stores',
      header: '店舗',
      render: (transfer) => (
        <div className="min-w-[100px]">
          <p className="font-semibold text-gray-900">{transfer.from_store?.name ?? '-'}</p>
          <p className="mt-1 text-xs text-gray-500">
            {transfer.entry_type === 'usage'
              ? '物品使用'
              : `→ ${transfer.to_store?.name ?? '-'}`}
          </p>
        </div>
      ),
    },
    {
      key: 'product_name',
      header: '商品',
      render: (transfer) => (
        <div className="min-w-[200px]">
          <p className="font-semibold text-gray-900">{transfer.product_name}</p>
          <p className="mt-1 text-xs text-gray-500">JAN: {transfer.jan_code}</p>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: '数量',
      align: 'right',
      render: (transfer) => transfer.quantity.toLocaleString('ja-JP'),
    },
    {
      key: 'cost_price',
      header: '原価',
      align: 'right',
      render: (transfer) => formatYen(transfer.cost_price),
    },
    {
      key: 'total_cost',
      header: '原価合計',
      align: 'right',
      render: (transfer) => formatYen(transfer.total_cost),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'center',
      render: (transfer) => (
        <button
          type="button"
          onClick={() => setEditTarget(transfer)}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <SquarePen className="h-4 w-4" />
          編集
        </button>
      ),
    },
    {
      key: 'entry_type',
      header: '区分',
      align: 'center',
      render: (transfer) => (
        <StatusBadge variant={transfer.entry_type === 'usage' ? 'warning' : 'info'}>
          {formatTransferEntryTypeLabel(transfer.entry_type)}
        </StatusBadge>
      ),
    },
  ]

  return (
    <>
      <div className="space-y-6">
        <ProductsSubnav />

        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-emerald-700 px-6 py-7 text-white">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">店舗間移動・物品使用</h1>
                <p className="mt-2 max-w-2xl text-sm text-emerald-50/90">
                  他店舗への商品移動と物品使用を登録し、履歴をまとめて確認できます。JAN
                  コードの読取にも対応しています。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
                >
                  <PlusCircle className="h-4 w-4" />
                  新規登録
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                今日の登録件数
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{summary.todayCount}</p>
              <p className="mt-1 text-sm text-gray-500">本日登録された履歴</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                今月の登録件数
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{summary.monthCount}</p>
              <p className="mt-1 text-sm text-gray-500">表示中データから集計</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                原価合計
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{formatYen(summary.totalCost)}</p>
              <p className="mt-1 text-sm text-gray-500">表示中の移動履歴の合計</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr)),auto] xl:items-end">
              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">期間 (From)</span>
                <input
                  type="date"
                  name="dateFrom"
                  defaultValue={filters.dateFrom}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">期間 (To)</span>
                <input
                  type="date"
                  name="dateTo"
                  defaultValue={filters.dateTo}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">移動元店舗</span>
                <select
                  name="fromStore"
                  defaultValue={filters.fromStoreId ? String(filters.fromStoreId) : ''}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                >
                  <option value="">すべて</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">移動先店舗</span>
                <select
                  name="toStore"
                  defaultValue={filters.toStoreId ? String(filters.toStoreId) : ''}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                >
                  <option value="">すべて</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  検索
                </button>
                <a
                  href={`/products/transfers?${buildSearchParams(filters, {
                    dateFrom: undefined,
                    dateTo: undefined,
                    fromStore: undefined,
                    toStore: undefined,
                  })}`}
                  className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  クリア
                </a>
                <button
                  type="button"
                  onClick={() => printTransferReport(transfers)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  <Printer className="h-4 w-4" />
                  月次レポート印刷
                </button>
              </div>
            </form>
          </div>


          <DataTable
            data={transfers}
            columns={columns}
            keyExtractor={(transfer) => String(transfer.id)}
            emptyMessage="条件に一致する移動履歴が見つかりませんでした。"
          />
        </section>
      </div>

      {modalOpen ? (
        <TransferFormModal
          open={modalOpen}
          stores={stores}
          products={products}
          onClose={() => setModalOpen(false)}
        />
      ) : null}

      {editTarget ? (
        <TransferEditModal
          open={!!editTarget}
          transfer={editTarget}
          stores={stores}
          onClose={() => setEditTarget(null)}
        />
      ) : null}
    </>
  )
}

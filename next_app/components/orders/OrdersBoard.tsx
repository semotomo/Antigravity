'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { OrderCard } from '@/components/orders/OrderCard'
import { OrderFormModal } from '@/components/orders/OrderFormModal'
import {
  ACTIVE_ORDER_STATUSES,
  buildOrderCounts,
  ORDER_FILTER_LABELS,
  ORDER_FILTERS,
  type OrderFilter,
  type OrderListRow,
  type OrderProductOption,
  type OrderStoreOption,
} from '@/lib/orders'

type OrdersBoardProps = {
  orders: OrderListRow[]
  stores: OrderStoreOption[]
  products: OrderProductOption[]
  initialFilter?: OrderFilter
}

type DialogState =
  | {
      mode: 'create'
      order: null
      nonce: number
    }
  | null

export function OrdersBoard({
  orders,
  stores,
  products,
  initialFilter = 'all',
}: OrdersBoardProps) {
  const [selectedFilter, setSelectedFilter] = useState<OrderFilter>(initialFilter)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const counts = useMemo(() => buildOrderCounts(orders), [orders])
  const activeCount = ACTIVE_ORDER_STATUSES.reduce(
    (total, status) => total + counts[status],
    0
  )

  const filteredOrders = useMemo(() => {
    if (selectedFilter === 'all') {
      return orders
    }

    return orders.filter((order) => order.status === selectedFilter)
  }, [orders, selectedFilter])

  const openCreateDialog = () => {
    setDialogState({
      mode: 'create',
      order: null,
      nonce: Date.now(),
    })
  }

  const closeDialog = () => {
    setDialogState(null)
  }

  return (
    <>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-slate-700 px-6 py-7 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-300">
              Phase 2
            </p>
            <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">客注管理</h1>
                <p className="mt-2 max-w-2xl text-sm text-gray-200">
                  未発注からお渡し完了まで、店舗で追いかけやすい順にまとめています。
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-100"
              >
                <Plus className="h-4 w-4" />
                新規客注を登録
              </button>
            </div>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                進行中
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{activeCount}</p>
              <p className="mt-1 text-sm text-gray-500">未発注からお渡し待ちまでの件数</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                完了
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.completed}</p>
              <p className="mt-1 text-sm text-gray-500">対応完了として閉じた客注</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                キャンセル
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.cancelled}</p>
              <p className="mt-1 text-sm text-gray-500">取り消し済みの客注</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {ORDER_FILTERS.map((filter) => {
              const isSelected = filter === selectedFilter
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSelectedFilter(filter)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${
                    isSelected
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
                  }`}
                >
                  {ORDER_FILTER_LABELS[filter]} ({counts[filter]})
                </button>
              )
            })}
          </div>

          {filteredOrders.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {filteredOrders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <h2 className="text-lg font-semibold text-gray-900">表示する客注がありません</h2>
              <p className="mt-2 text-sm text-gray-500">
                フィルタ条件に一致する客注がまだ登録されていません。
              </p>
              <button
                type="button"
                onClick={openCreateDialog}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <Plus className="h-4 w-4" />
                1件目を登録する
              </button>
            </div>
          )}
        </section>
      </div>

      {dialogState ? (
        <OrderFormModal
          key={`${dialogState.mode}-new-${dialogState.nonce}`}
          open
          mode={dialogState.mode}
          order={dialogState.order}
          stores={stores}
          products={products}
          onClose={closeDialog}
        />
      ) : null}
    </>
  )
}

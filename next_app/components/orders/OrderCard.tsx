'use client'

import Link from 'next/link'
import {
  ArrowRight,
  CalendarClock,
} from 'lucide-react'
import { useFormStatus } from 'react-dom'
import { advanceOrderStatusAction } from '@/app/actions/orders'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  formatOrderDate,
  getNextOrderAction,
  getOrderStatusLabel,
  isOrderStatus,
  ORDER_STATUS_BADGE_VARIANTS,
  type OrderListRow,
} from '@/lib/orders'

type OrderCardProps = {
  order: OrderListRow
}

function ActionSubmitButton({
  label,
  tone = 'primary',
}: {
  label: string
  tone?: 'primary' | 'subtle' | 'danger'
}) {
  const { pending } = useFormStatus()

  const styles = {
    primary:
      'border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:border-gray-400 disabled:bg-gray-400',
    subtle:
      'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:text-gray-400',
    danger:
      'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:text-red-300',
  }

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles[tone]}`}
    >
      {pending ? '更新中...' : label}
    </button>
  )
}

export function OrderCard({ order }: OrderCardProps) {
  const nextAction = getNextOrderAction(order.status)
  const badgeVariant = isOrderStatus(order.status)
    ? ORDER_STATUS_BADGE_VARIANTS[order.status]
    : 'gray'
  const janCode = order.jan_code ?? order.product?.jan_code ?? null

  return (
    <article className="flex h-full flex-col rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold text-gray-900">{order.customer_name}</h3>
            {order.order_no ? (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                受付No. {order.order_no}
              </span>
            ) : null}
          </div>
        </div>
        <StatusBadge variant={badgeVariant}>{getOrderStatusLabel(order.status)}</StatusBadge>
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
        <p className="text-sm font-semibold text-gray-500">商品情報</p>
        <p className="mt-2 text-base font-semibold text-gray-900">{order.item_name}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
          <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">数量 {order.quantity ?? 1}</span>
          {order.product?.product_name ? (
            <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
              マスタ: {order.product.product_name}
            </span>
          ) : null}
          {janCode ? (
            <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">JAN: {janCode}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-gray-50 px-3 py-2.5">
        <CalendarClock className="h-4 w-4 shrink-0 text-gray-500" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            受付日
          </p>
          <p className="mt-1 text-sm font-medium text-gray-700">{formatOrderDate(order.order_date)}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {nextAction ? (
          <form action={advanceOrderStatusAction}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="next_status" value={nextAction.nextStatus} />
            <ActionSubmitButton label={nextAction.label} />
          </form>
        ) : null}

        <Link
          href={`/orders/${order.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <ArrowRight className="h-4 w-4" />
          詳細を見る
        </Link>
      </div>
    </article>
  )
}

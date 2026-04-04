'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Package,
  Phone,
  SquarePen,
  Store,
  UserRound,
} from 'lucide-react'
import { useFormStatus } from 'react-dom'
import { advanceOrderStatusAction, cancelOrderAction } from '@/app/actions/orders'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  formatOrderDate,
  formatOrderDateTime,
  getNextOrderAction,
  getOrderStatusLabel,
  isOrderStatus,
  ORDER_STATUS_BADGE_VARIANTS,
  TERMINAL_ORDER_STATUSES,
  type OrderListRow,
} from '@/lib/orders'

type OrderCardProps = {
  order: OrderListRow
  onEdit: (order: OrderListRow) => void
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

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-gray-50 px-3 py-2.5">
      <div className="mt-0.5 text-gray-500">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          {label}
        </p>
        <p className="mt-1 break-words text-sm text-gray-700">{value}</p>
      </div>
    </div>
  )
}

export function OrderCard({ order, onEdit }: OrderCardProps) {
  const nextAction = getNextOrderAction(order.status)
  const isTerminal =
    isOrderStatus(order.status) &&
    (order.status === TERMINAL_ORDER_STATUSES[0] || order.status === TERMINAL_ORDER_STATUSES[1])
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
          <p className="mt-2 text-sm text-gray-500">更新順で受付内容を確認しやすい客注カードです。</p>
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

      <div className="mt-4 grid gap-3">
        <MetaRow
          icon={<Phone className="h-4 w-4" />}
          label="電話番号"
          value={order.phone_number}
        />
        <MetaRow
          icon={<Store className="h-4 w-4" />}
          label="受付店舗"
          value={order.store?.name ?? '未設定'}
        />
        <MetaRow
          icon={<UserRound className="h-4 w-4" />}
          label="受付担当"
          value={order.staff_name || '未設定'}
        />
        <MetaRow
          icon={<Package className="h-4 w-4" />}
          label="補足"
          value={order.item_details || order.notes || '補足情報なし'}
        />
        <MetaRow
          icon={<CalendarClock className="h-4 w-4" />}
          label="受付日"
          value={formatOrderDate(order.order_date)}
        />
        <MetaRow
          icon={<ClipboardList className="h-4 w-4" />}
          label="更新"
          value={`登録 ${formatOrderDateTime(order.created_at)} / 更新 ${formatOrderDateTime(
            order.updated_at
          )}`}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {nextAction ? (
          <form action={advanceOrderStatusAction}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="next_status" value={nextAction.nextStatus} />
            <ActionSubmitButton label={nextAction.label} />
          </form>
        ) : null}

        <button
          type="button"
          onClick={() => onEdit(order)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <SquarePen className="h-4 w-4" />
          編集
        </button>

        <Link
          href={`/orders/${order.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <ArrowRight className="h-4 w-4" />
          詳細を見る
        </Link>

        {!isTerminal ? (
          <form action={cancelOrderAction}>
            <input type="hidden" name="id" value={order.id} />
            <ActionSubmitButton label="キャンセルにする" tone="danger" />
          </form>
        ) : null}
      </div>
    </article>
  )
}

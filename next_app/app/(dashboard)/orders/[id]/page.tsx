import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Package, Phone, ScanLine, Store, UserRound } from 'lucide-react'
import { cancelOrderAction } from '@/app/actions/orders'
import { OrderDetailView } from '@/components/orders/OrderDetailView'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  formatOrderDateTime,
  getOrderStatusLabel,
  isOrderStatus,
  ORDER_STATUS_BADGE_VARIANTS,
  TERMINAL_ORDER_STATUSES,
} from '@/lib/orders'
import { fetchOrderDetails, fetchOrderFormOptions } from '@/lib/queries/orders'

export const metadata = {
  title: '客注詳細 | Kennel Dashboard',
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [order, formOptions] = await Promise.all([fetchOrderDetails(id), fetchOrderFormOptions()])

  if (!order) {
    notFound()
  }

  const badgeVariant = isOrderStatus(order.status)
    ? ORDER_STATUS_BADGE_VARIANTS[order.status]
    : 'gray'
  const janCode = order.jan_code ?? order.product?.jan_code ?? '未設定'
  const canCancel =
    isOrderStatus(order.status) &&
    !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(order.status)

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        <ArrowLeft className="h-4 w-4" />
        客注一覧へ戻る
      </Link>

      <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-emerald-700 px-6 py-7 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">
            Customer Order
          </p>
          <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">{order.customer_name}</h1>
                <StatusBadge variant={badgeVariant}>{getOrderStatusLabel(order.status)}</StatusBadge>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-emerald-50/90">
                受付No. {order.order_no || '未設定'} / 商品 {order.item_name}
              </p>
            </div>
            <div className="rounded-3xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100">
                最終更新
              </p>
              <p className="mt-2 text-sm font-semibold">{formatOrderDateTime(order.updated_at)}</p>
            </div>
          </div>
          {canCancel ? (
            <form action={cancelOrderAction} className="mt-6">
              <input type="hidden" name="id" value={order.id} />
              <button
                type="submit"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              >
                キャンセルにする
              </button>
            </form>
          ) : null}
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              <Phone className="h-4 w-4" />
              電話番号
            </div>
            <p className="mt-3 text-base font-semibold text-gray-900">
              {order.phone_number || '未入力'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              <Store className="h-4 w-4" />
              受付店舗
            </div>
            <p className="mt-3 text-base font-semibold text-gray-900">
              {order.store?.name ?? '未設定'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              <UserRound className="h-4 w-4" />
              受付担当
            </div>
            <p className="mt-3 text-base font-semibold text-gray-900">
              {order.staff_name ?? '未設定'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              <Package className="h-4 w-4" />
              商品マスタ
            </div>
            <p className="mt-3 text-base font-semibold text-gray-900">
              {order.product?.product_name ?? '未設定'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              <ScanLine className="h-4 w-4" />
              JANコード
            </div>
            <p className="mt-3 text-base font-semibold text-gray-900">{janCode}</p>
          </div>
        </div>
      </section>

      <OrderDetailView
        order={order}
        stores={formOptions.stores}
        products={formOptions.products}
      />

      <section className="rounded-[2rem] border border-dashed border-gray-300 bg-white px-6 py-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
          Timeline
        </p>
        <h2 className="mt-2 text-xl font-bold text-gray-900">更新履歴プレースホルダ</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">登録</p>
            <p className="mt-2 text-sm font-medium text-gray-900">
              {formatOrderDateTime(order.created_at)}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              最終更新
            </p>
            <p className="mt-2 text-sm font-medium text-gray-900">
              {formatOrderDateTime(order.updated_at)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          今後ここにステータス変更履歴や店舗メモのログを追加するための余白です。
        </p>
      </section>
    </div>
  )
}

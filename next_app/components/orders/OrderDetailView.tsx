'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Save } from 'lucide-react'
import { saveOrderAction } from '@/app/actions/orders'
import { OrderFormFields } from '@/components/orders/OrderFormFields'
import {
  initialOrderMutationState,
  type OrderListRow,
  type OrderProductOption,
  type OrderStoreOption,
} from '@/lib/orders'

type OrderDetailViewProps = {
  order: OrderListRow
  stores: OrderStoreOption[]
  products: OrderProductOption[]
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
    >
      <Save className="h-4 w-4" />
      {pending ? '保存中...' : '内容を更新'}
    </button>
  )
}

export function OrderDetailView({ order, stores, products }: OrderDetailViewProps) {
  const [state, formAction] = useActionState(saveOrderAction, initialOrderMutationState)

  return (
    <section className="rounded-[2rem] border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
          Detail Form
        </p>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">客注内容を編集</h2>
        <p className="mt-1 text-sm text-gray-500">
          一覧カードでは収まりきらない内容をここでまとめて更新できます。
        </p>
      </div>

      <form action={formAction} className="space-y-6 px-6 py-6">
        <input type="hidden" name="id" value={order.id} />

        <OrderFormFields
          mode="edit"
          order={order}
          stores={stores}
          products={products}
          fieldErrors={state.fieldErrors}
        />

        {state.message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              state.status === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {state.message}
          </div>
        ) : null}

        <div className="flex justify-end border-t border-gray-200 pt-5">
          <SubmitButton />
        </div>
      </form>
    </section>
  )
}

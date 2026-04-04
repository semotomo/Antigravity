'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { X } from 'lucide-react'
import { saveOrderAction } from '@/app/actions/orders'
import { OrderFormFields } from '@/components/orders/OrderFormFields'
import {
  initialOrderMutationState,
  type OrderListRow,
  type OrderProductOption,
  type OrderStoreOption,
} from '@/lib/orders'

type OrderFormModalProps = {
  open: boolean
  mode: 'create' | 'edit'
  order: OrderListRow | null
  stores: OrderStoreOption[]
  products: OrderProductOption[]
  onClose: () => void
}

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
    >
      {pending ? '保存中...' : mode === 'create' ? '登録する' : '更新する'}
    </button>
  )
}

export function OrderFormModal({
  open,
  mode,
  order,
  stores,
  products,
  onClose,
}: OrderFormModalProps) {
  const [state, formAction] = useActionState(saveOrderAction, initialOrderMutationState)

  useEffect(() => {
    if (state.status === 'success') {
      onClose()
    }
  }, [onClose, state.status])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
              Customer Orders
            </p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">
              {mode === 'create' ? '新規客注を登録' : '客注を編集'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              必須項目だけ先に埋めて、残りはあとから追記できます。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form action={formAction} className="space-y-6 px-6 py-6">
          {order ? <input type="hidden" name="id" value={order.id} /> : null}

          <OrderFormFields
            mode={mode}
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

          <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              閉じる
            </button>
            <SubmitButton mode={mode} />
          </div>
        </form>
      </div>
    </div>
  )
}

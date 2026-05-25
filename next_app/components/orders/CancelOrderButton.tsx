'use client'

import { useFormStatus } from 'react-dom'
import { cancelOrderAction } from '@/app/actions/orders'

type CancelOrderButtonProps = {
  orderId: string
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200"
    >
      {pending ? 'キャンセル処理中...' : 'キャンセルにする'}
    </button>
  )
}

export function CancelOrderButton({ orderId }: CancelOrderButtonProps) {
  return (
    <form action={cancelOrderAction} className="mt-6">
      <input type="hidden" name="id" value={orderId} />
      <SubmitButton />
    </form>
  )
}

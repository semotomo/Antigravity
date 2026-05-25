'use client'

import { Trash2 } from 'lucide-react'
import { deleteOrderAction } from '@/app/actions/orders'

type DeleteOrderButtonProps = {
  orderId: string
}

export function DeleteOrderButton({ orderId }: DeleteOrderButtonProps) {
  return (
    <form
      action={deleteOrderAction}
      className="mt-6"
      onSubmit={(e) => {
        if (
          !confirm(
            'この客注データを完全に削除してもよろしいですか？\nこの操作は取り消せません。'
          )
        ) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="id" value={orderId} />
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
      >
        <Trash2 className="h-4 w-4" />
        この客注を削除する
      </button>
    </form>
  )
}

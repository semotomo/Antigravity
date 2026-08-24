'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

type InventoryReasonDialogProps = {
  title: string
  description: string
  confirmLabel: string
  error: string
  pending: boolean
  destructive?: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<boolean>
}

export function InventoryReasonDialog({
  title,
  description,
  confirmLabel,
  error,
  pending,
  destructive = false,
  onClose,
  onConfirm,
}: InventoryReasonDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  const submit = async () => {
    const normalized = reason.trim()
    if (!normalized) {
      setLocalError('理由を入力してください。')
      return
    }
    setLocalError('')
    await onConfirm(normalized)
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/60"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${destructive ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}>
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId} className="text-balance text-lg font-bold">{title}</h2>
            <p className="mt-1 text-pretty text-sm text-gray-600">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label="確認画面を閉じる"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        <label htmlFor={reasonId} className="block space-y-2">
          <span className="text-sm font-semibold text-gray-800">理由（必須）</span>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            autoFocus
            className="w-full resize-y rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
          />
        </label>
        {localError || error ? (
          <p className="text-sm font-medium text-red-700" role="alert">{localError || error}</p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className={`rounded-xl px-4 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 ${destructive ? 'bg-red-700 hover:bg-red-800 focus-visible:ring-red-600' : 'bg-sky-700 hover:bg-sky-800 focus-visible:ring-sky-600'}`}
          >
            {pending ? '処理中...' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </dialog>
  )
}

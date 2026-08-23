'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { PackageCheck, X } from 'lucide-react'

import { cn } from '@/components/ui/StatusBadge'
import type { InventoryCountMode } from '@/lib/inventory/validation'
import type { InventoryWorkspaceItem } from '@/lib/inventory/workspace'

type InventoryCountDialogProps = {
  error: string
  item: InventoryWorkspaceItem
  saving: boolean
  onClose: () => void
  onSave: (mode: InventoryCountMode, quantity: number) => Promise<boolean>
}

export function InventoryCountDialog({
  error,
  item,
  saving,
  onClose,
  onSave,
}: InventoryCountDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const inputId = useId()
  const [quantity, setQuantity] = useState(item.countedQuantity === null ? '' : '1')
  const [localError, setLocalError] = useState('')
  const alreadyCounted = item.countedQuantity !== null

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  const submit = async (mode: InventoryCountMode) => {
    const normalized = quantity.trim()
    if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
      setLocalError('数量は0以上、小数3桁以内で入力してください。')
      return
    }
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setLocalError('数量は0以上で入力してください。')
      return
    }
    setLocalError('')
    await onSave(mode, parsed)
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${inputId}-title`}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/60"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onClose()
      }}
    >
      <div className="border-b border-gray-200 px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <PackageCheck className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id={`${inputId}-title`} className="text-balance text-lg font-bold">
                {alreadyCounted
                  ? 'この商品は登録済みです。数量を追加しますか？'
                  : '実際の在庫数を入力'}
              </h2>
              <p className="mt-1 truncate text-sm font-medium text-gray-700">
                {item.productNameSnapshot}
              </p>
              <p className="mt-1 font-mono text-xs text-gray-500">JAN: {item.janSnapshot}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50"
            aria-label="数量入力を閉じる"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {alreadyCounted ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-xs font-medium text-sky-800">現在の入力数</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-sky-950">
              {item.countedQuantity}
            </p>
            <p className="mt-1 text-xs text-sky-800">
              追加では元の計数時刻を維持し、置き換えでは現在時刻を記録します。
            </p>
          </div>
        ) : null}

        <label htmlFor={inputId} className="block space-y-2">
          <span className="text-sm font-semibold text-gray-800">
            {alreadyCounted ? '追加または置き換える数量' : '実在庫数'}
          </span>
          <input
            id={inputId}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            min="0"
            step="0.001"
            autoFocus
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-xl font-bold tabular-nums outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            aria-describedby={`${inputId}-error`}
          />
        </label>

        {localError || error ? (
          <p id={`${inputId}-error`} className="text-sm font-medium text-red-700" role="alert">
            {localError || error}
          </p>
        ) : null}

        <div className={cn('grid gap-2', alreadyCounted ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {alreadyCounted ? (
            <>
              <button type="button" onClick={() => submit('add')} disabled={saving} className="rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:opacity-50">追加</button>
              <button type="button" onClick={() => submit('replace')} disabled={saving} className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50">数量を置き換える</button>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-xl px-4 py-3 text-sm font-bold text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50">キャンセル</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => submit('initial')} disabled={saving} className="rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:opacity-50">数量を保存</button>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50">キャンセル</button>
            </>
          )}
        </div>
      </div>
    </dialog>
  )
}

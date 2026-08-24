'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

import type { InventoryOverviewItem } from '@/lib/inventory/management'

type InventoryQuantityActionDialogProps = {
  mode: 'correction' | 'adjustment'
  item: InventoryOverviewItem
  error: string
  pending: boolean
  onClose: () => void
  onConfirm: (quantity: number, reason: string) => Promise<boolean>
}

export function InventoryQuantityActionDialog({
  mode,
  item,
  error,
  pending,
  onClose,
  onConfirm,
}: InventoryQuantityActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const quantityId = useId()
  const reasonId = useId()
  const [quantity, setQuantity] = useState(mode === 'correction' ? String(item.physicalQuantity) : '')
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
    const quantityPattern = mode === 'adjustment' ? /^-?\d+(?:\.\d{1,3})?$/ : /^\d+(?:\.\d{1,3})?$/
    if (!quantityPattern.test(quantity.trim())) {
      setLocalError(mode === 'adjustment' ? '符号付き、小数3桁以内で入力してください。' : '0以上、小数3桁以内で入力してください。')
      return
    }
    const parsed = Number(quantity)
    if (!Number.isFinite(parsed) || (mode === 'adjustment' && parsed === 0) || (mode === 'correction' && parsed < 0)) {
      setLocalError(mode === 'adjustment' ? '0以外の調整数を入力してください。' : '0以上の数量を入力してください。')
      return
    }
    if (!reason.trim()) {
      setLocalError('理由を入力してください。')
      return
    }
    setLocalError('')
    await onConfirm(parsed, reason.trim())
  }

  const correction = mode === 'correction'
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/60" onCancel={(event) => { event.preventDefault(); if (!pending) onClose() }}>
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700"><SlidersHorizontal className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-balance text-lg font-bold">{correction ? '確定済み数量を訂正' : '現在庫を手動調整'}</h2>
            <p className="mt-1 truncate text-sm font-medium text-gray-700">{item.productName}</p>
            <p className="mt-1 font-mono text-xs text-gray-500">JAN: {item.janCode}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} disabled={pending} aria-label="数量操作を閉じる" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50"><X className="size-5" aria-hidden="true" /></button>
      </div>
      <div className="space-y-4 px-5 py-5 sm:px-6">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <span>{correction ? '現在の確定物理数' : '現在庫'}: </span>
          <strong className="tabular-nums">{correction ? item.physicalQuantity : item.calculatedQuantity}</strong>
          <p className="mt-1 text-pretty text-xs text-gray-500">
            {correction ? '元の計数時刻を維持して数量だけを訂正します。' : '増加は正数、減少は負数で入力し、取消時も反対符号の履歴を追加します。'}
          </p>
        </div>
        <label htmlFor={quantityId} className="block space-y-2">
          <span className="text-sm font-semibold text-gray-800">{correction ? '訂正後の実在庫数' : '調整数（±）'}</span>
          <input id={quantityId} value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" autoFocus className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-right text-xl font-bold tabular-nums outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" />
        </label>
        <label htmlFor={reasonId} className="block space-y-2">
          <span className="text-sm font-semibold text-gray-800">理由（必須）</span>
          <textarea id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} className="w-full resize-y rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" />
        </label>
        {localError || error ? <p className="text-sm font-medium text-red-700" role="alert">{localError || error}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => void submit()} disabled={pending} className="rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:opacity-50">{pending ? '保存中...' : correction ? '数量を訂正' : '手動調整を追加'}</button>
          <button type="button" onClick={onClose} disabled={pending} className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50">キャンセル</button>
        </div>
      </div>
    </dialog>
  )
}

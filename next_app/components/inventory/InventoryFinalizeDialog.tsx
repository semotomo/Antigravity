'use client'

import { useEffect, useId, useRef } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, X } from 'lucide-react'

import type { InventoryFinalizationReview } from '@/lib/inventory/recalculationService'

type InventoryFinalizeDialogProps = {
  error: string
  pending: boolean
  review: InventoryFinalizationReview | null
  onClose: () => void
  onFinalize: () => Promise<void>
  onReview: () => Promise<void>
}

export function InventoryFinalizeDialog({
  error,
  pending,
  review,
  onClose,
  onFinalize,
  onReview,
}: InventoryFinalizeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/60"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <ClipboardCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId} className="text-balance text-lg font-bold">棚卸しを確定</h2>
            <p className="mt-1 text-pretty text-sm text-gray-600">
              最新のPOS履歴で書き込みなしの確定前チェックを行い、問題がない場合だけ現在庫を更新します。
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} disabled={pending} aria-label="棚卸し確定を閉じる" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {!review ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-pretty text-sm text-gray-700">
              チェック中に販売・返品履歴を取得します。下書き数量や現在庫はこの段階では変更しません。
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['未棚卸し', review.pendingCount],
                ['POS未照合', review.unmatchedCount],
                ['同分時刻', review.ambiguousCount],
                ['マイナス', review.negativeCount],
                ['差異警告', review.largeAdjustmentCount],
                ['計算商品', review.balanceCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-gray-200 p-3">
                  <p className="text-xs font-medium text-gray-600">{label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gray-950">{value}</p>
                </div>
              ))}
            </div>

            {review.canFinalize ? (
              <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                確定を妨げる問題はありません。表示された計算基準時刻で確定できます。
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <p className="text-pretty">
                  未入力を計数または理由付き除外し、未照合は商品マスタを修正してください。同分時刻の商品は現物を再確認して数量を置き換え、計数時刻を更新してください。
                </p>
              </div>
            )}

            {review.issues.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-gray-900">確定前に確認するPOS履歴</h3>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-gray-200 p-2">
                  {review.issues.map((issue) => (
                    <div key={`${issue.kind}:${issue.rowNo}`} className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{issue.kind === 'same_minute' ? '計数と同じ分' : 'JAN未照合'}</strong>
                        <span className="tabular-nums">数量 {issue.quantity}</span>
                      </div>
                      <p className="mt-1 truncate">{issue.productName || '商品名なし'} / JAN {issue.janCode || 'なし'}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        {error ? <p className="text-sm font-medium text-red-700" role="alert">{error}</p> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          {!review || !review.canFinalize ? (
            <button type="button" onClick={() => void onReview()} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:opacity-50">
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              確定前チェック
            </button>
          ) : (
            <button type="button" onClick={() => void onFinalize()} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:opacity-50">
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              この内容で確定する
            </button>
          )}
          <button type="button" onClick={onClose} disabled={pending} className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50">閉じる</button>
        </div>
      </div>
    </dialog>
  )
}

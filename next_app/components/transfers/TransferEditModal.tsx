'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { updateTransferAction, deleteTransferAction } from '@/app/actions/transfers'
import {
  TRANSFER_ENTRY_TYPE_OPTIONS,
  TRANSFER_USAGE_CATEGORY_OPTIONS,
  initialTransferMutationState,
  type TransferListRow,
  type TransferStoreOption,
  type TransferEntryType,
  type TransferUsageCategory,
} from '@/lib/transfers'

type TransferEditModalProps = {
  open: boolean
  transfer: TransferListRow
  stores: TransferStoreOption[]
  onClose: () => void
}

export function TransferEditModal({ open, transfer, stores, onClose }: TransferEditModalProps) {
  const [state, formAction] = useActionState(updateTransferAction, initialTransferMutationState)
  const [isDeleting, setIsDeleting] = useState(false)

  // フォームステートの初期設定
  const [entryType, setEntryType] = useState<TransferEntryType>(transfer.entry_type as TransferEntryType)
  const [fromStoreId, setFromStoreId] = useState<number>(transfer.from_store_id)
  const [toStoreId, setToStoreId] = useState<number | null>(transfer.to_store_id)
  const [quantity, setQuantity] = useState<number>(transfer.quantity)
  const [costPrice, setCostPrice] = useState<number>(transfer.cost_price ?? 0)
  const [sellingPrice, setSellingPrice] = useState<number>(transfer.selling_price ?? 0)
  const [usageCategory, setUsageCategory] = useState<TransferUsageCategory>(
    (transfer.usage_category as TransferUsageCategory) ?? 'expired'
  )
  const [memo, setMemo] = useState<string>(transfer.memo ?? '')

  // スクロールロック
  useEffect(() => {
    if (open) {
      const originalStyle = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  // アクションが成功したら閉じる
  useEffect(() => {
    if (state.status === 'success') {
      onClose()
    }
  }, [onClose, state.status])

  const destinationStores = useMemo(() => {
    return stores.filter((store) => store.id !== fromStoreId)
  }, [fromStoreId, stores])

  if (!open) return null

  // 削除ボタン押下時のハンドリング
  const handleDelete = async () => {
    if (!window.confirm(`「${transfer.product_name}」の移動履歴を削除しますか？`)) {
      return
    }

    setIsDeleting(true)
    try {
      const formData = new FormData()
      formData.append('id', String(transfer.id))
      await deleteTransferAction(formData)
      onClose()
    } catch (e) {
      console.error(e)
      alert('削除に失敗しました。')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl relative my-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">移動履歴の編集</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-[340px] truncate">{transfer.product_name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* メインフォーム */}
        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="id" value={transfer.id} />

          {/* 区分 */}
          <div className="space-y-2">
            <span className="text-sm font-semibold text-gray-700 block">区分</span>
            <div className="flex gap-2">
              {TRANSFER_ENTRY_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEntryType(opt.value as TransferEntryType)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition ${
                    entryType === opt.value
                      ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="entry_type" value={entryType} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* 移動元 / 使用店舗 */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 block">
                {entryType === 'usage' ? '使用店舗' : '移動元店舗'}
              </label>
              <select
                name="from_store_id"
                value={fromStoreId}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setFromStoreId(val)
                  if (toStoreId === val) setToStoreId(null)
                }}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 移動先 / 物品使用区分 */}
            {entryType === 'transfer' ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 block">移動先店舗</label>
                <select
                  name="to_store_id"
                  value={toStoreId ?? ''}
                  onChange={(e) => setToStoreId(Number(e.target.value) || null)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition"
                >
                  <option value="">選択してください</option>
                  {destinationStores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                {state.fieldErrors.to_store_id && (
                  <span className="text-xs text-red-500 block">{state.fieldErrors.to_store_id}</span>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 block">物品使用区分</label>
                <select
                  name="usage_category"
                  value={usageCategory}
                  onChange={(e) => setUsageCategory(e.target.value as TransferUsageCategory)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition"
                >
                  {TRANSFER_USAGE_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {state.fieldErrors.usage_category && (
                  <span className="text-xs text-red-500 block">{state.fieldErrors.usage_category}</span>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {/* 数量 */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 block">数量</label>
              <input
                type="number"
                name="quantity"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition"
              />
              {state.fieldErrors.quantity && (
                <span className="text-xs text-red-500 block">{state.fieldErrors.quantity}</span>
              )}
            </div>

            {/* 原価 */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 block">原価 (¥)</label>
              <input
                type="number"
                name="cost_price"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(Number(e.target.value))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition"
              />
              {state.fieldErrors.cost_price && (
                <span className="text-xs text-red-500 block">{state.fieldErrors.cost_price}</span>
              )}
            </div>

            {/* 売価 */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 block">売価 (¥)</label>
              <input
                type="number"
                name="selling_price"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(Number(e.target.value))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition"
              />
            </div>
          </div>

          {/* メモ */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 block">メモ</label>
            <textarea
              name="memo"
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 transition resize-none"
              placeholder="備考があれば入力してください"
            />
          </div>

          {/* メッセージ */}
          {state.status === 'error' && (
            <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              {state.message}
            </div>
          )}

          {/* ボタン */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-4 mt-6">
            {/* 削除ボタン */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <Trash2 className="h-4 w-4" />
              {isDeleting ? '削除中...' : '履歴を削除'}
            </button>

            {/* 保存ボタン */}
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800"
            >
              変更を保存する
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { X } from 'lucide-react'
import { updateProductAction } from '@/app/actions/products'
import {
  initialProductMutationState,
  type ProductListRow,
} from '@/lib/products'

type ProductFormModalProps = {
  open: boolean
  product: ProductListRow | null
  onClose: () => void
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
    >
      {pending ? '保存中...' : '更新する'}
    </button>
  )
}

export function ProductFormModal({ open, product, onClose }: ProductFormModalProps) {
  const [state, formAction] = useActionState(updateProductAction, initialProductMutationState)

  useEffect(() => {
    if (state.status === 'success') {
      onClose()
    }
  }, [onClose, state.status])

  if (!open || !product) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
              Products
            </p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">商品マスタを編集</h2>
            <p className="mt-1 text-sm text-gray-500">
              売上分析に反映される基本情報と有効状態を更新します。
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
          <input type="hidden" name="id" value={product.id} />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-gray-700">商品名 *</span>
              <input
                name="product_name"
                required
                defaultValue={product.product_name ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
              {state.fieldErrors.product_name ? (
                <span className="text-xs text-red-600">{state.fieldErrors.product_name}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">JAN コード</span>
              <input
                name="jan_code"
                inputMode="numeric"
                defaultValue={product.jan_code ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
              {state.fieldErrors.jan_code ? (
                <span className="text-xs text-red-600">{state.fieldErrors.jan_code}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">カテゴリ</span>
              <input
                name="category"
                defaultValue={product.category ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">仕入れ先</span>
              <input
                name="supplier_name"
                defaultValue={product.supplier_name ?? ''}
                placeholder="仕入れ先名を入力"
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">商品グループ</span>
              <input
                name="product_group"
                defaultValue={product.product_group ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">ブランド</span>
              <input
                name="brand"
                defaultValue={product.brand ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">原価</span>
              <input
                name="cost_price"
                type="number"
                min={0}
                step={1}
                defaultValue={product.cost_price ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
              {state.fieldErrors.cost_price ? (
                <span className="text-xs text-red-600">{state.fieldErrors.cost_price}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">売価</span>
              <input
                name="selling_price"
                type="number"
                min={0}
                step={1}
                defaultValue={product.selling_price ?? ''}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
              {state.fieldErrors.selling_price ? (
                <span className="text-xs text-red-600">{state.fieldErrors.selling_price}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">ステータス</span>
              <select
                name="is_active"
                defaultValue={product.is_active ? 'true' : 'false'}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              >
                <option value="true">有効</option>
                <option value="false">停止</option>
              </select>
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-gray-700">タグ (カンマ区切りで複数設定可能)</span>
              <input
                name="tags"
                defaultValue={product.tags ?? ''}
                placeholder="例: わんわん, 本店"
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              />
            </label>
          </div>

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
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  )
}

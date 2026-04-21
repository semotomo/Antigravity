'use client'

import { useMemo, useState } from 'react'
import type {
  OrderListRow,
  OrderMutationState,
  OrderProductOption,
  OrderStoreOption,
} from '@/lib/orders'
import { getTodayDateInputValue, ORDER_STATUSES, ORDER_STATUS_LABELS } from '@/lib/orders'
import { JanCodeScannerField } from '@/components/orders/JanCodeScannerField'

type OrderFormFieldsProps = {
  mode: 'create' | 'edit'
  order: OrderListRow | null
  stores: OrderStoreOption[]
  products: OrderProductOption[]
  fieldErrors: OrderMutationState['fieldErrors']
}

function normalizeJanCode(value: string) {
  return value.replace(/\D/g, '')
}

function hasCompleteJanCodeLength(value: string) {
  return value.length === 8 || value.length === 12 || value.length === 13
}

export function OrderFormFields({
  mode,
  order,
  stores,
  products,
  fieldErrors,
}: OrderFormFieldsProps) {
  const mainStore = stores.find((store) => store.name === '本店')
  const defaultStoreId =
    order?.store_id !== null && order?.store_id !== undefined
      ? String(order.store_id)
      : mode === 'create' && mainStore
        ? String(mainStore.id)
        : ''
  const defaultJanCode = order?.jan_code ?? order?.product?.jan_code ?? ''
  const defaultOrderDate = order?.order_date ?? (mode === 'create' ? getTodayDateInputValue() : '')
  const [itemName, setItemName] = useState(order?.item_name ?? '')
  const [janCode, setJanCode] = useState(defaultJanCode)
  const [selectedProductId, setSelectedProductId] = useState(
    order?.product_id ? String(order.product_id) : ''
  )
  const productsByJanCode = useMemo(() => {
    const productMap = new Map<string, OrderProductOption>()

    products.forEach((product) => {
      const normalizedJanCode = normalizeJanCode(product.jan_code ?? '')

      if (normalizedJanCode && !productMap.has(normalizedJanCode)) {
        productMap.set(normalizedJanCode, product)
      }
    })

    return productMap
  }, [products])
  const normalizedJanCode = normalizeJanCode(janCode)
  const matchedProduct = normalizedJanCode ? productsByJanCode.get(normalizedJanCode) : null

  function handleJanCodeChange(value: string) {
    setJanCode(value)

    const normalizedValue = normalizeJanCode(value)
    const product = normalizedValue ? productsByJanCode.get(normalizedValue) : null

    if (product) {
      setSelectedProductId(String(product.id))
      setItemName(product.product_name || '')
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">お客様名 *</span>
        <input
          name="customer_name"
          required
          defaultValue={order?.customer_name ?? ''}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
        {fieldErrors.customer_name ? (
          <span className="text-xs text-red-600">{fieldErrors.customer_name}</span>
        ) : null}
      </label>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">電話番号</span>
        <input
          name="phone_number"
          defaultValue={order?.phone_number ?? ''}
          placeholder="未入力でも登録できます"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
        {fieldErrors.phone_number ? (
          <span className="text-xs text-red-600">{fieldErrors.phone_number}</span>
        ) : null}
      </label>

      <label className="space-y-2 md:col-span-2">
        <span className="text-sm font-medium text-gray-700">商品名 / 数量 *</span>
        <input
          name="item_name"
          required
          value={itemName}
          onChange={(event) => setItemName(event.target.value)}
          placeholder="例: ロイヤルカナン 3kg 1袋"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
        {fieldErrors.item_name ? (
          <span className="text-xs text-red-600">{fieldErrors.item_name}</span>
        ) : null}
      </label>

      <label className="space-y-2 md:col-span-2">
        <span className="text-sm font-medium text-gray-700">メーカー・品番など</span>
        <input
          name="item_details"
          defaultValue={order?.item_details ?? ''}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
      </label>

      <div className="space-y-2 md:col-span-2">
        <JanCodeScannerField
          defaultValue={defaultJanCode}
          error={fieldErrors.jan_code}
          onValueChange={handleJanCodeChange}
        />
        {matchedProduct ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            JANコードに一致: {matchedProduct.product_name}
            {matchedProduct.category ? ` / ${matchedProduct.category}` : ''}
          </p>
        ) : hasCompleteJanCodeLength(normalizedJanCode) ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            商品マスタに一致するJANコードが見つかりません。商品名は手入力できます。
          </p>
        ) : null}
      </div>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">受付担当</span>
        <input
          name="staff_name"
          defaultValue={order?.staff_name ?? ''}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
      </label>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">ステータス</span>
        <select
          name="status"
          defaultValue={order?.status ?? 'pending'}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        >
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {fieldErrors.status ? (
          <span className="text-xs text-red-600">{fieldErrors.status}</span>
        ) : null}
      </label>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">受付No.</span>
        <input
          name="order_no"
          defaultValue={order?.order_no ?? ''}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
      </label>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">数量</span>
        <input
          name="quantity"
          type="number"
          min={1}
          step={1}
          defaultValue={order?.quantity ?? 1}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
        {fieldErrors.quantity ? (
          <span className="text-xs text-red-600">{fieldErrors.quantity}</span>
        ) : null}
      </label>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">受付店舗</span>
        <select
          name="store_id"
          defaultValue={defaultStoreId}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        >
          <option value="">未設定</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2 md:col-span-2">
        <span className="text-sm font-medium text-gray-700">商品マスタ紐付け</span>
        <select
          name="product_id"
          value={selectedProductId}
          onChange={(event) => setSelectedProductId(event.target.value)}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        >
          <option value="">未設定</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.product_name}
              {product.category ? ` / ${product.category}` : ''}
              {product.jan_code ? ` / JAN:${product.jan_code}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2">
        <span className="text-sm font-medium text-gray-700">受付日</span>
        <input
          name="order_date"
          type="date"
          defaultValue={defaultOrderDate}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
        {fieldErrors.order_date ? (
          <span className="text-xs text-red-600">{fieldErrors.order_date}</span>
        ) : null}
      </label>

      <label className="space-y-2 md:col-span-2">
        <span className="text-sm font-medium text-gray-700">メモ</span>
        <textarea
          name="notes"
          defaultValue={order?.notes ?? ''}
          rows={4}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
        />
      </label>
    </div>
  )
}

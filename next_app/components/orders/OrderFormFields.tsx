import type {
  OrderListRow,
  OrderMutationState,
  OrderProductOption,
  OrderStoreOption,
} from '@/lib/orders'
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '@/lib/orders'
import { JanCodeScannerField } from '@/components/orders/JanCodeScannerField'

type OrderFormFieldsProps = {
  mode: 'create' | 'edit'
  order: OrderListRow | null
  stores: OrderStoreOption[]
  products: OrderProductOption[]
  fieldErrors: OrderMutationState['fieldErrors']
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
        <span className="text-sm font-medium text-gray-700">電話番号 *</span>
        <input
          name="phone_number"
          required
          defaultValue={order?.phone_number ?? ''}
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
          defaultValue={order?.item_name ?? ''}
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

      <JanCodeScannerField defaultValue={defaultJanCode} error={fieldErrors.jan_code} />

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
          defaultValue={order?.product_id ?? ''}
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
          defaultValue={order?.order_date ?? ''}
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

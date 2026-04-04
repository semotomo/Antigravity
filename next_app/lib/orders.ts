import type { Database } from '@/lib/types/database'

export const ORDER_STATUSES = [
  'pending',
  'ordered',
  'arrived',
  'contacted',
  'completed',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '未発注',
  ordered: '入荷待ち',
  arrived: '連絡待ち',
  contacted: 'お渡し待ち',
  completed: '完了',
  cancelled: 'キャンセル',
}

export const ACTIVE_ORDER_STATUSES = [
  'pending',
  'ordered',
  'arrived',
  'contacted',
] as const satisfies readonly OrderStatus[]

export const TERMINAL_ORDER_STATUSES = [
  'completed',
  'cancelled',
] as const satisfies readonly OrderStatus[]

export const ORDER_FILTERS = ['all', ...ORDER_STATUSES] as const

export type OrderFilter = (typeof ORDER_FILTERS)[number]

export const ORDER_FILTER_LABELS: Record<OrderFilter, string> = {
  all: 'すべて',
  pending: ORDER_STATUS_LABELS.pending,
  ordered: ORDER_STATUS_LABELS.ordered,
  arrived: ORDER_STATUS_LABELS.arrived,
  contacted: ORDER_STATUS_LABELS.contacted,
  completed: ORDER_STATUS_LABELS.completed,
  cancelled: ORDER_STATUS_LABELS.cancelled,
}

export const ORDER_STATUS_BADGE_VARIANTS: Record<
  OrderStatus,
  'warning' | 'info' | 'gray' | 'success' | 'danger'
> = {
  pending: 'warning',
  ordered: 'info',
  arrived: 'gray',
  contacted: 'success',
  completed: 'success',
  cancelled: 'danger',
}

export const ORDER_NEXT_ACTIONS: Partial<
  Record<OrderStatus, { nextStatus: OrderStatus; label: string }>
> = {
  pending: { nextStatus: 'ordered', label: '発注済にする' },
  ordered: { nextStatus: 'arrived', label: '入荷済にする' },
  arrived: { nextStatus: 'contacted', label: '連絡済にする' },
  contacted: { nextStatus: 'completed', label: 'お渡し完了にする' },
}

export type CustomerOrderRow = Database['public']['Tables']['customer_orders']['Row']
export type CustomerOrderInsert = Database['public']['Tables']['customer_orders']['Insert']
export type CustomerOrderUpdate = Database['public']['Tables']['customer_orders']['Update']
export type StoreRow = Database['public']['Tables']['stores']['Row']
export type ProductRow = Database['public']['Tables']['products']['Row']

export type OrderStoreOption = Pick<StoreRow, 'id' | 'name'>
export type OrderProductOption = Pick<
  ProductRow,
  'id' | 'product_name' | 'jan_code' | 'category'
>

export type OrderListRow = CustomerOrderRow & {
  store: OrderStoreOption | null
  product: OrderProductOption | null
}

export type OrderCounts = Record<OrderFilter, number>

export type OrderFormField =
  | 'customer_name'
  | 'phone_number'
  | 'item_name'
  | 'jan_code'
  | 'status'
  | 'order_no'
  | 'quantity'
  | 'order_date'
  | 'store_id'
  | 'product_id'

export type OrderMutationState = {
  status: 'idle' | 'success' | 'error'
  message: string
  fieldErrors: Partial<Record<OrderFormField, string>>
}

export const initialOrderMutationState: OrderMutationState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
}

export function isOrderFilter(value: string): value is OrderFilter {
  return (ORDER_FILTERS as readonly string[]).includes(value)
}

export function getOrderStatusLabel(status: string | null | undefined) {
  if (!status || !isOrderStatus(status)) {
    return ORDER_STATUS_LABELS.pending
  }

  return ORDER_STATUS_LABELS[status]
}

export function getNextOrderAction(status: string | null | undefined) {
  if (!status || !isOrderStatus(status)) {
    return null
  }

  return ORDER_NEXT_ACTIONS[status] ?? null
}

export function buildOrderCounts(orders: OrderListRow[]): OrderCounts {
  const counts: OrderCounts = {
    all: orders.length,
    pending: 0,
    ordered: 0,
    arrived: 0,
    contacted: 0,
    completed: 0,
    cancelled: 0,
  }

  orders.forEach((order) => {
    if (isOrderStatus(order.status)) {
      counts[order.status] += 1
    }
  })

  return counts
}

export function formatOrderDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
) {
  if (!value) {
    return '-'
  }

  const normalized = value.includes('T') ? value : `${value}T00:00:00`
  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return new Intl.DateTimeFormat('ja-JP', options).format(date)
}

export function formatOrderDateTime(value: string | null | undefined) {
  return formatOrderDate(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function normalizeOptionalText(value: FormDataEntryValue | null) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

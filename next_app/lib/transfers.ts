import type { Database } from '@/lib/types/database'

export type TransferRow = Database['public']['Tables']['transfers']['Row']
export type TransferInsert = Database['public']['Tables']['transfers']['Insert']
export type TransferUpdate = Database['public']['Tables']['transfers']['Update']
export type TransferStoreOption = Pick<Database['public']['Tables']['stores']['Row'], 'id' | 'name'>
export type TransferProductOption = Pick<
  Database['public']['Tables']['products']['Row'],
  'id' | 'jan_code' | 'product_name' | 'cost_price' | 'selling_price' | 'category'
>

export type TransferListRow = TransferRow & {
  from_store: TransferStoreOption | null
  to_store: TransferStoreOption | null
}

export type TransferHistoryFilter = {
  dateFrom?: string
  dateTo?: string
  fromStoreId?: number
  toStoreId?: number
}

export type TransferDraftItem = {
  jan_code: string
  product_name: string
  quantity: number
  cost_price: number
  selling_price: number
  memo: string | null
}

export type TransferActionField =
  | 'from_store_id'
  | 'to_store_id'
  | 'jan_code'
  | 'product_name'
  | 'quantity'
  | 'cost_price'
  | 'selling_price'
  | 'items'

export type TransferMutationState = {
  status: 'idle' | 'success' | 'error'
  message: string
  fieldErrors: Partial<Record<TransferActionField, string>>
}

export const initialTransferMutationState: TransferMutationState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
}

export function isValidJanCode(value: string) {
  return /^(\d{8}|\d{13})$/.test(value)
}

export function normalizeJanCode(value: string) {
  return value.replace(/\D/g, '')
}

export function normalizeOptionalText(value: FormDataEntryValue | string | null | undefined) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

export function chooseDefaultTransferFromStoreId(stores: TransferStoreOption[]) {
  const mainStore = stores.find((store) => store.name === '本店')
  return mainStore?.id ?? stores[0]?.id ?? null
}

export function chooseDefaultTransferToStoreId(
  stores: TransferStoreOption[],
  fromStoreId: number | null
) {
  const destination = stores.find((store) => store.id !== fromStoreId)
  return destination?.id ?? null
}

export function formatTransferDateTime(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatTransferDateKey(value: string | null | undefined) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return `${year}-${month}-${day}`
}

export function summarizeTransferDraftItems(items: TransferDraftItem[]) {
  return {
    productCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCost: items.reduce((sum, item) => sum + item.cost_price * item.quantity, 0),
  }
}

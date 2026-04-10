import type { Database } from '@/lib/types/database'

export type TransferRow = Database['public']['Tables']['transfers']['Row']
export type TransferInsert = Database['public']['Tables']['transfers']['Insert']
export type TransferUpdate = Database['public']['Tables']['transfers']['Update']
export type TransferStoreOption = Pick<Database['public']['Tables']['stores']['Row'], 'id' | 'name'>
export type TransferProductOption = Pick<
  Database['public']['Tables']['products']['Row'],
  'id' | 'jan_code' | 'product_name' | 'cost_price' | 'selling_price' | 'category'
>

export type TransferEntryType = 'transfer' | 'usage'
export type TransferUsageCategory = 'expired' | 'internal_use' | 'gift'

export const TRANSFER_ENTRY_TYPE_OPTIONS: Array<{
  value: TransferEntryType
  label: string
}> = [
  { value: 'transfer', label: '店舗間移動' },
  { value: 'usage', label: '物品使用' },
]

export const TRANSFER_USAGE_CATEGORY_OPTIONS: Array<{
  value: TransferUsageCategory
  label: string
}> = [
  { value: 'expired', label: '賞味期限切れ' },
  { value: 'internal_use', label: '店内使用' },
  { value: 'gift', label: 'プレゼント用' },
]

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
  entry_type: TransferEntryType
  usage_category: TransferUsageCategory | null
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
  | 'entry_type'
  | 'usage_category'
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

export function isValidTransferEntryType(value: string): value is TransferEntryType {
  return value === 'transfer' || value === 'usage'
}

export function isValidTransferUsageCategory(value: string): value is TransferUsageCategory {
  return value === 'expired' || value === 'internal_use' || value === 'gift'
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

export function formatTransferEntryTypeLabel(value: TransferEntryType | string | null | undefined) {
  if (value === 'usage') {
    return '物品使用'
  }

  return '店舗間移動'
}

export function formatTransferUsageCategoryLabel(
  value: TransferUsageCategory | string | null | undefined
) {
  switch (value) {
    case 'expired':
      return '賞味期限切れ'
    case 'internal_use':
      return '店内使用'
    case 'gift':
      return 'プレゼント用'
    default:
      return '-'
  }
}

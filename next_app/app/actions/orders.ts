'use server'

import { revalidatePath, refresh } from 'next/cache'
import {
  getTodayDateInputValue,
  initialOrderMutationState,
  isOrderStatus,
  normalizeOptionalText,
  type CustomerOrderInsert,
  type CustomerOrderUpdate,
  type OrderMutationState,
  type OrderStatus,
} from '@/lib/orders'
import { createClient } from '@/lib/supabase/server'

const JAN_CODE_PATTERN = /^(\d{8}|\d{12}|\d{13})$/
const ORDER_NO_BATCH_SIZE = 1000
const AUTO_ORDER_NO_RETRY_LIMIT = 5

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
type CustomerOrderNoRow = Pick<CustomerOrderInsert, 'order_no'>
type PostgrestErrorLike = {
  code?: string
  message?: string
  details?: string
}

function getTrimmedValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseOptionalNumber(
  formData: FormData,
  key: 'store_id' | 'product_id',
  fieldErrors: OrderMutationState['fieldErrors']
) {
  const value = normalizeOptionalText(formData.get(key))
  if (!value) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fieldErrors[key] = '数値で入力してください。'
    return null
  }

  return parsed
}

function parseRequiredQuantity(
  formData: FormData,
  fieldErrors: OrderMutationState['fieldErrors']
) {
  const value = getTrimmedValue(formData, 'quantity') || '1'
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    fieldErrors.quantity = '数量は1以上の整数で入力してください。'
    return null
  }

  return parsed
}

function parseOptionalDate(
  formData: FormData,
  key: 'order_date',
  fieldErrors: OrderMutationState['fieldErrors']
) {
  const value = normalizeOptionalText(formData.get(key))
  if (!value) {
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fieldErrors[key] = '日付形式が不正です。'
    return null
  }

  return value
}

function parseOptionalJanCode(
  formData: FormData,
  fieldErrors: OrderMutationState['fieldErrors']
) {
  const value = normalizeOptionalText(formData.get('jan_code'))
  if (!value) {
    return null
  }

  const normalizedValue = value.replace(/\D/g, '')
  if (!JAN_CODE_PATTERN.test(normalizedValue)) {
    fieldErrors.jan_code = 'JAN コードは 8 桁・12 桁・13 桁の数字で入力してください。'
    return null
  }

  return normalizedValue
}

function isDuplicateOrderNoError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as PostgrestErrorLike
  const combinedMessage = `${candidate.message ?? ''} ${candidate.details ?? ''}`
  return candidate.code === '23505' && combinedMessage.includes('order_no')
}

function formatOrderNo(value: number) {
  return String(value).padStart(5, '0')
}

async function fetchExistingOrderNos(supabase: SupabaseServerClient) {
  const orderNos: string[] = []
  let from = 0

  while (true) {
    const to = from + ORDER_NO_BATCH_SIZE - 1
    const { data, error } = await supabase
      .from('customer_orders')
      .select('order_no')
      .not('order_no', 'is', null)
      .order('order_no', { ascending: true })
      .range(from, to)

    if (error) {
      console.error('Error fetching order numbers:', error)
      throw new Error('受付No.の自動採番に失敗しました。')
    }

    const batch = (data ?? []) as CustomerOrderNoRow[]
    orderNos.push(
      ...batch
        .map((row) => row.order_no)
        .filter((orderNo): orderNo is string => Boolean(orderNo))
    )

    if (batch.length < ORDER_NO_BATCH_SIZE) {
      break
    }

    from += batch.length
  }

  return orderNos
}

async function generateNextOrderNo(supabase: SupabaseServerClient) {
  const existingOrderNos = await fetchExistingOrderNos(supabase)
  const maxNumericOrderNo = existingOrderNos.reduce((max, orderNo) => {
    if (!/^\d+$/.test(orderNo)) {
      return max
    }

    return Math.max(max, Number(orderNo))
  }, 0)

  return formatOrderNo(maxNumericOrderNo + 1)
}

async function requireAuthenticatedClient() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error('ログイン状態を確認できませんでした。再度ログインしてください。')
  }

  return supabase
}

function revalidateOrderPages(orderId?: string) {
  revalidatePath('/orders')
  revalidatePath('/orders/[id]', 'page')

  if (orderId) {
    revalidatePath(`/orders/${orderId}`)
  }
}

function buildOrderPayload(formData: FormData) {
  const fieldErrors: OrderMutationState['fieldErrors'] = {}

  const customerName = getTrimmedValue(formData, 'customer_name')
  const phoneNumber = getTrimmedValue(formData, 'phone_number')
  const itemName = getTrimmedValue(formData, 'item_name')
  const statusValue = getTrimmedValue(formData, 'status') || 'pending'
  const quantity = parseRequiredQuantity(formData, fieldErrors)
  const storeId = parseOptionalNumber(formData, 'store_id', fieldErrors)
  const productId = parseOptionalNumber(formData, 'product_id', fieldErrors)
  const janCode = parseOptionalJanCode(formData, fieldErrors)
  const orderDate = parseOptionalDate(formData, 'order_date', fieldErrors)

  if (!customerName) {
    fieldErrors.customer_name = 'お客様名を入力してください。'
  }

  if (!itemName) {
    fieldErrors.item_name = '商品名 / 数量を入力してください。'
  }

  if (!isOrderStatus(statusValue)) {
    fieldErrors.status = '不正なステータスです。'
  }

  const hasErrors = Object.keys(fieldErrors).length > 0
  if (hasErrors || quantity === null || !isOrderStatus(statusValue)) {
    return {
      fieldErrors,
      payload: null,
    }
  }

  const payload: CustomerOrderInsert = {
    order_no: normalizeOptionalText(formData.get('order_no')),
    customer_name: customerName,
    phone_number: phoneNumber,
    item_name: itemName,
    item_details: normalizeOptionalText(formData.get('item_details')),
    jan_code: janCode,
    staff_name: normalizeOptionalText(formData.get('staff_name')),
    notes: normalizeOptionalText(formData.get('notes')),
    status: statusValue,
    store_id: storeId,
    product_id: productId,
    quantity,
    order_date: orderDate,
  }

  return {
    fieldErrors,
    payload,
  }
}

export async function saveOrderAction(
  _prevState: OrderMutationState,
  formData: FormData
): Promise<OrderMutationState> {
  try {
    const supabase = await requireAuthenticatedClient()
    const orderId = getTrimmedValue(formData, 'id')
    const { fieldErrors, payload } = buildOrderPayload(formData)

    if (!payload) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors,
      }
    }

    const now = new Date().toISOString()

    if (orderId) {
      const updatePayload: CustomerOrderUpdate = {
        ...payload,
        updated_at: now,
      }
      const { error } = await supabase
        .from('customer_orders')
        .update(updatePayload as never)
        .eq('id', orderId)

      if (error) {
        console.error('Error updating order:', error)

        if (isDuplicateOrderNoError(error)) {
          return {
            status: 'error',
            message: '受付No.が重複しています。別の番号に変更してください。',
            fieldErrors: {
              order_no: 'この受付No.はすでに使われています。',
            },
          }
        }

        return {
          status: 'error',
          message: '客注の更新に失敗しました。',
          fieldErrors: {},
        }
      }

      revalidateOrderPages(orderId)
      refresh()

      return {
        status: 'success',
        message: '客注を更新しました。',
        fieldErrors: {},
      }
    }

    const baseInsertPayload: CustomerOrderInsert = {
      ...payload,
      order_date: payload.order_date ?? getTodayDateInputValue(),
      created_at: now,
      updated_at: now,
    }

    let insertError: unknown = null
    const usesManualOrderNo = Boolean(baseInsertPayload.order_no)

    for (let attempt = 0; attempt < AUTO_ORDER_NO_RETRY_LIMIT; attempt += 1) {
      const insertPayload: CustomerOrderInsert = {
        ...baseInsertPayload,
        order_no: usesManualOrderNo
          ? baseInsertPayload.order_no
          : await generateNextOrderNo(supabase),
      }

      const { error } = await supabase.from('customer_orders').insert(insertPayload as never)

      if (!error) {
        insertError = null
        break
      }

      insertError = error

      if (usesManualOrderNo || !isDuplicateOrderNoError(error)) {
        break
      }
    }

    if (insertError) {
      console.error('Error creating order:', insertError)

      if (isDuplicateOrderNoError(insertError)) {
        return {
          status: 'error',
          message: usesManualOrderNo
            ? '受付No.が重複しています。別の番号に変更してください。'
            : '受付No.の自動採番が重複しました。もう一度登録してください。',
          fieldErrors: {
            order_no: usesManualOrderNo
              ? 'この受付No.はすでに使われています。'
              : '自動採番に失敗しました。',
          },
        }
      }

      return {
        status: 'error',
        message: '客注の登録に失敗しました。',
        fieldErrors: {},
      }
    }

    revalidateOrderPages()
    refresh()

    return {
      status: 'success',
      message: '客注を登録しました。',
      fieldErrors: {},
    }
  } catch (error) {
    console.error('Unexpected error while saving order:', error)
    return {
      ...initialOrderMutationState,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '客注の保存中に予期しないエラーが発生しました。',
    }
  }
}

async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const supabase = await requireAuthenticatedClient()
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('customer_orders')
    .update({
      status,
      updated_at: now,
    } as never)
    .eq('id', orderId)

  if (error) {
    console.error('Error updating order status:', error)
    throw new Error('客注ステータスの更新に失敗しました。')
  }

  revalidateOrderPages(orderId)
  refresh()
}

export async function advanceOrderStatusAction(formData: FormData) {
  try {
    const orderId = getTrimmedValue(formData, 'id')
    const nextStatus = getTrimmedValue(formData, 'next_status')

    if (!orderId || !isOrderStatus(nextStatus)) {
      throw new Error('不正な客注更新リクエストです。')
    }

    await updateOrderStatus(orderId, nextStatus)
  } catch (error) {
    console.error('Unexpected error while advancing order status:', error)
  }
}

export async function cancelOrderAction(formData: FormData) {
  try {
    const orderId = getTrimmedValue(formData, 'id')

    if (!orderId) {
      throw new Error('不正な客注更新リクエストです。')
    }

    await updateOrderStatus(orderId, 'cancelled')
  } catch (error) {
    console.error('Unexpected error while cancelling order:', error)
  }
}

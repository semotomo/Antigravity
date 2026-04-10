'use server'

import { revalidatePath, refresh } from 'next/cache'
import {
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

  if (!phoneNumber) {
    fieldErrors.phone_number = '電話番号を入力してください。'
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

    const insertPayload: CustomerOrderInsert = {
      ...payload,
      created_at: now,
      updated_at: now,
    }

    const { error } = await supabase.from('customer_orders').insert(insertPayload as never)

    if (error) {
      console.error('Error creating order:', error)
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

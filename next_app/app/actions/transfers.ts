'use server'

import { revalidatePath, refresh } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  initialTransferMutationState,
  isValidJanCode,
  normalizeJanCode,
  normalizeOptionalText,
  type TransferDraftItem,
  type TransferInsert,
  type TransferMutationState,
} from '@/lib/transfers'

function getTrimmedValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseRequiredStoreId(
  formData: FormData,
  key: 'from_store_id' | 'to_store_id',
  fieldErrors: TransferMutationState['fieldErrors']
) {
  const value = getTrimmedValue(formData, key)
  const parsed = Number(value)

  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    fieldErrors[key] = '店舗を選択してください。'
    return null
  }

  return parsed
}

function parseTransferDraftItems(
  formData: FormData,
  fieldErrors: TransferMutationState['fieldErrors']
) {
  const rawItems = getTrimmedValue(formData, 'items_json')

  if (!rawItems) {
    fieldErrors.items = '移動リストに商品を追加してください。'
    return null
  }

  try {
    const parsed = JSON.parse(rawItems)

    if (!Array.isArray(parsed) || parsed.length === 0) {
      fieldErrors.items = '移動リストに商品を追加してください。'
      return null
    }

    const items: TransferDraftItem[] = []

    for (const item of parsed) {
      const janCode = normalizeJanCode(String(item?.jan_code ?? ''))
      const productName = String(item?.product_name ?? '').trim()
      const quantity = Number(item?.quantity)
      const costPrice = Number(item?.cost_price)
      const sellingPrice = Number(item?.selling_price)

      if (!isValidJanCode(janCode)) {
        fieldErrors.jan_code = 'JAN コードは 8 桁または 13 桁で入力してください。'
        return null
      }

      if (!productName) {
        fieldErrors.product_name = '商品名を入力してください。'
        return null
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        fieldErrors.quantity = '数量は 1 以上の整数で入力してください。'
        return null
      }

      if (!Number.isFinite(costPrice) || costPrice < 0) {
        fieldErrors.cost_price = '原価は 0 以上で入力してください。'
        return null
      }

      if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
        fieldErrors.selling_price = '売価は 0 以上で入力してください。'
        return null
      }

      items.push({
        jan_code: janCode,
        product_name: productName,
        quantity,
        cost_price: costPrice,
        selling_price: sellingPrice,
        memo: normalizeOptionalText(String(item?.memo ?? '')),
      })
    }

    return items
  } catch {
    fieldErrors.items = '移動リストの読み込みに失敗しました。'
    return null
  }
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

function revalidateTransferPages() {
  revalidatePath('/products')
  revalidatePath('/products/transfers')
}

export async function createTransfersAction(
  _prevState: TransferMutationState,
  formData: FormData
): Promise<TransferMutationState> {
  try {
    const fieldErrors: TransferMutationState['fieldErrors'] = {}
    const fromStoreId = parseRequiredStoreId(formData, 'from_store_id', fieldErrors)
    const toStoreId = parseRequiredStoreId(formData, 'to_store_id', fieldErrors)
    const items = parseTransferDraftItems(formData, fieldErrors)

    if (fromStoreId !== null && toStoreId !== null && fromStoreId === toStoreId) {
      fieldErrors.to_store_id = '移動元と移動先に同じ店舗は選べません。'
    }

    if (
      Object.keys(fieldErrors).length > 0 ||
      fromStoreId === null ||
      toStoreId === null ||
      !items
    ) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors,
      }
    }

    const supabase = await requireAuthenticatedClient()
    const now = new Date().toISOString()
    const records: TransferInsert[] = items.map((item) => ({
      transfer_date: now,
      from_store_id: fromStoreId,
      to_store_id: toStoreId,
      jan_code: item.jan_code,
      product_name: item.product_name,
      quantity: item.quantity,
      cost_price: item.cost_price,
      total_cost: item.cost_price * item.quantity,
      selling_price: item.selling_price,
      memo: item.memo,
      created_at: now,
    }))

    const { error } = await supabase.from('transfers').insert(records as never)

    if (error) {
      console.error('Error creating transfers:', error)
      return {
        status: 'error',
        message: '店舗間移動の登録に失敗しました。',
        fieldErrors: {},
      }
    }

    revalidateTransferPages()
    refresh()

    return {
      status: 'success',
      message: `${records.length} 件の移動を登録しました。`,
      fieldErrors: {},
    }
  } catch (error) {
    console.error('Unexpected error while creating transfers:', error)
    return {
      ...initialTransferMutationState,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '店舗間移動の登録中に予期しないエラーが発生しました。',
    }
  }
}

export async function deleteTransferAction(formData: FormData) {
  try {
    const transferIdValue = getTrimmedValue(formData, 'id')
    const transferId = Number(transferIdValue)

    if (!transferIdValue || !Number.isInteger(transferId) || transferId <= 0) {
      return
    }

    const supabase = await requireAuthenticatedClient()
    const { error } = await supabase.from('transfers').delete().eq('id', transferId)

    if (error) {
      console.error('Error deleting transfer:', error)
      return
    }

    revalidateTransferPages()
    refresh()
  } catch (error) {
    console.error('Unexpected error while deleting transfer:', error)
  }
}

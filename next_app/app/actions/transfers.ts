'use server'

import { revalidatePath, refresh } from 'next/cache'
import { searchProductByJan } from '@/lib/queries/transfers'
import { createClient } from '@/lib/supabase/server'
import {
  isValidTransferEntryType,
  isValidTransferUsageCategory,
  initialTransferMutationState,
  isValidJanCode,
  normalizeJanCode,
  normalizeOptionalText,
  type TransferDraftItem,
  type TransferEntryType,
  type TransferInsert,
  type TransferMutationState,
  type TransferProductOption,
  type TransferUsageCategory,
} from '@/lib/transfers'

type TransferProductLookupResult = {
  product: TransferProductOption | null
  status: 'success' | 'error'
  message: string
}

function getTrimmedValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseItemStoreId(value: unknown) {
  const parsed = Number(String(value ?? '').trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseDraftEntryType(
  value: unknown,
  fieldErrors: TransferMutationState['fieldErrors']
): TransferEntryType | null {
  const entryType = String(value ?? '').trim()

  if (!isValidTransferEntryType(entryType)) {
    fieldErrors.entry_type = '登録区分を選択してください。'
    return null
  }

  return entryType
}

function parseDraftUsageCategory(
  value: unknown,
  fieldErrors: TransferMutationState['fieldErrors'],
  required: boolean
) {
  const usageCategory = normalizeOptionalText(String(value ?? ''))

  if (!required) {
    return null
  }

  if (!usageCategory || !isValidTransferUsageCategory(usageCategory)) {
    fieldErrors.usage_category = '物品使用の区分を選択してください。'
    return null
  }

  return usageCategory as TransferUsageCategory
}

function parseTransferDraftItems(
  formData: FormData,
  fieldErrors: TransferMutationState['fieldErrors']
) {
  const rawItems = getTrimmedValue(formData, 'items_json')

  if (!rawItems) {
    fieldErrors.items = '登録リストに商品を追加してください。'
    return null
  }

  try {
    const parsed = JSON.parse(rawItems)

    if (!Array.isArray(parsed) || parsed.length === 0) {
      fieldErrors.items = '登録リストに商品を追加してください。'
      return null
    }

    const items: TransferDraftItem[] = []

    for (const item of parsed) {
      const fromStoreId = parseItemStoreId(item?.from_store_id)
      const toStoreId = parseItemStoreId(item?.to_store_id)
      const janCode = normalizeJanCode(String(item?.jan_code ?? ''))
      const productName = String(item?.product_name ?? '').trim()
      const quantity = Number(item?.quantity)
      const costPrice = Number(item?.cost_price)
      const sellingPrice = Number(item?.selling_price)
      const entryType = parseDraftEntryType(item?.entry_type, fieldErrors)
      const usageCategory = parseDraftUsageCategory(
        item?.usage_category,
        fieldErrors,
        entryType === 'usage'
      )

      if (!isValidJanCode(janCode)) {
        fieldErrors.jan_code = 'JAN コードは 8 桁・12 桁・13 桁のいずれかで入力してください。'
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

      if (!entryType) {
        return null
      }

      if (fromStoreId === null) {
        fieldErrors.from_store_id = '使用店舗 / 移動元店舗を選択してください。'
        return null
      }

      if (entryType === 'transfer' && toStoreId === null) {
        fieldErrors.to_store_id = '店舗間移動を含む場合は移動先店舗を選択してください。'
        return null
      }

      if (entryType === 'transfer' && fromStoreId === toStoreId) {
        fieldErrors.to_store_id = '移動元と移動先に同じ店舗は選べません。'
        return null
      }

      if (entryType === 'usage' && !usageCategory) {
        return null
      }

      items.push({
        from_store_id: fromStoreId,
        to_store_id: entryType === 'transfer' ? toStoreId : null,
        jan_code: janCode,
        product_name: productName,
        quantity,
        cost_price: costPrice,
        selling_price: sellingPrice,
        entry_type: entryType,
        usage_category: entryType === 'usage' ? usageCategory : null,
        memo: normalizeOptionalText(String(item?.memo ?? '')),
      })
    }

    return items
  } catch {
    fieldErrors.items = '登録リストの読み込みに失敗しました。'
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
    const items = parseTransferDraftItems(formData, fieldErrors)

    if (Object.keys(fieldErrors).length > 0 || !items) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors,
      }
    }

    const supabase = await requireAuthenticatedClient()
    const now = new Date().toISOString()

    // 登録対象の全 JAN のうち、products テーブルに存在しないものを自動仮登録する
    const uniqueJanCodes = Array.from(new Set(items.map((item) => item.jan_code)))
    const { data: existingProducts, error: checkError } = await supabase
      .from('products')
      .select('jan_code')
      .in('jan_code', uniqueJanCodes)

    if (!checkError) {
      const existingJans = new Set(((existingProducts as any[]) ?? []).map((p) => p.jan_code))
      const missingProducts = items
        .filter((item) => !existingJans.has(item.jan_code))
        // 重複 JAN の排除
        .filter((item, index, self) => self.findIndex((t) => t.jan_code === item.jan_code) === index)
        .map((item) => ({
          jan_code: item.jan_code,
          product_name: item.product_name || `[仮] 未登録商品 (${item.jan_code})`,
          cost_price: item.cost_price || 0,
          selling_price: item.selling_price || 0,
          category: '[仮] 未登録',
          product_group: '[仮] 未登録',
          is_active: true,
          created_at: now,
          updated_at: now,
        }))

      if (missingProducts.length > 0) {
        const { error: insertProductError } = await supabase
          .from('products')
          .insert(missingProducts as never[])

        if (insertProductError) {
          console.error('Error auto-creating temporary products:', insertProductError)
        }
      }
    }

    const records: TransferInsert[] = items.map((item) => ({
      transfer_date: now,
      from_store_id: item.from_store_id,
      to_store_id: item.entry_type === 'transfer' ? item.to_store_id : null,
      jan_code: item.jan_code,
      product_name: item.product_name,
      quantity: item.quantity,
      cost_price: item.cost_price,
      total_cost: item.cost_price * item.quantity,
      selling_price: item.selling_price,
      entry_type: item.entry_type,
      usage_category: item.entry_type === 'usage' ? item.usage_category : null,
      memo: item.memo,
      created_at: now,
    }))

    const { error } = await supabase.from('transfers').insert(records as never)

    if (error) {
      console.error('Error creating transfers:', error)
      return {
        status: 'error',
        message: '店舗間移動・物品使用の登録に失敗しました。',
        fieldErrors: {},
      }
    }

    revalidateTransferPages()
    refresh()

    return {
      status: 'success',
      message: `${records.length} 件を登録しました。`,
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
          : '店舗間移動・物品使用の登録中に予期しないエラーが発生しました。',
    }
  }
}

export async function lookupTransferProductByJanAction(
  rawJanCode: string
): Promise<TransferProductLookupResult> {
  try {
    const janCode = normalizeJanCode(rawJanCode)

    if (!isValidJanCode(janCode)) {
      return {
        status: 'error',
        message: 'JANコードは8桁、12桁、13桁のいずれかで入力してください。',
        product: null,
      }
    }

    await requireAuthenticatedClient()
    const product = await searchProductByJan(janCode)

    return {
      status: 'success',
      message: product ? '商品マスタが見つかりました。' : '商品マスタに一致しませんでした。',
      product,
    }
  } catch (error) {
    console.error('Unexpected error while looking up transfer product by JAN:', error)
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'JANコード検索中に予期しないエラーが発生しました。',
      product: null,
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

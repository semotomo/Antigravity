'use server'

import { revalidatePath, refresh } from 'next/cache'
import {
  initialProductMutationState,
  normalizeOptionalText,
  type ProductAliasInsert,
  type ProductInsert,
  type ProductMutationState,
  type ProductUpdate,
} from '@/lib/products'
import { createClient } from '@/lib/supabase/server'

const POS_SOURCE_SYSTEM = 'pos'
const JAN_CODE_PATTERN = /^(\d{8}|\d{12}|\d{13})$/

function getTrimmedValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseRequiredProductId(
  formData: FormData,
  fieldErrors: ProductMutationState['fieldErrors']
) {
  const value = getTrimmedValue(formData, 'product_id')
  const parsed = Number(value)

  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    fieldErrors.product_id = '紐付け先の商品を選択してください。'
    return null
  }

  return parsed
}

function parseOptionalNonNegativeInteger(
  formData: FormData,
  key: 'cost_price' | 'selling_price',
  fieldErrors: ProductMutationState['fieldErrors']
) {
  const value = normalizeOptionalText(formData.get(key))
  if (!value) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    fieldErrors[key] = '0 以上の整数で入力してください。'
    return null
  }

  return parsed
}

function parseRequiredAliasId(
  formData: FormData,
  fieldErrors: ProductMutationState['fieldErrors']
) {
  const value = getTrimmedValue(formData, 'id')
  const parsed = Number(value)

  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    fieldErrors.alias_name = '対象の別名データを特定できませんでした。'
    return null
  }

  return parsed
}

function parseOptionalJanCode(
  formData: FormData,
  fieldErrors: ProductMutationState['fieldErrors']
) {
  const value = normalizeOptionalText(formData.get('jan_code'))
  if (!value) {
    return null
  }

  if (!JAN_CODE_PATTERN.test(value)) {
    fieldErrors.jan_code = 'JAN コードは 8 桁・12 桁・13 桁の数字で入力してください。'
    return null
  }

  return value
}

function parseIsActive(formData: FormData, fallback = true) {
  const value = getTrimmedValue(formData, 'is_active')

  if (!value) {
    return fallback
  }

  return value === 'true'
}

function calculateMarkupRate(costPrice: number, sellingPrice: number) {
  if (sellingPrice <= 0) {
    return 0
  }

  return Number((((sellingPrice - costPrice) / sellingPrice) * 10000).toFixed(0)) / 10000
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

async function ensureAliasDoesNotExist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  aliasName: string
) {
  const { data, error } = await supabase
    .from('product_aliases')
    .select('id, product_id')
    .eq('alias_name', aliasName)
    .eq('source_system', POS_SOURCE_SYSTEM)
    .maybeSingle()

  if (error) {
    console.error('Error checking existing alias:', error)
    throw new Error('既存の別名マスタ確認中にエラーが発生しました。')
  }

  return data
}

function revalidateProductPages() {
  revalidatePath('/products')
  revalidatePath('/products/aliases')
  revalidatePath('/products/unmatched')
  revalidatePath('/sales')
  revalidatePath('/sales/daily')
  revalidatePath('/sales/products')
  revalidatePath('/orders')
  revalidatePath('/orders/[id]', 'page')
}

function buildAliasInsertPayload(
  aliasName: string,
  productId: number,
  now: string
): ProductAliasInsert {
  return {
    alias_name: aliasName,
    product_id: productId,
    source_system: POS_SOURCE_SYSTEM,
    is_active: true,
    created_at: now,
    updated_at: now,
  }
}

function buildProductPayload(
  formData: FormData,
  options: {
    requireAliasName?: boolean
    defaultIsActive?: boolean
  } = {}
) {
  const fieldErrors: ProductMutationState['fieldErrors'] = {}
  const requireAliasName = options.requireAliasName ?? false
  const defaultIsActive = options.defaultIsActive ?? true

  const aliasName = getTrimmedValue(formData, 'alias_name')
  const productName = getTrimmedValue(formData, 'product_name')
  const janCode = parseOptionalJanCode(formData, fieldErrors)
  const category = normalizeOptionalText(formData.get('category'))
  const productGroup = normalizeOptionalText(formData.get('product_group'))
  const brand = normalizeOptionalText(formData.get('brand'))
  const supplierName = normalizeOptionalText(formData.get('supplier_name'))
  const costPrice = parseOptionalNonNegativeInteger(formData, 'cost_price', fieldErrors)
  const sellingPrice = parseOptionalNonNegativeInteger(formData, 'selling_price', fieldErrors)

  if (requireAliasName && !aliasName) {
    fieldErrors.alias_name = 'POS 側の商品名を取得できませんでした。'
  }

  if (!productName) {
    fieldErrors.product_name = '商品名を入力してください。'
  }

  if (Object.keys(fieldErrors).length > 0 || !productName || (requireAliasName && !aliasName)) {
    return {
      aliasName,
      fieldErrors,
      payload: null,
    }
  }

  const payload: ProductInsert = {
    product_name: productName,
    jan_code: janCode,
    category,
    product_group: productGroup,
    brand,
    supplier_name: supplierName,
    cost_price: costPrice,
    selling_price: sellingPrice,
    markup_rate: calculateMarkupRate(costPrice ?? 0, sellingPrice ?? 0),
    is_active: parseIsActive(formData, defaultIsActive),
  }

  return {
    aliasName,
    fieldErrors,
    payload,
  }
}

export async function matchToExistingProductAction(
  _prevState: ProductMutationState,
  formData: FormData
): Promise<ProductMutationState> {
  try {
    const aliasName = getTrimmedValue(formData, 'alias_name')
    const fieldErrors: ProductMutationState['fieldErrors'] = {}
    const productId = parseRequiredProductId(formData, fieldErrors)

    if (!aliasName) {
      fieldErrors.alias_name = 'POS 側の商品名を取得できませんでした。'
    }

    if (!aliasName || productId === null) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors,
      }
    }

    const supabase = await requireAuthenticatedClient()
    const existingAlias = await ensureAliasDoesNotExist(supabase, aliasName)

    if (existingAlias) {
      return {
        status: 'error',
        message: 'この POS 商品名はすでに別名マスタへ登録されています。',
        fieldErrors: {},
      }
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('product_aliases')
      .insert(buildAliasInsertPayload(aliasName, productId, now) as never)

    if (error) {
      console.error('Error creating alias:', error)
      return {
        status: 'error',
        message:
          error.code === '23505'
            ? 'この POS 商品名はすでに登録済みです。'
            : '別名マスタの保存に失敗しました。',
        fieldErrors: {},
      }
    }

    revalidateProductPages()
    refresh()

    return {
      status: 'success',
      message: `「${aliasName}」を既存商品へ紐付けました。`,
      fieldErrors: {},
    }
  } catch (error) {
    console.error('Unexpected error while matching existing product:', error)
    return {
      ...initialProductMutationState,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '別名マスタ保存中に予期しないエラーが発生しました。',
    }
  }
}

export async function createNewProductAndMatchAction(
  _prevState: ProductMutationState,
  formData: FormData
): Promise<ProductMutationState> {
  try {
    const { aliasName, fieldErrors, payload } = buildProductPayload(formData, {
      requireAliasName: true,
      defaultIsActive: true,
    })

    if (!payload) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors,
      }
    }

    const supabase = await requireAuthenticatedClient()
    const existingAlias = await ensureAliasDoesNotExist(supabase, aliasName)

    if (existingAlias) {
      return {
        status: 'error',
        message: 'この POS 商品名はすでに別名マスタへ登録されています。',
        fieldErrors: {},
      }
    }

    const now = new Date().toISOString()
    const insertPayload: ProductInsert = {
      ...payload,
      updated_at: now,
    }

    const { data: createdProductData, error: productError } = await supabase
      .from('products')
      .insert(insertPayload as never)
      .select('id, product_name')
      .single()

    const createdProduct = createdProductData as { id: number; product_name: string | null } | null

    if (productError || !createdProduct) {
      console.error('Error creating product:', productError)
      return {
        status: 'error',
        message:
          productError?.code === '23505'
            ? 'JAN コードが重複しています。別のコードを指定してください。'
            : '商品マスタの新規作成に失敗しました。',
        fieldErrors:
          productError?.code === '23505' ? { jan_code: 'JAN コードが重複しています。' } : {},
      }
    }

    const { error: aliasError } = await supabase
      .from('product_aliases')
      .insert(buildAliasInsertPayload(aliasName, createdProduct.id, now) as never)

    if (aliasError) {
      console.error('Error creating alias after product insert:', aliasError)
      return {
        status: 'error',
        message:
          '商品マスタは作成しましたが、POS 名の紐付けに失敗しました。既存商品から再紐付けしてください。',
        fieldErrors: {},
      }
    }

    revalidateProductPages()
    refresh()

    return {
      status: 'success',
      message: `「${createdProduct.product_name ?? aliasName}」を作成し、POS 名を紐付けました。`,
      fieldErrors: {},
    }
  } catch (error) {
    console.error('Unexpected error while creating product and alias:', error)
    return {
      ...initialProductMutationState,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '商品マスタ作成中に予期しないエラーが発生しました。',
    }
  }
}

export async function updateProductAction(
  _prevState: ProductMutationState,
  formData: FormData
): Promise<ProductMutationState> {
  try {
    const fieldErrors: ProductMutationState['fieldErrors'] = {}
    const productIdValue = getTrimmedValue(formData, 'id')
    const productId = Number(productIdValue)

    if (!productIdValue || !Number.isInteger(productId) || productId <= 0) {
      return {
        status: 'error',
        message: '更新対象の商品を特定できませんでした。',
        fieldErrors,
      }
    }

    const { payload, fieldErrors: payloadErrors } = buildProductPayload(formData, {
      defaultIsActive: true,
    })

    if (!payload) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors: payloadErrors,
      }
    }

    const supabase = await requireAuthenticatedClient()
    const now = new Date().toISOString()
    const updatePayload: ProductUpdate = {
      ...payload,
      updated_at: now,
    }

    const { error } = await supabase
      .from('products')
      .update(updatePayload as never)
      .eq('id', productId)

    if (error) {
      console.error('Error updating product:', error)
      return {
        status: 'error',
        message:
          error.code === '23505'
            ? 'この JAN コードはすでに使われています。'
            : '商品マスタの更新に失敗しました。',
        fieldErrors:
          error.code === '23505' ? { jan_code: 'この JAN コードはすでに使われています。' } : {},
      }
    }

    revalidateProductPages()
    refresh()

    return {
      status: 'success',
      message: '商品マスタを更新しました。',
      fieldErrors: {},
    }
  } catch (error) {
    console.error('Unexpected error while updating product:', error)
    return {
      ...initialProductMutationState,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '商品マスタ更新中に予期しないエラーが発生しました。',
    }
  }
}

export async function updateAliasTargetAction(
  _prevState: ProductMutationState,
  formData: FormData
): Promise<ProductMutationState> {
  try {
    const fieldErrors: ProductMutationState['fieldErrors'] = {}
    const aliasId = parseRequiredAliasId(formData, fieldErrors)
    const productId = parseRequiredProductId(formData, fieldErrors)
    const aliasName = getTrimmedValue(formData, 'alias_name')

    if (!aliasName) {
      fieldErrors.alias_name = '対象の POS 名を取得できませんでした。'
    }

    if (aliasId === null || productId === null || !aliasName) {
      return {
        status: 'error',
        message: '入力内容を確認してください。',
        fieldErrors,
      }
    }

    const supabase = await requireAuthenticatedClient()
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('product_aliases')
      .update({
        product_id: productId,
        updated_at: now,
      } as never)
      .eq('id', aliasId)

    if (error) {
      console.error('Error updating alias target:', error)
      return {
        status: 'error',
        message: '紐付け先の更新に失敗しました。',
        fieldErrors: {},
      }
    }

    revalidateProductPages()
    refresh()

    return {
      status: 'success',
      message: `「${aliasName}」の紐付け先を更新しました。`,
      fieldErrors: {},
    }
  } catch (error) {
    console.error('Unexpected error while updating alias target:', error)
    return {
      ...initialProductMutationState,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '紐付け先変更中に予期しないエラーが発生しました。',
    }
  }
}

export async function deleteAliasAction(formData: FormData) {
  try {
    const fieldErrors: ProductMutationState['fieldErrors'] = {}
    const aliasId = parseRequiredAliasId(formData, fieldErrors)

    if (aliasId === null) {
      return
    }

    const supabase = await requireAuthenticatedClient()
    const { error } = await supabase.from('product_aliases').delete().eq('id', aliasId)

    if (error) {
      console.error('Error deleting alias:', error)
      return
    }

    revalidateProductPages()
    refresh()
  } catch (error) {
    console.error('Unexpected error while deleting alias:', error)
  }
}

export async function uploadProductMasterCsv(formData: FormData) {
  try {
    const csvContent = formData.get('csvContent')
    const fileName = formData.get('fileName')

    if (typeof csvContent !== 'string' || !csvContent) {
      return { success: false, message: 'CSVデータが正しく読み込めませんでした。' }
    }

    const papaparse = await import('papaparse')
    const parsed = papaparse.parse<string[]>(csvContent, {
      skipEmptyLines: true,
      header: false,
    })

    const rows = parsed.data
    if (rows.length === 0) {
      return { success: false, message: 'CSVにデータがありません。' }
    }

    const COL = {
      JAN_CODE: 3,
      PRODUCT_GROUP: 5,
      PRODUCT_NAME: 6,
      SELLING_PRICE: 8,
      COST_PRICE: 11,
    }

    const records: ProductInsert[] = []
    const seen = new Set<string>()
    let skipped = 0

    for (const row of rows) {
      if (row.length <= COL.COST_PRICE) {
        skipped++
        continue
      }

      const janCode = (row[COL.JAN_CODE] || '').trim()
      const productName = (row[COL.PRODUCT_NAME] || '').trim()

      if (!janCode || !productName) {
        skipped++
        continue
      }

      if (seen.has(janCode)) {
        skipped++
        continue
      }
      seen.add(janCode)

      const productGroup = (row[COL.PRODUCT_GROUP] || '').trim()
      const priceStr = (row[COL.SELLING_PRICE] || '').replace(/[¥\\,\s]/g, '')
      const costStr = (row[COL.COST_PRICE] || '').replace(/[¥\\,\s]/g, '')
      const sellingPrice = parseInt(priceStr, 10) || 0
      const costPrice = parseInt(costStr, 10) || 0
      const category = productGroup || ''

      let markupRate = 0
      if (sellingPrice > 0) {
        markupRate = Math.round(((sellingPrice - costPrice) / sellingPrice) * 10000) / 10000
      }

      records.push({
        jan_code: janCode,
        product_name: productName,
        category: category,
        product_group: productGroup || null,
        brand: null,
        cost_price: costPrice,
        selling_price: sellingPrice,
        markup_rate: markupRate,
        is_active: true,
      })
    }

    if (records.length === 0) {
      return { success: true, message: '送信対象の商品データがありませんでした。' }
    }

    const supabase = await requireAuthenticatedClient()
    
    // Chunking to avoid large payload issues (1000 records per chunk is safe for Supabase)
    const chunkSize = 1000
    let totalUpserted = 0

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize)
      const { error } = await supabase
        .from('products')
        .upsert(chunk as never[], {
          onConflict: 'jan_code',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error('Supabase Upsert Error:', error)
        return { success: false, message: 'データベースへの同期中にエラーが発生しました: ' + error.message }
      }
      totalUpserted += chunk.length
    }

    revalidatePath('/products')
    revalidatePath('/sales')
    revalidatePath('/sales/daily')
    revalidatePath('/sales/products')

    return {
      success: true,
      message: `${fileName} から ${totalUpserted}件の商品を同期しました。\n(スキップ: ${skipped}件)`,
    }
  } catch (error) {
    console.error('Unexpected error in uploadProductMasterCsv:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '予期せぬエラーが発生しました。',
    }
  }
}

export async function uploadSupplierCsv(formData: FormData) {
  try {
    const csvContent = formData.get('csvContent')
    const fileName = formData.get('fileName')

    if (typeof csvContent !== 'string' || !csvContent) {
      return { success: false, message: 'CSVデータが正しく読み込めませんでした。' }
    }

    const papaparse = await import('papaparse')
    const parsed = papaparse.parse<string[]>(csvContent, {
      skipEmptyLines: true,
      header: false,
    })

    const rows = parsed.data
    if (rows.length === 0) {
      return { success: false, message: 'CSVにデータがありません。' }
    }

    const records: Array<{ jan_code: string; supplier_name: string | null }> = []
    const seen = new Set<string>()
    let skipped = 0

    // A列がJANコード、D列が仕入れ先
    const COL = {
      JAN_CODE: 0,
      SUPPLIER_NAME: 3,
    }

    for (const row of rows) {
      if (row.length <= COL.SUPPLIER_NAME) {
        skipped++
        continue
      }

      const janCode = (row[COL.JAN_CODE] || '').trim()
      const supplierName = (row[COL.SUPPLIER_NAME] || '').trim()

      // A列が有効なJANコードの場合のみインポート対象とする（ヘッダー行などを自動除外）
      if (!janCode || !JAN_CODE_PATTERN.test(janCode)) {
        skipped++
        continue
      }

      if (seen.has(janCode)) {
        skipped++
        continue
      }
      seen.add(janCode)

      records.push({
        jan_code: janCode,
        supplier_name: supplierName || null,
      })
    }

    if (records.length === 0) {
      return { success: true, message: '送信対象の仕入れ先データ（有効なJANコード）がありませんでした。' }
    }

    const supabase = await requireAuthenticatedClient()
    
    // Chunking to avoid large payload issues (1000 records per chunk)
    const chunkSize = 1000
    let totalUpserted = 0

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize)
      const { error } = await supabase
        .from('products')
        .upsert(chunk as never[], {
          onConflict: 'jan_code',
          ignoreDuplicates: false, // 既存商品は仕入れ先情報を上書きする
        })

      if (error) {
        console.error('Supabase Upsert Error in uploadSupplierCsv:', error)
        return { success: false, message: 'データベースへの同期中にエラーが発生しました: ' + error.message }
      }
      totalUpserted += chunk.length
    }

    revalidatePath('/products')

    return {
      success: true,
      message: `${fileName} から ${totalUpserted}件の商品の仕入れ先情報を同期しました。\n(スキップ・対象外: ${skipped}件)`,
    }
  } catch (error) {
    console.error('Unexpected error in uploadSupplierCsv:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '予期せぬエラーが発生しました。',
    }
  }
}


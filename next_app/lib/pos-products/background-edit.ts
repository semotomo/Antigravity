export type BackgroundProductPatch = { name?: string; price?: string; cost?: string }
export type BackgroundExpectedValues = { name?: string | null; price?: string | null; cost?: string | null }
export type BackgroundEditRequest = { operationId: string; storeId: 6 | 7; productId: number; patch: BackgroundProductPatch; expectedValues: BackgroundExpectedValues }
export type ProductEditIntakeData = Omit<BackgroundEditRequest, 'patch' | 'expectedValues'> & {
  janCode: string; patch: BackgroundProductPatch
  status: 'queued' | 'working' | 'needs_review' | 'completed' | 'cancelled'
  createdAt: string; updatedAt: string; message: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function reject(): never { throw new Error('商品変更の受付内容を確認できません。入力は保持されています。') }
export function backgroundEditRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
  return value as Record<string, unknown>
}
export function backgroundEditUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) reject()
  return value
}
export function backgroundEditStore(value: unknown): 6 | 7 {
  if (value !== 6 && value !== 7) reject()
  return value
}
export function backgroundEditProduct(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2147483647) reject()
  return value
}
export function parseBackgroundProductPatch(value: unknown): BackgroundProductPatch {
  const record = backgroundEditRecord(value), result: BackgroundProductPatch = {}
  const keys = Object.keys(record).sort()
  if (!keys.length || keys.length > 3 || keys.some(key => !['name', 'price', 'cost'].includes(key))) reject()
  for (const field of keys as (keyof BackgroundProductPatch)[]) {
    const item = record[field]
    if (typeof item !== 'string') reject()
    if (field === 'name') {
      if (!item.trim() || item.length > 200 || /[\x00-\x1f\x7f]/.test(item)) reject()
    } else if (!/^(0|[1-9][0-9]{0,8})$/.test(item)) reject()
    result[field] = item
  }
  return result
}
export function parseBackgroundEditRequest(value: unknown): BackgroundEditRequest {
  const record = backgroundEditRecord(value), keys = ['operationId', 'storeId', 'productId', 'patch', 'expectedValues']
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) reject()
  const patch = parseBackgroundProductPatch(record.patch), expected = backgroundEditRecord(record.expectedValues)
  if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(Object.keys(patch))) reject()
  const expectedValues: BackgroundExpectedValues = {}
  for (const field of Object.keys(patch) as (keyof BackgroundProductPatch)[]) {
    const item = expected[field]
    if (item !== null && (typeof item !== 'string' || (field === 'name' ? item.length > 200 || /[\x00-\x1f\x7f]/.test(item) : !/^(0|[1-9][0-9]{0,8})$/.test(item)))) reject()
    expectedValues[field] = item as string | null
  }
  return { operationId: backgroundEditUuid(record.operationId), storeId: backgroundEditStore(record.storeId),
    productId: backgroundEditProduct(record.productId), patch, expectedValues }
}

/** 公開DTOは希望値と状態だけ。actor・lease・DB基準・POS内部IDは外へ渡さない。 */
export function decodeProductEditIntakeData(value: unknown): ProductEditIntakeData {
  const row = backgroundEditRecord(value)
  if (typeof row.jan_code !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(row.jan_code) ||
      !['queued', 'working', 'needs_review', 'completed', 'cancelled'].includes(String(row.status)) ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) ||
      typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) reject()
  const status = row.status as ProductEditIntakeData['status']
  let message = { queued: '変更を受け付けました。POSへの反映待ちです。', working: 'POSへ反映中です。次の商品を編集できます。',
    needs_review: '変更を反映できていません。入力はサーバーに保持しています。再保存せず状態を確認してください。',
    completed: 'POSへの反映と商品情報の確認が完了しました。', cancelled: '未送信の変更を取り消しました。' }[status]
  if (status === 'needs_review' && row.code === 'POS_PRODUCT_EDIT_CONFLICT') message = 'POSの商品値が受付時の基準と異なります。希望値は保持しています。内容を確認してください。'
  if (status === 'needs_review' && row.code === 'POS_PRODUCT_EDIT_ACCESS_REVOKED') message = '店舗管理者の権限を確認できないため停止しました。希望値は保持しています。'
  return { operationId: backgroundEditUuid(row.operation_id), storeId: backgroundEditStore(row.store_id),
    productId: backgroundEditProduct(row.product_id), janCode: row.jan_code, patch: parseBackgroundProductPatch(row.patch),
    status, createdAt: row.created_at, updatedAt: row.updated_at, message }
}

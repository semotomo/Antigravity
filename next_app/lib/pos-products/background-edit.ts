export type BackgroundProductPatch = { name?: string; price?: string; cost?: string; groupId?: string; supplierId?: string | null }
export type BackgroundExpectedValues = { name?: string | null; price?: string | null; cost?: string | null; groupId?: string; supplierId?: string | null }
export type BackgroundEditRequest = { operationId: string; storeId: 6 | 7; productId: number; patch: BackgroundProductPatch; expectedValues: BackgroundExpectedValues; catalogSnapshotId?: string }
export type BackgroundPosChoiceBaseline = {
  groupId: string; groupName: string; supplierId: string | null; supplierName: string | null
  requested: { groupId?: { id: string; name: string }; supplierId?: { id: string; name: string } | null }
}
export type ProductEditIntakeData = Omit<BackgroundEditRequest, 'patch' | 'expectedValues'> & {
  janCode: string; patch: BackgroundProductPatch
  status: 'queued' | 'working' | 'needs_review' | 'completed' | 'cancelled'
  createdAt: string; updatedAt: string; message: string; posChoiceBaseline?: BackgroundPosChoiceBaseline
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CHOICE_ID = /^[A-Za-z0-9._:-]{1,100}$/
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
  if (!keys.length || keys.length > 5 || keys.some(key => !['name', 'price', 'cost', 'groupId', 'supplierId'].includes(key))) reject()
  for (const field of keys as (keyof BackgroundProductPatch)[]) {
    const item = record[field]
    if (field === 'supplierId' && item === null) { result.supplierId = null; continue }
    if (typeof item !== 'string') reject()
    if (field === 'name') {
      if (!item.trim() || item.length > 200 || /[\x00-\x1f\x7f]/.test(item)) reject()
    } else if (field === 'groupId' || field === 'supplierId') {
      if (!CHOICE_ID.test(item)) reject()
    } else if (!/^(0|[1-9][0-9]{0,8})$/.test(item)) reject()
    result[field] = item
  }
  return result
}
export function parseBackgroundEditRequest(value: unknown): BackgroundEditRequest {
  const record = backgroundEditRecord(value), patch = parseBackgroundProductPatch(record.patch)
  const classified = Object.hasOwn(patch, 'groupId') || Object.hasOwn(patch, 'supplierId')
  const keys = ['operationId', 'storeId', 'productId', 'patch', 'expectedValues', ...(classified ? ['catalogSnapshotId'] : [])]
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) reject()
  const expected = backgroundEditRecord(record.expectedValues)
  if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(Object.keys(patch))) reject()
  const expectedValues: BackgroundExpectedValues = {}
  for (const field of Object.keys(patch) as (keyof BackgroundProductPatch)[]) {
    const item = expected[field]
    if (field === 'groupId') {
      if (typeof item !== 'string' || !CHOICE_ID.test(item)) reject()
      expectedValues.groupId = item
    } else {
      if (item !== null && (typeof item !== 'string' || (field === 'name' ? item.length > 200 || /[\x00-\x1f\x7f]/.test(item)
        : field === 'supplierId' ? !CHOICE_ID.test(item) : !/^(0|[1-9][0-9]{0,8})$/.test(item)))) reject()
      expectedValues[field] = item as string | null
    }
  }
  return { operationId: backgroundEditUuid(record.operationId), storeId: backgroundEditStore(record.storeId),
    productId: backgroundEditProduct(record.productId), patch, expectedValues,
    ...(classified ? { catalogSnapshotId: backgroundEditUuid(record.catalogSnapshotId) } : {}) }
}

function choiceName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 1000 || /[\x00-\x1f\x7f]/.test(value)) reject()
  return value
}
export function parseBackgroundPosChoiceBaseline(value: unknown, patch: BackgroundProductPatch): BackgroundPosChoiceBaseline {
  const row = backgroundEditRecord(value), keys = ['groupId', 'groupName', 'supplierId', 'supplierName', 'requested']
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
      typeof row.groupId !== 'string' || !CHOICE_ID.test(row.groupId) ||
      (row.supplierId !== null && (typeof row.supplierId !== 'string' || !CHOICE_ID.test(row.supplierId))) ||
      (row.supplierId === null) !== (row.supplierName === null)) reject()
  const requested = backgroundEditRecord(row.requested), requestedKeys = Object.keys(patch).filter(key => key === 'groupId' || key === 'supplierId').sort()
  if (JSON.stringify(Object.keys(requested).sort()) !== JSON.stringify(requestedKeys)) reject()
  const normalized: BackgroundPosChoiceBaseline['requested'] = {}
  for (const field of requestedKeys as ('groupId' | 'supplierId')[]) {
    if (field === 'supplierId' && requested[field] === null && patch.supplierId === null) { normalized.supplierId = null; continue }
    const item = backgroundEditRecord(requested[field])
    if (Object.keys(item).length !== 2 || typeof item.id !== 'string' || !CHOICE_ID.test(item.id) || item.id !== patch[field]) reject()
    const name = choiceName(item.name), currentId = field === 'groupId' ? row.groupId : row.supplierId
    const currentName = field === 'groupId' ? row.groupName : row.supplierName
    if (item.id === currentId ? name !== currentName : name === currentName) reject()
    normalized[field] = { id: item.id, name }
  }
  return { groupId: row.groupId, groupName: choiceName(row.groupName), supplierId: row.supplierId as string | null,
    supplierName: row.supplierName === null ? null : choiceName(row.supplierName), requested: normalized }
}

/** 希望値・状態と分類の現在/希望選択ID・名称だけを公開する。actor・lease・一般DB基準・POS商品内部IDは外へ渡さない。 */
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
  const patch = parseBackgroundProductPatch(row.patch), classified = Object.hasOwn(patch, 'groupId') || Object.hasOwn(patch, 'supplierId')
  if (!classified && (row.catalog_snapshot_id != null || row.pos_choice_baseline != null)) reject()
  return { operationId: backgroundEditUuid(row.operation_id), storeId: backgroundEditStore(row.store_id),
    productId: backgroundEditProduct(row.product_id), janCode: row.jan_code, patch,
    status, createdAt: row.created_at, updatedAt: row.updated_at, message,
    ...(classified ? { catalogSnapshotId: backgroundEditUuid(row.catalog_snapshot_id), posChoiceBaseline: parseBackgroundPosChoiceBaseline(row.pos_choice_baseline, patch) } : {}) }
}

import { backgroundEditProduct, backgroundEditRecord, backgroundEditStore, backgroundEditUuid } from './background-edit'

export type BackgroundClassificationTarget = { storeId: 6 | 7; productId: number }
export type BackgroundClassificationSnapshot = BackgroundClassificationTarget & {
  snapshotId: string; janCode: string; capturedAt: number; expiresAt: number
  currentGroupId: string; currentSupplierId: string | null
  groups: { id: string; name: string }[]; suppliers: { id: string; name: string }[]
}
const ID = /^[A-Za-z0-9._:-]{1,100}$/
function reject(): never { throw new Error('この店舗の商品分類・仕入先候補を確認できません。') }
export function parseBackgroundClassificationTarget(value: unknown): BackgroundClassificationTarget {
  const row = backgroundEditRecord(value)
  if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'storeId') || !Object.hasOwn(row, 'productId')) reject()
  return { storeId: backgroundEditStore(row.storeId), productId: backgroundEditProduct(row.productId) }
}
function choices(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value) || value.length > 5000) reject()
  const ids = new Set<string>(), names = new Set<string>()
  return value.map(value => {
    const row = backgroundEditRecord(value)
    if (Object.keys(row).length !== 2 || typeof row.id !== 'string' || !ID.test(row.id) || ids.has(row.id) ||
        typeof row.name !== 'string' || !row.name.trim() || row.name !== row.name.trim() || row.name.length > 1000 ||
        /[\x00-\x1f\x7f]/.test(row.name) || names.has(row.name)) reject()
    ids.add(row.id); names.add(row.name)
    return { id: row.id, name: row.name }
  })
}
export function decodeBackgroundClassificationSnapshot(value: unknown, target: BackgroundClassificationTarget & { janCode?: string }, now = Date.now()): BackgroundClassificationSnapshot {
  const row = backgroundEditRecord(value), keys = ['snapshotId', 'storeId', 'productId', 'janCode', 'capturedAt', 'expiresAt', 'currentGroupId', 'currentSupplierId', 'groups', 'suppliers']
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
      backgroundEditStore(row.storeId) !== target.storeId || backgroundEditProduct(row.productId) !== target.productId ||
      typeof row.janCode !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(row.janCode) ||
      (target.janCode !== undefined && row.janCode !== target.janCode) || !Number.isSafeInteger(now) || now <= 0 ||
      typeof row.capturedAt !== 'number' || !Number.isSafeInteger(row.capturedAt) || row.capturedAt <= 0 || row.capturedAt > now + 30000 ||
      typeof row.expiresAt !== 'number' || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= now ||
      row.expiresAt <= row.capturedAt || row.expiresAt - row.capturedAt > 900000 ||
      typeof row.currentGroupId !== 'string' || !ID.test(row.currentGroupId) ||
      (row.currentSupplierId !== null && (typeof row.currentSupplierId !== 'string' || !ID.test(row.currentSupplierId)))) reject()
  const groups = choices(row.groups), suppliers = choices(row.suppliers)
  if (!groups.some(g => g.id === row.currentGroupId) || (row.currentSupplierId !== null && !suppliers.some(s => s.id === row.currentSupplierId))) reject()
  return { snapshotId: backgroundEditUuid(row.snapshotId), storeId: target.storeId, productId: target.productId, janCode: row.janCode,
    capturedAt: row.capturedAt, expiresAt: row.expiresAt, currentGroupId: row.currentGroupId,
    currentSupplierId: row.currentSupplierId as string | null, groups, suppliers }
}

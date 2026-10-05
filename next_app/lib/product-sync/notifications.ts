export type ProductSyncStoreId = 6 | 7
export type ProductSyncSource = 'manual' | 'cron' | 'recovery'
export type ProductSyncFailureCode =
  | 'PRODUCT_SYNC_PENDING_EDIT' | 'PRODUCT_SYNC_PENDING_SYNC' | 'PRODUCT_SYNC_STALE' | 'PRODUCT_SYNC_INVALID_DATA'
  | 'PRODUCT_SYNC_EXPIRED' | 'PRODUCT_SYNC_DISABLED' | 'PRODUCT_SYNC_UNAVAILABLE' | 'PRODUCT_SYNC_UNKNOWN'
export type ProductSyncStore = {
  id: ProductSyncStoreId
  name: string
  tenpoGroupId: string
  tenpoGroupName: string
}
export type ProductSyncStoreResult = {
  storeId: ProductSyncStoreId
  store: string
  success: boolean
  outcome: 'succeeded' | 'rejected' | 'unknown'
  code: ProductSyncFailureCode | null
  message: string
  nextStep: string
  runId?: string
  csvCount?: number
  syncCount?: number
}
export type ProductSyncNotification = ProductSyncStoreResult & {
  id: string
  source: ProductSyncSource
  createdAt: string
  resolvedAt: string | null
  resolutionOutcome: 'succeeded' | 'rejected' | null
}
export const PRODUCT_SYNC_STORES: ProductSyncStore[] = [
  { id: 7, name: '本店', tenpoGroupId: '11098', tenpoGroupName: 'からつケンネル本店' },
  { id: 6, name: 'わんわん', tenpoGroupId: '11099', tenpoGroupName: 'わんわんペットセンター' },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REASONS: Record<ProductSyncFailureCode, { reason: string; nextStep: string }> = {
  PRODUCT_SYNC_PENDING_EDIT: { reason: '処理中の商品編集があるため、同期全体を拒否しました。', nextStep: '商品編集の状態を確認し、完了または取消後に新しいCSVを取得してください。' },
  PRODUCT_SYNC_PENDING_SYNC: { reason: '進行中または未確認の同期があるため、新しい同期全体を拒否しました。', nextStep: '再送せず、商品マスタ画面で前回の同期状態を確認してください。完了または未適用を確認後、新しいCSVを取得してください。' },
  PRODUCT_SYNC_STALE: { reason: 'CSV取得中に商品編集または別の同期が行われたため、同期全体を拒否しました。', nextStep: '商品編集の完了を確認し、新しいCSVを取得して同期してください。' },
  PRODUCT_SYNC_INVALID_DATA: { reason: 'CSVの店舗・重複商品・金額などの検査に失敗し、同期全体を拒否しました。', nextStep: '店舗設定とCSVの内容を管理者に確認してもらい、修正後に新しいCSVを取得してください。' },
  PRODUCT_SYNC_EXPIRED: { reason: 'CSV取得の有効期限を過ぎたため、同期全体を拒否しました。', nextStep: '商品編集の状態を確認し、新しいCSVを取得して同期してください。' },
  PRODUCT_SYNC_DISABLED: { reason: '商品同期の安全な受付設定が未完了のため、同期を開始できませんでした。', nextStep: '管理者に商品同期の設定を確認してもらってください。' },
  PRODUCT_SYNC_UNAVAILABLE: { reason: '商品同期を安全に受け付けられず、同期全体を拒否しました。', nextStep: '管理者に設定と同期状態を確認してもらってください。' },
  PRODUCT_SYNC_UNKNOWN: { reason: '商品同期の結果を確認できません。商品が変更された可能性があります。', nextStep: '再送せず、管理者に同じ同期の状態を確認してもらってください。同じ同期の適用済み・未適用を安全に確認できるまで、この店舗の同期を停止します。' },
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export function isProductSyncFailureCode(value: unknown): value is ProductSyncFailureCode {
  return typeof value === 'string' && Object.hasOwn(REASONS, value)
}
export function productSyncFailure(store: Pick<ProductSyncStore, 'id' | 'name'>, code: ProductSyncFailureCode, runId?: string): ProductSyncStoreResult {
  const outcome = code === 'PRODUCT_SYNC_UNKNOWN' ? 'unknown' : 'rejected'
  return {
    storeId: store.id, store: store.name, success: false, outcome, code,
    message: `${REASONS[code].reason}${outcome === 'rejected' ? 'この同期では商品は変更されていません。' : ''}`,
    nextStep: REASONS[code].nextStep,
    ...(runId && UUID.test(runId) ? { runId } : {}),
  }
}

export function decodeProductMasterSyncResult(store: ProductSyncStore, value: unknown): ProductSyncStoreResult {
  const envelope = object(value)
  const master = object(envelope?.master) ?? envelope
  const runId = typeof master?.runId === 'string' && UUID.test(master.runId) ? master.runId : undefined
  const sync = object(master?.syncResult)
  // 外部の本文や例外文はDTOへ入れず、許可した固定コードだけを理由へ変換する。
  if (envelope?.success === false && master?.success === false && master.storeId === store.id &&
    master.outcome === 'rejected' && isProductSyncFailureCode(master.code) && master.code !== 'PRODUCT_SYNC_UNKNOWN') {
    return productSyncFailure(store, master.code, runId)
  }
  if (envelope?.success === true && master?.success === true && master.storeId === store.id && runId &&
    Number.isSafeInteger(master.csvRowCount) && Number(master.csvRowCount) > 0 && Number(master.csvRowCount) <= 10000 &&
    sync !== null && Number.isSafeInteger(sync.count) && sync.count === master.csvRowCount) {
    const syncRunId = typeof sync.runId === 'string' && UUID.test(sync.runId) ? sync.runId : runId
    return { storeId: store.id, store: store.name, success: true, outcome: 'succeeded', code: null,
      message: '商品マスタの同期が完了しました。', nextStep: '', csvCount: Number(master.csvRowCount), syncCount: Number(sync.count),
      ...(syncRunId ? { runId: syncRunId } : {}) }
  }
  return productSyncFailure(store, 'PRODUCT_SYNC_UNKNOWN', runId)
}

export function decodeProductSyncNotification(value: unknown): ProductSyncNotification | null {
  const row = object(value)
  if (!row || (row.store_id !== 6 && row.store_id !== 7) || typeof row.attempt_id !== 'string' || !UUID.test(row.attempt_id) ||
    (row.source !== 'manual' && row.source !== 'cron' && row.source !== 'recovery') || !isProductSyncFailureCode(row.code) ||
    row.outcome !== (row.code === 'PRODUCT_SYNC_UNKNOWN' ? 'unknown' : 'rejected') ||
    typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) ||
    (row.resolved_at !== null && (typeof row.resolved_at !== 'string' || !Number.isFinite(Date.parse(row.resolved_at)))) ||
    (row.resolved_at === null ? row.resolution_outcome !== null : row.resolution_outcome !== 'succeeded' && row.resolution_outcome !== 'rejected')) return null
  const result = productSyncFailure({ id: row.store_id, name: row.store_id === 7 ? '本店' : 'わんわん' }, row.code,
    typeof row.run_id === 'string' ? row.run_id : undefined)
  return { ...result, id: `${row.attempt_id}:${row.store_id}`, source: row.source, createdAt: row.created_at,
    resolvedAt: row.resolved_at as string | null, resolutionOutcome: row.resolution_outcome as 'succeeded' | 'rejected' | null }
}

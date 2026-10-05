import 'server-only'

import { randomUUID } from 'node:crypto'
import { decodeProductMasterSyncResult, productSyncFailure } from './notifications'
import { getProductSyncNotificationGate, recordProductSyncNotification } from './notifications.server'
import type { ProductSyncSource, ProductSyncStore, ProductSyncStoreResult } from './notifications'

export async function runProductMasterSync(
  stores: ProductSyncStore[], source: ProductSyncSource,
  send: (store: ProductSyncStore, attemptId: string) => Promise<unknown>,
) {
  const results: ProductSyncStoreResult[] = []
  let notificationsSaved = true
  for (let index = 0; index < stores.length; index++) {
    const store = stores[index]
    const attemptId = randomUUID()
    const startedAt = new Date().toISOString()
    let result: ProductSyncStoreResult
    let attempted = false
    try {
      const gate = await getProductSyncNotificationGate(store.id)
      if (gate.blocked) {
        // 未確認の過去の送信は再送しない。既存通知を残し、同じ停止通知を増殖させない。
        results.push(productSyncFailure(store, 'PRODUCT_SYNC_UNKNOWN'))
        continue
      }
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 10000))
      attempted = true
      result = decodeProductMasterSyncResult(store, await send(store, attemptId))
    } catch {
      result = productSyncFailure(store, attempted ? 'PRODUCT_SYNC_UNKNOWN' : 'PRODUCT_SYNC_UNAVAILABLE', attempted ? attemptId : undefined)
    }
    if (attempted && result.outcome === 'unknown' && !result.runId) result.runId = attemptId
    try {
      await recordProductSyncNotification(attemptId, source, result, startedAt)
    } catch {
      notificationsSaved = false
    }
    results.push(result)
  }
  const allApplied = results.length > 0 && results.every(result => result.success)
  const success = allApplied && notificationsSaved
  const succeeded = results.filter(result => result.success).length
  const message = allApplied && !notificationsSaved ? '全対象店舗の商品同期は適用済みですが、通知を保存できませんでした。再送は不要です。管理者にこの画面の結果を伝えてください。' : `${success ? '全対象店舗の商品マスタ同期が完了しました。' :
    succeeded > 0 ? '一部店舗の商品マスタ同期に失敗しました。店舗別の結果を確認してください。' :
      '商品マスタ同期が完了していません。店舗別の結果を確認してください。'}${notificationsSaved ? '' : '通知を保存できませんでした。管理者にこの画面の結果を伝えてください。'}`
  return { success, notificationsSaved, message, results }
}

'use server'

import { readProductSyncNotifications } from '@/lib/product-sync/notifications.server'

export async function getProductSyncNotifications(storeId: unknown) {
  try {
    return { success: true as const, ...await readProductSyncNotifications(storeId) }
  } catch {
    return { success: false as const, notifications: [], unresolvedCount: 0,
      message: '商品同期の通知を確認できませんでした。ログイン状態と店舗権限を確認し、管理者に連絡してください。' }
  }
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { ProductSyncNotificationList } from '../../next_app/components/products/ProductSyncNotificationList'
import { productSyncFailure } from '../../next_app/lib/product-sync/notifications'
import type { ProductSyncNotification } from '../../next_app/lib/product-sync/notifications'

// 本番非接続の合成通知。通知表示の実コンポーネントだけを使用する。
const startedAt = '2026-10-05T09:00:00.000Z'
const notices: ProductSyncNotification[] = [
  { ...productSyncFailure({id:7,name:'本店'},'PRODUCT_SYNC_STALE'), id:'synthetic-stale',source:'cron',createdAt:startedAt,resolvedAt:null,resolutionOutcome:null },
  { ...productSyncFailure({id:6,name:'わんわん'},'PRODUCT_SYNC_UNKNOWN'), id:'synthetic-unknown',source:'manual',createdAt:startedAt,resolvedAt:null,resolutionOutcome:null },
  { ...productSyncFailure({id:6,name:'わんわん'},'PRODUCT_SYNC_UNKNOWN'), id:'synthetic-resolved',source:'cron',createdAt:startedAt,
    resolvedAt:'2026-10-05T09:10:00.000Z',resolutionOutcome:'rejected' },
]
const element = document.getElementById('root')
if (!element) throw new Error('Missing preview root')
createRoot(element).render(<main className="mx-auto max-w-3xl p-4 sm:p-8">
  <h1 className="mb-4 text-xl font-bold">同期通知の検証用・合成データ・本番非接続</h1>
  <ProductSyncNotificationList notifications={notices} unresolvedCount={2}/>
</main>)

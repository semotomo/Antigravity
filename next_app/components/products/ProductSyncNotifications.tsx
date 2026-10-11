import { getProductSyncNotifications } from '@/app/actions/productSyncNotifications'
import { ProductSyncNotificationList } from './ProductSyncNotificationList'
import { ProductMasterSyncButton } from '@/components/sales/ProductMasterSyncButton'

export async function ProductSyncNotifications({ storeId }: { storeId: 6 | 7 | null }) {
  const result = await getProductSyncNotifications(storeId)
  if (!result.success) return <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.message}</p>
  if (!result.managedStoreIds.length) return <p className="text-sm text-slate-600">商品同期管理には対象店舗の管理者権限が必要です。</p>
  const syncEnabled = process.env.POS_PRODUCT_MASTER_SYNC_ENABLED === 'true'
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-4">
      {result.managedStoreIds.map(id => <section key={id} aria-label={`${id === 7 ? '本店' : 'わんわん'}の商品同期`} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">{id === 7 ? '本店' : 'わんわん'}</h2>
        <ProductMasterSyncButton syncEnabled={syncEnabled} storeId={id} />
      </section>)}
    </div>
    <ProductSyncNotificationList notifications={result.notifications} unresolvedCount={result.unresolvedCount} syncEnabled={syncEnabled} />
  </div>
}

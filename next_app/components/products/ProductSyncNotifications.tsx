import { getProductSyncNotifications } from '@/app/actions/productSyncNotifications'
import { ProductSyncNotificationList } from './ProductSyncNotificationList'

export async function ProductSyncNotifications({ storeId }: { storeId: 6 | 7 | null }) {
  const result = await getProductSyncNotifications(storeId)
  if (!result.success) return <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.message}</p>
  return <ProductSyncNotificationList notifications={result.notifications} unresolvedCount={result.unresolvedCount} />
}

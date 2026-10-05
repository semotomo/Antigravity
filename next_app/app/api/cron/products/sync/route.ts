import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { PRODUCT_SYNC_STORES } from '@/lib/product-sync/notifications'
import { runProductMasterSync } from '@/lib/product-sync/run.server'
import { updateProductSyncSuccessHistory } from '@/lib/product-sync/notifications.server'
import { configuredProductMasterSyncTransport } from '@/lib/pos-products/master-sync-transport.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: '認証が必要です。' }, { status: 401 })
  }
  try {
    // Cookie認証へ依存せず、署名同期と専用の通知記録RPCだけを使う。
    const result = await runProductMasterSync(PRODUCT_SYNC_STORES, 'cron', (store, attemptId) => configuredProductMasterSyncTransport().sync(store.id, attemptId))
    if (result.success) await updateProductSyncSuccessHistory()
    for (const path of ['/sales', '/sales/daily', '/sales/abc', '/products']) revalidatePath(path)
    return NextResponse.json(result, { status: result.success ? 200 : 502 })
  } catch {
    return NextResponse.json({ success: false, message: '商品同期の状態を確認できませんでした。再送せず、管理者に同期状態を確認してもらってください。' }, { status: 500 })
  }
}

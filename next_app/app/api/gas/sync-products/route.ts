import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreContext } from '@/lib/storeAuth'
import { InventoryAccessError, requireInventoryManagerAccess } from '@/lib/inventory/auth'
import { isSameOriginInventoryRequest } from '@/lib/inventory/validation'
import { PRODUCT_SYNC_STORES } from '@/lib/product-sync/notifications'
import { runProductMasterSync } from '@/lib/product-sync/run.server'
import { updateProductSyncSuccessHistory } from '@/lib/product-sync/notifications.server'
import { configuredProductMasterSyncTransport } from '@/lib/pos-products/master-sync-transport.server'

export const maxDuration = 300

export async function POST(request: Request) {
  // ブラウザが送る正規のOriginだけを認め、認証・DB・GAS処理より前に拒否する。
  if (!isSameOriginInventoryRequest(request) || request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ success: false, message: 'この画面からの商品同期だけを受け付けます。商品一覧から再実行してください。' }, { status: 403 })
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ success: false, message: 'ログイン状態を確認できませんでした。再度ログインしてください。' }, { status: 401 })
    const context = await getStoreContext()
    const stores = PRODUCT_SYNC_STORES.filter(store => context.currentView === 'all' || store.id === (context.currentView === 'wanwan' ? 6 : 7))
    // 全店舗表示でも、対象全店舗のmanager権限を送信前に確認する。
    await Promise.all(stores.map(store => requireInventoryManagerAccess(supabase, store.id)))
    const result = await runProductMasterSync(stores, 'manual', (store, attemptId) => configuredProductMasterSyncTransport().sync(store.id, attemptId))
    if (result.success) await updateProductSyncSuccessHistory()
    for (const path of ['/sales', '/sales/daily', '/sales/abc', '/products']) revalidatePath(path)
    return NextResponse.json(result, { status: result.success ? 200 : result.results.some(row => row.outcome === 'unknown') ? 502 : 409 })
  } catch (error) {
    if (error instanceof InventoryAccessError) return NextResponse.json({ success: false, message: error.status === 401 ? 'ログインが必要です。' : '対象店舗すべての店舗管理者権限が必要です。' }, { status: error.status })
    return NextResponse.json({ success: false, message: '商品同期の状態を確認できませんでした。再送せず、管理者に同期状態を確認してもらってください。' }, { status: 500 })
  }
}

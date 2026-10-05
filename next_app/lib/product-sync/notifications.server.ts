import 'server-only'

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient as createUserClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { decodeProductSyncNotification } from './notifications'
import type { ProductSyncSource, ProductSyncStoreId, ProductSyncStoreResult } from './notifications'

type NoticeRow = { attempt_id: string; store_id: number; source: string; outcome: string; code: string | null;
  run_id: string | null; created_at: string; resolved_at: string | null; started_at: string; resolution_outcome: string | null }
type NotificationDatabase = Database & { public: Database['public'] & { Tables: Database['public']['Tables'] & {
  product_master_sync_notifications: { Row: NoticeRow; Insert: never; Update: never; Relationships: [] }
} } }

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('商品同期通知のサーバー設定を確認できません。')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

export async function getProductSyncNotificationGate(storeId: ProductSyncStoreId): Promise<{ blocked: boolean }> {
  const { data, error } = await service().rpc('get_product_master_sync_notification_gate', { p_store_id: storeId })
  if (error || !data || typeof data.blocked !== 'boolean') throw new Error('商品同期の状態を確認できません。')
  return { blocked: data.blocked }
}

export async function recordProductSyncNotification(attemptId: string, source: ProductSyncSource, result: ProductSyncStoreResult, startedAt: string) {
  const { error } = await service().rpc('record_product_master_sync_notification', {
    p_attempt_id: attemptId, p_store_id: result.storeId, p_source: source,
    p_outcome: result.outcome, p_code: result.code, p_run_id: result.runId ?? null, p_started_at: startedAt,
  })
  if (error) throw new Error('商品同期通知を保存できませんでした。')
}

export async function updateProductSyncSuccessHistory() {
  const { error } = await service().from('sync_history').upsert({ sync_type: 'products_sync', last_synced_at: new Date().toISOString() })
  if (error) throw new Error('同期は適用されましたが、最終成功日時を記録できませんでした。')
}

export async function readProductSyncNotifications(storeId: unknown) {
  if (storeId !== null && storeId !== 6 && storeId !== 7) throw new Error('対象店舗を選択してください。')
  const client = await createUserClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) throw new Error('ログインが必要です。')
  // 通知の閲覧はviewerにも許可する。Cookieやuser metadataを店舗権限として信用しない。
  const { data: access, error: accessError } = await client.from('user_store_access').select('store_id,role')
    .eq('user_id', user.id).in('role', ['manager', 'staff', 'viewer']).in('store_id', [6, 7])
  if (accessError) throw new Error('通知の店舗権限を確認できませんでした。')
  const allowed = ((access ?? []) as Array<{ store_id: number; role: string }>).map(row => row.store_id)
    .filter((id): id is ProductSyncStoreId => id === 6 || id === 7)
  if (storeId !== null && !allowed.includes(storeId)) throw new Error('この店舗の通知を表示する権限がありません。')
  const stores: ProductSyncStoreId[] = storeId === null ? allowed : [storeId]
  if (!stores.length) return { notifications: [], unresolvedCount: 0 }
  // 状態確認は同じrunのDB正本だけを見る。未受付なら遅延開始権を閉じ、商品同期は送信しない。
  await Promise.all(stores.map(id => getProductSyncNotificationGate(id).catch(() => null)))
  const readClient = client as unknown as SupabaseClient<NotificationDatabase>
  const select = 'attempt_id,store_id,source,outcome,code,run_id,started_at,created_at,resolved_at,resolution_outcome'
  const [open, resolved] = await Promise.all([
    readClient.from('product_master_sync_notifications').select(select, { count: 'exact' }).in('store_id', stores)
      .neq('outcome', 'succeeded').is('resolved_at', null).order('created_at', { ascending: false }).limit(50),
    readClient.from('product_master_sync_notifications').select(select).in('store_id', stores)
      .neq('outcome', 'succeeded').not('resolved_at', 'is', null).order('resolved_at', { ascending: false }).limit(5),
  ])
  if (open.error || resolved.error) throw new Error('商品同期通知を取得できませんでした。')
  const notifications = [...(open.data ?? []), ...(resolved.data ?? [])].map(decodeProductSyncNotification)
  if (notifications.some(row => row === null)) throw new Error('商品同期通知を確認できませんでした。')
  return { notifications: notifications.filter(row => row !== null), unresolvedCount: open.count ?? 0 }
}

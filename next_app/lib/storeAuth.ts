import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export type StoreType = 'master' | 'wanwan'
export type StoreView = 'all' | 'main' | 'wanwan'

export interface StoreContext {
  storeType: StoreType
  currentView: StoreView
  defaultStoreName: string
  defaultStoreId: number
  filterStoreName: string | undefined // SQLクエリで絞り込むための値 (undefined の場合は全店舗)
}

/**
 * ログイン中のユーザー情報を取得し、店舗権限およびデフォルト店舗コンテキストを返します。
 */
export async function getStoreContext(): Promise<StoreContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // ユーザーメタデータから store_type を判定 (デフォルトは 'master')
  const storeType: StoreType = user?.user_metadata?.store_type === 'wanwan' ? 'wanwan' : 'master'

  // デフォルト店舗の設定
  // 本店 ID: 7, 名前: "本店"
  // わんわん ID: 6, 名前: "わんわん"
  const defaultStoreId = storeType === 'wanwan' ? 6 : 7
  const defaultStoreName = storeType === 'wanwan' ? 'わんわん' : '本店'

  // クッキーから現在の選択されている表示設定を取得
  const cookieStore = await cookies()
  const storeViewCookie = cookieStore.get('current_store_view')?.value as StoreView | undefined

  // 表示設定のフォールバック (クッキー未設定時はアカウント種別に合わせる)
  const currentView: StoreView = storeViewCookie || (storeType === 'wanwan' ? 'wanwan' : 'main')

  // SQLクエリ等の店舗フィルタリング名
  let filterStoreName: string | undefined = undefined
  if (currentView === 'main') {
    filterStoreName = '本店'
  } else if (currentView === 'wanwan') {
    filterStoreName = 'わんわん'
  }

  return {
    storeType,
    currentView,
    defaultStoreId,
    defaultStoreName,
    filterStoreName,
  }
}

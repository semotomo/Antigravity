import type { SupabaseClient, User } from '@supabase/supabase-js'

import type { Database } from '@/lib/types/database'

export class InventoryAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message)
    this.name = 'InventoryAccessError'
  }
}

/** JWT metadataや画面Cookieを使わず、DBの店舗権限を毎回照合する。 */
export async function requireInventoryStoreAccess(
  supabase: SupabaseClient<Database>,
  storeId: 6 | 7,
): Promise<User> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new InventoryAccessError('ログインが必要です。', 401)
  }

  const { data: access, error: accessError } = await supabase
    .from('user_store_access')
    .select('role')
    .eq('user_id', user.id)
    .eq('store_id', storeId)
    .in('role', ['manager', 'staff'])
    .maybeSingle()

  if (accessError) {
    throw new Error(`店舗権限の確認に失敗しました: ${accessError.message}`)
  }
  if (!access) {
    throw new InventoryAccessError('この店舗の在庫を更新する権限がありません。')
  }

  return user
}

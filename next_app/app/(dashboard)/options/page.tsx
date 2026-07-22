import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OptionsBoard } from '@/components/options/OptionsBoard'

export const metadata = {
  title: 'システム設定・オプション | Kennel Dashboard',
}

export default async function OptionsPage() {
  const supabase = await createClient()

  // 1. ログインユーザー情報を取得
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // 2. マスター管理者アカウント以外はアクセスを拒否して売上一覧にリダイレクトする
  const isMaster = user.user_metadata?.store_type === 'master'
  if (!isMaster) {
    redirect('/sales')
  }

  // 3. 店舗一覧を取得する
  const { data: stores, error } = await supabase
    .from('stores')
    .select('*')
    .order('id', { ascending: true })

  if (error) {
    console.error('Error fetching stores in OptionsPage:', error)
  }

  return (
    <div className="h-full">
      <OptionsBoard initialStores={stores || []} />
    </div>
  )
}

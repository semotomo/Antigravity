import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreContext } from '@/lib/storeAuth'

// 商品マスタ同期用APIルート
// GAS Web App を mode=master で呼び出す
export async function POST() {
  try {
    const supabase = await createClient() as any
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { message: 'ログイン状態を確認できませんでした。再度ログインしてください。' },
        { status: 401 }
      )
    }

    const gasWebAppUrl = process.env.GAS_WEBAPP_URL

    if (!gasWebAppUrl) {
      return NextResponse.json(
        { message: 'GAS_WEBAPP_URL が設定されていません。' },
        { status: 500 }
      )
    }

    const storeContext = await getStoreContext()
    let targetStores: Array<{ name: string; pos_group_id: string | null; pos_group_name: string | null }> = []

    if (storeContext.currentView === 'wanwan') {
      targetStores = [{ name: 'わんわん', pos_group_id: '11054', pos_group_name: 'わんわん' }]
    } else if (storeContext.currentView === 'main') {
      targetStores = [{ name: '本店', pos_group_id: '11098', pos_group_name: 'からつケンネル本店' }]
    } else {
      const { data: dbStores } = await supabase
        .from('stores')
        .select('name, pos_group_id, pos_group_name')
        .not('pos_group_id', 'is', null)
      targetStores = dbStores && dbStores.length > 0 ? dbStores : [{ name: '本店', pos_group_id: '11098', pos_group_name: 'からつケンネル本店' }]
    }

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const syncResults: Array<{ store: string; csvCount: number; syncCount: number }> = []

    for (let i = 0; i < targetStores.length; i++) {
      const store = targetStores[i]
      if (i > 0) {
        await sleep(10000)
      }

      const url = new URL(gasWebAppUrl)
      url.searchParams.set('mode', 'master')
      if (store.pos_group_id) {
        url.searchParams.set('tenpoGroupId', store.pos_group_id)
      }
      if (store.pos_group_name) {
        url.searchParams.set('tenpoGroupName', store.pos_group_name)
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        const responseText = await response.text()
        return NextResponse.json(
          {
            message: `[${store.name}] GAS Web App の呼び出しに失敗しました: ${responseText}`,
          },
          { status: 502 }
        )
      }

      const gasResult = (await response.json().catch(() => null)) as {
        success?: boolean
        master?: { success?: boolean; message?: string; csvRowCount?: number; syncResult?: { count?: number } }
        message?: string
      } | null

      if (!gasResult || gasResult.success === false) {
        return NextResponse.json(
          { message: `[${store.name}] GAS内部でエラーが発生しました: ${gasResult?.message || ''}` },
          { status: 500 }
        )
      }

      const masterResult = gasResult.master
      if (masterResult && masterResult.success === false) {
        return NextResponse.json(
          { message: `[${store.name}] 商品マスタ同期失敗: ${masterResult.message || ''}` },
          { status: 500 }
        )
      }

      const syncCount = masterResult?.syncResult?.count ?? 0
      const csvCount = masterResult?.csvRowCount ?? 0
      syncResults.push({ store: store.name, csvCount, syncCount })
    }

    revalidatePath('/sales')
    revalidatePath('/sales/daily')
    revalidatePath('/sales/abc')
    revalidatePath('/products')

    // 同期履歴の更新
    await supabase.from('sync_history').upsert({
      sync_type: 'products_sync',
      last_synced_at: new Date().toISOString(),
    })

    const totalSyncCount = syncResults.reduce((sum, r) => sum + r.syncCount, 0)
    const totalCsvCount = syncResults.reduce((sum, r) => sum + r.csvCount, 0)

    return NextResponse.json({
      message: `商品マスタの同期が完了しました。（対象店舗: ${syncResults.map(r => r.store).join(', ')} / CSV: ${totalCsvCount}件 → Supabase: ${totalSyncCount}件処理）`,
      details: syncResults,
    })
  } catch (error) {
    console.error('Unexpected error while syncing product master:', error)
    return NextResponse.json(
      { message: '商品マスタ同期の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

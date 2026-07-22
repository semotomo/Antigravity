import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreContext } from '@/lib/storeAuth'

export async function POST(request: Request) {
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

    // リクエストボディから年月を取得
    let year: number | undefined
    let month: number | undefined
    try {
      const body = await request.json()
      if (body.year) year = Number(body.year)
      if (body.month) month = Number(body.month)
    } catch {
      // ボディがない、またはJSONパースエラーの場合は無視
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

    for (let i = 0; i < targetStores.length; i++) {
      const store = targetStores[i]
      if (i > 0) {
        await sleep(10000)
      }

      const url = new URL(gasWebAppUrl)
      url.searchParams.set('mode', 'sales')
      if (year !== undefined) url.searchParams.set('year', String(year))
      if (month !== undefined) url.searchParams.set('month', String(month))
      if (store.pos_group_id) url.searchParams.set('tenpoGroupId', store.pos_group_id)
      if (store.pos_group_name) url.searchParams.set('tenpoGroupName', store.pos_group_name)

      const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        const responseText = await response.text()
        return NextResponse.json(
          { message: `[${store.name}] GAS Web App の呼び出しに失敗しました: ${responseText}` },
          { status: 502 }
        )
      }

      const gasResult = (await response.json().catch(() => null)) as {
        success?: boolean
        message?: string
      } | null

      if (!gasResult || gasResult.success === false) {
        return NextResponse.json(
          { message: `[${store.name}] 売上取込中にエラーが発生しました: ${gasResult?.message || ''}` },
          { status: 500 }
        )
      }
    }

    revalidatePath('/sales')
    revalidatePath('/sales/daily')
    revalidatePath('/sales/abc')

    // 同期履歴の更新
    await supabase.from('sync_history').upsert({
      sync_type: 'sales_import',
      last_synced_at: new Date().toISOString(),
    })

    return NextResponse.json({
      message: `売上データの取込を完了しました。（対象店舗: ${targetStores.map(s => s.name).join(', ')}）`,
    })
  } catch (error) {
    console.error('Unexpected error while triggering GAS import:', error)
    return NextResponse.json(
      { message: '売上データ取込の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

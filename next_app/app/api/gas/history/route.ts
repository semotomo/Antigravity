import { NextResponse } from 'next/server'
import {
  combineHistorySnapshots,
  getHistoryTargetStores,
  isHistoryDate,
  readHistorySnapshots,
  refreshHistorySnapshots,
} from '@/lib/realtimeHistory'
import { getStoreContext } from '@/lib/storeAuth'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// GAS（販売）とSupabase（店舗間移動・物品使用）を統合し、最後の取得結果を保存する
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { message: 'ログイン状態を確認できませんでした。再度ログインしてください。' },
        { status: 401 },
      )
    }

    const storeContext = await getStoreContext()
    const targetStores = getHistoryTargetStores(storeContext.currentView)
    const { searchParams } = new URL(request.url)
    const shouldRefresh = searchParams.get('refresh') === 'true'

    if (!shouldRefresh) {
      const snapshots = await readHistorySnapshots(supabase, targetStores)
      const combined = combineHistorySnapshots(snapshots)
      const selectedStore = targetStores.length === 1 ? targetStores[0] : null

      return NextResponse.json({
        success: true,
        ...combined,
        cached: true,
        hasCache: snapshots.length > 0,
        targetStore: selectedStore
          ? { name: selectedStore.name, id: selectedStore.displayStoreId }
          : { name: '全店舗', id: '全店舗' },
      })
    }

    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    if (!isHistoryDate(startDate) || !isHistoryDate(endDate)) {
      return NextResponse.json(
        { message: '期間は yyyy/MM/dd 形式の正しい日付で指定してください。' },
        { status: 400 },
      )
    }

    if (startDate > endDate) {
      return NextResponse.json(
        { message: '開始日は終了日以前にしてください。' },
        { status: 400 },
      )
    }

    const gasWebAppUrl = process.env.GAS_WEBAPP_URL
    if (!gasWebAppUrl) {
      return NextResponse.json(
        { message: 'GAS_WEBAPP_URL が設定されていません。' },
        { status: 500 },
      )
    }

    const snapshots = await refreshHistorySnapshots(
      supabase,
      gasWebAppUrl,
      targetStores,
      startDate,
      endDate,
    )
    const combined = combineHistorySnapshots(snapshots)
    const selectedStore = targetStores.length === 1 ? targetStores[0] : null

    return NextResponse.json({
      success: true,
      ...combined,
      cached: false,
      hasCache: true,
      targetStore: selectedStore
        ? { name: selectedStore.name, id: selectedStore.displayStoreId }
        : { name: '全店舗', id: '全店舗' },
    })
  } catch (error) {
    console.error('Unexpected error in history API:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error
          ? error.message
          : '履歴取得の呼び出し中に予期しないエラーが発生しました。',
      },
      { status: 500 },
    )
  }
}

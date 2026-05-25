import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 入出庫履歴取得用APIルート
// GAS（販売）とSupabase（店舗間移動・物品使用）を統合して返す
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
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''

    // -----------------------------------------------------------
    // 1. GAS経由でPOSポータルから「販売」データを取得
    // -----------------------------------------------------------
    const gasWebAppUrl = process.env.GAS_WEBAPP_URL
    let gasRows: HistoryRow[] = []

    if (gasWebAppUrl) {
      try {
        const gasUrl = new URL(gasWebAppUrl)
        gasUrl.searchParams.set('mode', 'history')
        if (startDate) gasUrl.searchParams.set('startDate', startDate)
        if (endDate) gasUrl.searchParams.set('endDate', endDate)

        const gasRes = await fetch(gasUrl.toString(), { method: 'GET', cache: 'no-store' })
        if (gasRes.ok) {
          const gasResult = await gasRes.json().catch(() => null)
          if (gasResult?.history?.success && Array.isArray(gasResult.history.data)) {
            gasRows = gasResult.history.data
          }
        }
      } catch (e) {
        console.error('GAS履歴取得エラー:', e)
        // GASエラーはSupabaseデータのみで続行（エラーにしない）
      }
    }

    // -----------------------------------------------------------
    // 2. Supabaseから「店舗間移動」「物品使用」データを取得
    // -----------------------------------------------------------
    let transferRows: HistoryRow[] = []

    if (startDate || endDate) {
      // yyyy/MM/dd → yyyy-MM-dd 形式に変換（Supabaseはハイフン区切り）
      const toDbDate = (d: string) => d.replace(/\//g, '-')

      let query = supabase
        .from('transfers')
        .select(`
          transfer_date,
          from_store_id,
          jan_code,
          product_name,
          quantity,
          cost_price,
          total_cost,
          entry_type,
          stores!transfers_from_store_id_fkey(name)
        `)
        .in('entry_type', ['transfer', 'usage'])
        .order('transfer_date', { ascending: false })

      if (startDate) query = query.gte('transfer_date', toDbDate(startDate))
      if (endDate) query = query.lte('transfer_date', toDbDate(endDate))

      const { data: tData, error: tErr } = await query

      if (tErr) {
        console.error('Supabase transfers取得エラー:', tErr)
      } else if (tData) {
        // HistoryRow 形式に変換
        const entryTypeLabel: Record<string, string> = {
          transfer: '店舗間移動',
          usage: '物品使用',
        }
        transferRows = (tData as any[]).map((row) => ({
          // transfer_date は "yyyy-MM-dd" 形式なので日時として整形
          taskDateTime: row.transfer_date ?? '',
          // stores はリレーション取得（型アサーション）
          storeName: (row.stores as unknown as { name: string } | null)?.name ?? '',
          taskContent: entryTypeLabel[row.entry_type ?? ''] ?? row.entry_type ?? '',
          productName: row.product_name ?? '',
          productCode: row.jan_code ?? '',
          quantity: row.quantity ?? 0,
          cost: row.cost_price ?? 0,
          totalCost: row.total_cost ?? 0,
        }))
      }
    }

    // -----------------------------------------------------------
    // 3. マージして日時降順でソート
    // -----------------------------------------------------------
    const merged: HistoryRow[] = [...gasRows, ...transferRows].sort((a, b) => {
      // 文字列比較（"yyyy/MM/dd HH:mm" と "yyyy-MM-dd" が混在するため正規化）
      const normalize = (s: string) => s.replace(/\//g, '-')
      return normalize(b.taskDateTime).localeCompare(normalize(a.taskDateTime))
    })

    return NextResponse.json({
      success: true,
      data: merged,
      count: merged.length,
      gasCount: gasRows.length,
      transferCount: transferRows.length,
    })
  } catch (error) {
    console.error('Unexpected error in history API:', error)
    return NextResponse.json(
      { message: '履歴取得の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

// HistoryRow型定義
type HistoryRow = {
  productCode: string
  productName: string
  taskContent: string
  storeName: string
  taskDateTime: string
  quantity: number
  cost: number
  totalCost: number
}

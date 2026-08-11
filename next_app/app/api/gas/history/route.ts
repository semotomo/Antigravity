import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreContext } from '@/lib/storeAuth'

export const maxDuration = 300

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

type HistoryTargetStore = {
  name: '本店' | 'わんわん'
  displayStoreId: '11053' | '11054'
  tenpoGroupId: '11098' | '11099'
  tenpoGroupName: 'からつケンネル本店' | 'わんわんペットセンター'
}

type GasHistoryResponse = {
  success?: boolean
  message?: string
  history?: {
    success?: boolean
    message?: string
    data?: HistoryRow[]
  }
  logs?: string
}

const HISTORY_STORES: Record<'main' | 'wanwan', HistoryTargetStore> = {
  main: {
    name: '本店',
    displayStoreId: '11053',
    tenpoGroupId: '11098',
    tenpoGroupName: 'からつケンネル本店',
  },
  wanwan: {
    name: 'わんわん',
    displayStoreId: '11054',
    tenpoGroupId: '11099',
    tenpoGroupName: 'わんわんペットセンター',
  },
}

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

    const storeContext = await getStoreContext()
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const gasWebAppUrl = process.env.GAS_WEBAPP_URL

    if (!gasWebAppUrl) {
      return NextResponse.json(
        { message: 'GAS_WEBAPP_URL が設定されていません。' },
        { status: 500 }
      )
    }

    let targetStores: HistoryTargetStore[]
    if (storeContext.currentView === 'wanwan') {
      targetStores = [HISTORY_STORES.wanwan]
    } else if (storeContext.currentView === 'main') {
      targetStores = [HISTORY_STORES.main]
    } else {
      targetStores = [HISTORY_STORES.main, HISTORY_STORES.wanwan]
    }

    const gasRows: HistoryRow[] = []
    for (const store of targetStores) {
      const gasResponse = await fetch(gasWebAppUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'history',
          startDate,
          endDate,
          targetStoreName: store.name,
          tenpoGroupId: store.tenpoGroupId,
          tenpoGroupName: store.tenpoGroupName,
        }),
      })

      const responseText = await gasResponse.text()
      let gasResult: GasHistoryResponse | null = null
      try {
        gasResult = JSON.parse(responseText) as GasHistoryResponse
      } catch {
        // 下の共通エラーでレスポンス先頭を返す
      }

      if (!gasResponse.ok || !gasResult || gasResult.success === false) {
        return NextResponse.json(
          {
            success: false,
            message: `[${store.name}] GAS履歴取得に失敗しました: ${gasResult?.message || responseText.slice(0, 300)}`,
          },
          { status: 502 }
        )
      }

      if (gasResult.history?.success === false || !Array.isArray(gasResult.history?.data)) {
        return NextResponse.json(
          {
            success: false,
            message: `[${store.name}] ${gasResult.history?.message || 'GASから履歴データが返されませんでした。'}`,
            logs: gasResult.logs || '',
          },
          { status: 502 }
        )
      }

      gasRows.push(...gasResult.history.data)
    }

    let transferRows: HistoryRow[] = []
    if (startDate || endDate) {
      const toDbDate = (date: string) => date.replace(/\//g, '-')

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

      if (storeContext.currentView === 'wanwan') {
        query = query.eq('from_store_id', 6)
      } else if (storeContext.currentView === 'main') {
        query = query.eq('from_store_id', 7)
      }

      if (startDate) query = query.gte('transfer_date', toDbDate(startDate))
      if (endDate) query = query.lte('transfer_date', toDbDate(endDate))

      const { data: transferData, error: transferError } = await query
      if (transferError) {
        console.error('Supabase transfers取得エラー:', transferError)
      } else if (transferData) {
        const entryTypeLabel: Record<string, string> = {
          transfer: '店舗間移動',
          usage: '物品使用',
        }
        transferRows = (transferData as Array<Record<string, unknown>>).map((row) => ({
          taskDateTime: String(row.transfer_date ?? ''),
          storeName: (row.stores as { name?: string } | null)?.name ?? '',
          taskContent: entryTypeLabel[String(row.entry_type ?? '')] ?? String(row.entry_type ?? ''),
          productName: String(row.product_name ?? ''),
          productCode: String(row.jan_code ?? ''),
          quantity: Number(row.quantity ?? 0),
          cost: Number(row.cost_price ?? 0),
          totalCost: Number(row.total_cost ?? 0),
        }))
      }
    }

    const merged = [...gasRows, ...transferRows].sort((left, right) => {
      const normalize = (value: string) => value.replace(/\//g, '-')
      return normalize(right.taskDateTime).localeCompare(normalize(left.taskDateTime))
    })

    const selectedStore = targetStores.length === 1 ? targetStores[0] : null
    return NextResponse.json({
      success: true,
      data: merged,
      count: merged.length,
      gasCount: gasRows.length,
      transferCount: transferRows.length,
      targetStore: selectedStore
        ? { name: selectedStore.name, id: selectedStore.displayStoreId }
        : { name: '全店舗', id: '全店舗' },
    })
  } catch (error) {
    console.error('Unexpected error in history API:', error)
    return NextResponse.json(
      { message: '履歴取得の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

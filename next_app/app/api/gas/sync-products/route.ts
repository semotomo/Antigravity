import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    // mode=master を付与して商品マスタ同期のみ実行
    const url = new URL(gasWebAppUrl)
    url.searchParams.set('mode', 'master')

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      const responseText = await response.text()
      return NextResponse.json(
        {
          message:
            responseText ||
            'GAS Web App の呼び出しに失敗しました。時間を置いて再度お試しください。',
        },
        { status: 502 }
      )
    }

    // GASからのJSON結果を解析
    const gasResult = (await response.json().catch(() => null)) as {
      success?: boolean
      master?: { success?: boolean; message?: string; csvRowCount?: number; syncResult?: { count?: number } }
      message?: string
    } | null

    if (!gasResult) {
      return NextResponse.json(
        { message: 'GAS Web App が予期しない応答（HTML等）を返しました。GASのデプロイ設定（アクセスできるユーザー: 全員）を確認してください。' },
        { status: 502 }
      )
    }

    if (gasResult.success === false) {
      return NextResponse.json(
        { message: gasResult.message || 'GAS処理中に全体エラーが発生しました。' },
        { status: 500 }
      )
    }

    const masterResult = gasResult.master
    if (masterResult && masterResult.success === false) {
      return NextResponse.json(
        { message: masterResult.message || '商品マスタの取得または同期に失敗しました。' },
        { status: 500 }
      )
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

    // 詳細情報を含むレスポンス
    const syncCount = masterResult?.syncResult?.count ?? 0
    const csvCount = masterResult?.csvRowCount ?? 0

    return NextResponse.json({
      message: `商品マスタの同期が完了しました。（CSV: ${csvCount}件 → Supabase: ${syncCount}件処理）`,
      details: gasResult,
    })
  } catch (error) {
    console.error('Unexpected error while syncing product master:', error)
    return NextResponse.json(
      { message: '商品マスタ同期の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

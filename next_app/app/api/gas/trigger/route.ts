import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    // クエリパラメータの構築
    const url = new URL(gasWebAppUrl)
    url.searchParams.set('mode', 'sales')
    if (year !== undefined) url.searchParams.set('year', String(year))
    if (month !== undefined) url.searchParams.set('month', String(month))

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      const responseText = await response.text()
      return NextResponse.json(
        {
          message:
            responseText || 'GAS Web App の呼び出しに失敗しました。時間を置いて再度お試しください。',
        },
        { status: 502 }
      )
    }

    const gasResult = (await response.json().catch(() => null)) as {
      success?: boolean
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
        { message: gasResult.message || 'GAS処理中にエラーが発生しました。' },
        { status: 500 }
      )
    }

    revalidatePath('/sales')
    revalidatePath('/sales/daily')
    revalidatePath('/sales/products')
    revalidatePath('/sales/abc')

    // 同期履歴の更新
    await supabase.from('sync_history').upsert({
      sync_type: 'sales_import',
      last_synced_at: new Date().toISOString(),
    })

    return NextResponse.json({
      message: '売上データの取込を実行しました。最新結果へ更新します。',
    })
  } catch (error) {
    console.error('Unexpected error while triggering GAS import:', error)
    return NextResponse.json(
      { message: '売上データ取込の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

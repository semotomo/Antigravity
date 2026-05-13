import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 入出庫履歴取得用APIルート
// GAS Web App を mode=history で呼び出す
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
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

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''

    const url = new URL(gasWebAppUrl)
    url.searchParams.set('mode', 'history')
    if (startDate) url.searchParams.set('startDate', startDate)
    if (endDate) url.searchParams.set('endDate', endDate)

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

    const gasResult = await response.json().catch(() => null)

    if (!gasResult) {
      return NextResponse.json(
        { message: 'GAS Web App が予期しない応答（HTML等）を返しました。' },
        { status: 502 }
      )
    }

    return NextResponse.json(gasResult)
  } catch (error) {
    console.error('Unexpected error while fetching history from GAS:', error)
    return NextResponse.json(
      { message: '履歴取得の呼び出し中に予期しないエラーが発生しました。' },
      { status: 500 }
    )
  }
}

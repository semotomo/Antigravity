import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
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

    const response = await fetch(gasWebAppUrl, {
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

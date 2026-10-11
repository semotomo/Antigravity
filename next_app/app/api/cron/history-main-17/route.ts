import { NextResponse } from 'next/server'
import { HISTORY_STORES } from '@/lib/realtimeHistory'
import { runRealtimeHistoryCron } from '@/lib/realtimeHistoryCron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 日本時間17:00に本店を取得。実行精度はVercelの契約プランに従う。
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRealtimeHistoryCron(HISTORY_STORES.main)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[Cron History Main 17] 自動更新エラー:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '自動更新に失敗しました。' },
      { status: 500 },
    )
  }
}

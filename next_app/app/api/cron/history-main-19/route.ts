import { NextResponse } from 'next/server'
import { HISTORY_STORES } from '@/lib/realtimeHistory'
import { runRealtimeHistoryCron } from '@/lib/realtimeHistoryCron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 既存URLを維持し、日本時間18:50に本店を取得する。
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRealtimeHistoryCron(HISTORY_STORES.main)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[Cron History Main 18:50] 自動更新エラー:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '自動更新に失敗しました。' },
      { status: 500 },
    )
  }
}

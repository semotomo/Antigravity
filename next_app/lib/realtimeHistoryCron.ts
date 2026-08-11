import {
  combineHistorySnapshots,
  getJstToday,
  refreshHistorySnapshot,
  type HistoryTargetStore,
} from '@/lib/realtimeHistory'
import { createClient } from '@/lib/supabase/server'

export async function runRealtimeHistoryCron(store: HistoryTargetStore) {
  const gasWebAppUrl = process.env.GAS_WEBAPP_URL
  if (!gasWebAppUrl) {
    throw new Error('GAS_WEBAPP_URL が設定されていません。')
  }

  const supabase = await createClient()
  const today = getJstToday()
  const snapshot = await refreshHistorySnapshot(
    supabase,
    gasWebAppUrl,
    store,
    today,
    today,
  )

  return {
    targetDate: today,
    ...combineHistorySnapshots([snapshot]),
  }
}

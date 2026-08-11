import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('履歴キャッシュは店舗ごとに1世代保存する', () => {
  const migration = source('supabase/migrations/20260811210000_add_realtime_history_cache.sql')
  const historyLibrary = source('next_app/lib/realtimeHistory.ts')

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.realtime_history_cache/)
  assert.match(migration, /store_id INTEGER PRIMARY KEY/)
  assert.match(migration, /history_rows JSONB NOT NULL/)
  assert.match(historyLibrary, /from\('realtime_history_cache'\)\.upsert/)
  assert.match(historyLibrary, /readHistorySnapshots/)
})

test('履歴画面は開いた時に保存履歴を復元し、手動操作だけPOSを再取得する', () => {
  const historyRoute = source('next_app/app/api/gas/history/route.ts')
  const historyModal = source('next_app/components/sales/SalesHistoryModal.tsx')

  assert.match(historyRoute, /searchParams\.get\('refresh'\) === 'true'/)
  assert.match(historyRoute, /readHistorySnapshots\(supabase, targetStores\)/)
  assert.match(historyModal, /void fetchHistory\(false\)/)
  assert.match(historyModal, /void fetchHistory\(true\)/)
  assert.match(historyModal, /保存履歴:/)
})

test('Hobbyプラン向けに店舗別Cronを17時・19時までに実行する', () => {
  const vercelConfig = JSON.parse(source('next_app/vercel.json'))
  const schedules = new Map(vercelConfig.crons.map((cron) => [cron.path, cron.schedule]))

  assert.equal(schedules.get('/api/cron/history-main-17'), '0 6 * * *')
  assert.equal(schedules.get('/api/cron/history-wanwan-17'), '0 7 * * *')
  assert.equal(schedules.get('/api/cron/history-main-19'), '0 8 * * *')
  assert.equal(schedules.get('/api/cron/history-wanwan-19'), '0 9 * * *')

  for (const route of [
    'history-main-17',
    'history-wanwan-17',
    'history-main-19',
    'history-wanwan-19',
  ]) {
    assert.match(
      source(`next_app/app/api/cron/${route}/route.ts`),
      /export const maxDuration = 60/,
    )
  }
})

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(testDir, '..', 'next_app', '.env.local')
const envLines = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)

function readEnvValue(name) {
  const line = envLines.find((candidate) => candidate.startsWith(`${name}=`))
  if (!line) throw new Error(`next_app/.env.local に ${name} がありません。`)
  return line.slice(line.indexOf('=') + 1).trim()
}

const supabaseUrl = readEnvValue('NEXT_PUBLIC_SUPABASE_URL')
const supabaseKey = readEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const url = new URL('/rest/v1/realtime_history_cache', supabaseUrl)
url.searchParams.set(
  'select',
  'store_id,start_date,end_date,item_count,gas_count,transfer_count,fetched_at,history_rows',
)
url.searchParams.set('order', 'store_id.asc')

const response = await fetch(url, {
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  },
})
const responseText = await response.text()
if (!response.ok) {
  throw new Error(`履歴キャッシュ監査GET失敗: ${response.status} ${responseText.slice(0, 300)}`)
}

const rows = JSON.parse(responseText || '[]')
const result = rows.map((row) => ({
  storeId: row.store_id,
  startDate: row.start_date,
  endDate: row.end_date,
  itemCount: row.item_count,
  gasCount: row.gas_count,
  transferCount: row.transfer_count,
  actualRows: Array.isArray(row.history_rows) ? row.history_rows.length : -1,
  fetchedAt: row.fetched_at,
  sampleProductName: row.history_rows?.[0]?.productName || '',
  sampleStoreName: row.history_rows?.[0]?.storeName || '',
}))

console.log(JSON.stringify(result, null, 2))

const expectedStoreIds = new Set([6, 7])
if (
  result.length !== 2 ||
  result.some((row) => !expectedStoreIds.has(row.storeId) || row.itemCount !== row.actualRows)
) {
  process.exitCode = 1
}

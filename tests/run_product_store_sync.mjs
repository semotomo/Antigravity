import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const storeKey = process.argv[2]
const stores = {
  main: {
    name: '本店',
    tenpoGroupId: '11098',
    tenpoGroupName: 'からつケンネル本店',
  },
  wanwan: {
    name: 'わんわん',
    tenpoGroupId: '11099',
    tenpoGroupName: 'わんわんペットセンター',
  },
}
const store = stores[storeKey]

if (!store) {
  throw new Error('引数は main または wanwan を指定してください。')
}

const testDir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(testDir, '..', 'next_app', '.env.local')
const envLines = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
const gasLine = envLines.find((line) => line.startsWith('GAS_WEBAPP_URL='))
if (!gasLine) throw new Error('next_app/.env.local に GAS_WEBAPP_URL がありません。')
const gasWebAppUrl = gasLine.slice(gasLine.indexOf('=') + 1).trim()

const response = await fetch(gasWebAppUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'master',
    tenpoGroupId: store.tenpoGroupId,
    tenpoGroupName: store.tenpoGroupName,
    targetStoreName: store.name,
  }),
})
const responseText = await response.text()
let result
try {
  result = JSON.parse(responseText)
} catch {
  throw new Error(`GAS response was not JSON: ${response.status} ${responseText.slice(0, 500)}`)
}

if (!response.ok || result.success === false || result.master?.success === false) {
  console.error(JSON.stringify({
    store: store.name,
    status: response.status,
    message: result.message ?? result.master?.message ?? '商品同期に失敗しました。',
    logs: result.logs?.slice(-2000) ?? '',
  }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    store: store.name,
    status: response.status,
    csvRows: result.master?.csvRowCount ?? 0,
    syncedRows: result.master?.syncResult?.count ?? 0,
    syncStartedAt: result.master?.syncResult?.syncStartedAt ?? null,
  }, null, 2))
}

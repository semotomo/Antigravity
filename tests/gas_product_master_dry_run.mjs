import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(testDir, '..', 'next_app', '.env.local')
const envLines = fs.readFileSync(envPath, 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)

const gasUrlLine = envLines.find((line) => line.startsWith('GAS_WEBAPP_URL='))
if (!gasUrlLine) {
  throw new Error('next_app/.env.local に GAS_WEBAPP_URL がありません。')
}

const gasWebAppUrl = gasUrlLine.slice(gasUrlLine.indexOf('=') + 1).trim()
const applyChanges = process.argv.includes('--apply')
const requestedStore = process.argv.find((argument) => argument.startsWith('--store='))
  ?.slice('--store='.length)
const stores = [
  {
    name: '本店',
    tenpoGroupId: '11098',
    tenpoGroupName: 'からつケンネル本店',
  },
  {
    name: 'わんわん',
    tenpoGroupId: '11099',
    tenpoGroupName: 'わんわんペットセンター',
  },
].filter((store) => !requestedStore || store.name === requestedStore)

if (stores.length === 0) {
  throw new Error(`未対応の店舗です: ${requestedStore}`)
}

for (const store of stores) {
  const response = await fetch(gasWebAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'master',
      targetStoreName: store.name,
      tenpoGroupId: store.tenpoGroupId,
      tenpoGroupName: store.tenpoGroupName,
      dryRun: !applyChanges,
    }),
  })
  const responseText = await response.text()
  let data
  try {
    data = JSON.parse(responseText)
  } catch {
    throw new Error(`${store.name}: GASがJSON以外を返しました: ${responseText.slice(0, 200)}`)
  }

  const master = data.master || {}
  console.log(JSON.stringify({
    store: store.name,
    httpStatus: response.status,
    success: data.success,
    masterSuccess: master.success,
    requestedDryRun: !applyChanges,
    dryRun: master.dryRun,
    csvRowCount: master.csvRowCount,
    syncSuccess: master.syncResult?.success,
    syncCount: master.syncResult?.count,
    syncMessage: master.syncResult?.message,
    actualStores: master.diagnostics?.storeSummary,
    message: data.message || master.message || '',
    logTail: data.logs?.split('\n').slice(-8),
  }))
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function readEnvFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1).trim()]
      }),
  )
}

const env = readEnvFile(path.join(projectRoot, 'next_app', '.env.local'))
const requestedStore = process.argv.find((argument) => argument.startsWith('--store='))
  ?.slice('--store='.length) || 'わんわん'
const useCredentials = process.argv.includes('--credentials')
const groupIdOverride = process.argv.find((argument) => argument.startsWith('--group-id='))
  ?.slice('--group-id='.length)
const stores = {
  本店: {
    tenpoGroupId: '11098',
    tenpoGroupName: 'からつケンネル本店',
  },
  わんわん: {
    tenpoGroupId: '11099',
    tenpoGroupName: 'わんわんペットセンター',
  },
}
const store = stores[requestedStore]
if (!store) throw new Error(`未対応の店舗です: ${requestedStore}`)

const body = {
  mode: 'history',
  targetStoreName: requestedStore,
  tenpoGroupId: groupIdOverride || store.tenpoGroupId,
  tenpoGroupName: store.tenpoGroupName,
  startDate: '2026/07/01',
  endDate: '2026/08/11',
}

if (useCredentials) {
  const credentials = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'next_app', 'pos_credentials.json'), 'utf8'),
  ).wanwan
  body.lid = credentials.loginId
  body.lpw = credentials.password
  body.lcd = credentials.companyCd
  // 本店アカウントのcompanyKeyを別アカウントへ引き継がない
  body.companyKey = ''
}

const response = await fetch(env.GAS_WEBAPP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const responseText = await response.text()
const data = JSON.parse(responseText)
const historyRows = data.history?.data || []
const relevantLogs = (data.logs || '').split('\n').filter((line) => (
  /ログイン|店舗切替|tenpo|Tenpo|店舗|パース結果|レスポンス情報/.test(line)
)).slice(-30)

console.log(JSON.stringify({
  store: requestedStore,
  useCredentials,
  requestedGroupId: body.tenpoGroupId,
  httpStatus: response.status,
  success: data.success,
  historySuccess: data.history?.success,
  count: historyRows.length,
  message: data.message || data.history?.message || '',
  sampleStores: historyRows.slice(0, 10).map((row) => row.storeName),
  relevantLogs,
}, null, 2))

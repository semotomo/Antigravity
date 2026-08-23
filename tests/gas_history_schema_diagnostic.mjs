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

function argumentValue(name, fallback) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1) || fallback
}

const env = readEnvFile(path.resolve(
  argumentValue('--env-file', path.join(projectRoot, 'next_app', '.env.local')),
))
const diagnosticToken = env.GAS_HISTORY_SCHEMA_TOKEN
if (!diagnosticToken) {
  throw new Error('env fileにGAS_HISTORY_SCHEMA_TOKENが必要です。')
}
const requestedStore = argumentValue('--store', 'わんわん')
const useCredentials = process.argv.includes('--credentials')
const stores = {
  本店: { tenpoGroupId: '11098', tenpoGroupName: 'からつケンネル本店' },
  わんわん: { tenpoGroupId: '11099', tenpoGroupName: 'わんわんペットセンター' },
}
const store = stores[requestedStore]
if (!store) throw new Error(`未対応の店舗です: ${requestedStore}`)
if (useCredentials && requestedStore !== 'わんわん') {
  throw new Error('--credentialsはわんわん診断専用です。')
}

const now = new Date()
const defaultDate = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(now)

const body = {
  mode: 'history_schema',
  diagnosticToken,
  targetStoreName: requestedStore,
  tenpoGroupId: argumentValue('--group-id', store.tenpoGroupId),
  tenpoGroupName: store.tenpoGroupName,
  startDate: argumentValue('--start', defaultDate),
  endDate: argumentValue('--end', defaultDate),
}

if (useCredentials) {
  const credentialsPath = path.resolve(
    argumentValue('--credentials-file', path.join(projectRoot, 'next_app', 'pos_credentials.json')),
  )
  const credentials = JSON.parse(
    fs.readFileSync(credentialsPath, 'utf8'),
  ).wanwan
  body.lid = credentials.loginId
  body.lpw = credentials.password
  body.lcd = credentials.companyCd
  body.companyKey = ''
}

const response = await fetch(env.GAS_WEBAPP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(120_000),
})
const responseText = await response.text()
const data = JSON.parse(responseText)

console.log(JSON.stringify({
  store: requestedStore,
  startDate: body.startDate,
  endDate: body.endDate,
  httpStatus: response.status,
  success: data.success,
  historySuccess: data.history?.success,
  schema: data.history?.schema ?? null,
  rowDataReturned: Array.isArray(data.history?.data) && data.history.data.length > 0,
  logsReturned: Boolean(data.logs),
  message: data.message || data.history?.message || '',
}, null, 2))

if (!response.ok || data.success === false || data.history?.success === false) {
  process.exitCode = 1
}

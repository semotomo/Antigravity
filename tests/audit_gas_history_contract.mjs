import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function argumentValue(name, fallback) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1) || fallback
}

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

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

const requestedStore = argumentValue('--store', 'わんわん')
const stores = {
  本店: { tenpoGroupId: '11098', tenpoGroupName: 'からつケンネル本店' },
  わんわん: { tenpoGroupId: '11099', tenpoGroupName: 'わんわんペットセンター' },
}
const store = stores[requestedStore]
if (!store) throw new Error(`未対応の店舗です: ${requestedStore}`)

const env = readEnvFile(path.resolve(
  argumentValue('--env-file', path.join(projectRoot, 'next_app', '.env.local')),
))
const startDate = argumentValue('--start', '2026/08/01')
const endDate = argumentValue('--end', '2026/08/22')

const response = await fetch(env.GAS_WEBAPP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'history',
    targetStoreName: requestedStore,
    tenpoGroupId: store.tenpoGroupId,
    tenpoGroupName: store.tenpoGroupName,
    startDate,
    endDate,
  }),
  signal: AbortSignal.timeout(120_000),
})
const responseText = await response.text()
const data = JSON.parse(responseText)
const rows = Array.isArray(data.history?.data) ? data.history.data : []
const expectedKeys = new Set([
  'cost',
  'productCode',
  'productName',
  'quantity',
  'storeName',
  'taskContent',
  'taskDateTime',
  'totalCost',
])
const taskTypes = new Map()
const quantitySigns = new Map()
const missingJanByTask = new Map()
const exceptionalTaskDates = new Map()
const exactRows = new Map()
const extraKeys = new Set()
const stableIdKeys = new Set()

for (const row of rows) {
  const taskContent = String(row.taskContent || '(empty)')
  const quantity = Number(row.quantity)
  increment(taskTypes, taskContent)
  const signs = quantitySigns.get(taskContent) ?? { positive: 0, negative: 0, zero: 0 }
  if (quantity > 0) signs.positive += 1
  else if (quantity < 0) signs.negative += 1
  else signs.zero += 1
  quantitySigns.set(taskContent, signs)
  if (!String(row.productCode ?? '').trim()) increment(missingJanByTask, taskContent)
  if (!['販売', '注文'].includes(taskContent)) {
    const dates = exceptionalTaskDates.get(taskContent) ?? new Set()
    dates.add(String(row.taskDateTime ?? '').slice(0, 10))
    exceptionalTaskDates.set(taskContent, dates)
  }
  increment(exactRows, JSON.stringify(row))
  for (const key of Object.keys(row)) {
    if (!expectedKeys.has(key)) extraKeys.add(key)
    if (/(^|_)(transaction|receipt|event)?_?id$/i.test(key)) stableIdKeys.add(key)
  }
}

const result = {
  store: requestedStore,
  startDate,
  endDate,
  httpStatus: response.status,
  success: data.success,
  historySuccess: data.history?.success,
  count: rows.length,
  taskTypes: Object.fromEntries([...taskTypes.entries()].sort(([left], [right]) => left.localeCompare(right))),
  quantitySigns: Object.fromEntries([...quantitySigns.entries()].sort(([left], [right]) => left.localeCompare(right))),
  missingJanByTask: Object.fromEntries([...missingJanByTask.entries()].sort(([left], [right]) => left.localeCompare(right))),
  exceptionalTaskDates: Object.fromEntries(
    [...exceptionalTaskDates.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([taskContent, dates]) => [taskContent, [...dates].sort()]),
  ),
  missingJanSalesOrReturns: rows.filter(
    (row) => ['販売', '返品'].includes(row.taskContent) && !String(row.productCode ?? '').trim(),
  ).length,
  exactDuplicateGroups: [...exactRows.values()].filter((count) => count > 1).length,
  exactDuplicateExtraRows: [...exactRows.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  ),
  minutePrecisionRows: rows.filter(
    (row) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(String(row.taskDateTime ?? '')),
  ).length,
  rowsWithSeconds: rows.filter(
    (row) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.taskDateTime ?? '')),
  ).length,
  extraContractKeys: [...extraKeys].sort(),
  stableIdKeys: [...stableIdKeys].sort(),
  rowDataPrinted: false,
  logsPrinted: false,
  message: data.message || data.history?.message || '',
}

console.log(JSON.stringify(result, null, 2))
if (!response.ok || data.success === false || data.history?.success === false) {
  process.exitCode = 1
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const envArgument = process.argv.find((argument) => argument.startsWith('--env-file='))
const envPath = envArgument
  ? path.resolve(envArgument.slice('--env-file='.length))
  : path.join(projectRoot, 'next_app', '.env.local')

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

const env = readEnvFile(envPath)
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) {
  throw new Error('next_app/.env.local にSupabaseのURLまたはanon keyがありません。')
}

const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

async function fetchAll(table, select) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`/rest/v1/${table}`, supabaseUrl)
    url.searchParams.set('select', select)
    url.searchParams.set('limit', '1000')
    url.searchParams.set('offset', String(offset))
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`${table} audit failed: ${response.status} ${responseText.slice(0, 300)}`)
    }
    const page = JSON.parse(responseText || '[]')
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function normalizeDigits(value) {
  return String(value ?? '')
    .trim()
    .replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .replace(/\.0$/, '')
}

function leadingZeroComparisonKey(janCode) {
  const normalized = normalizeDigits(janCode)
  return normalized.length === 13 && normalized.startsWith('0') ? normalized.slice(1) : normalized
}

function summarizeProducts(products) {
  const stores = new Map()
  const exactKeys = new Map()
  const janLengths = new Map()
  const normalizedKeys = new Map()
  const janStores = new Map()

  for (const product of products) {
    const storeKey = String(product.store_id)
    const store = stores.get(storeKey) ?? {
      total: 0,
      active: 0,
      inactive: 0,
      missingJan: 0,
      withCategory: 0,
      withSupplier: 0,
    }
    store.total += 1
    store.active += product.is_active ? 1 : 0
    store.inactive += product.is_active ? 0 : 1
    const storedJanCode = String(product.jan_code ?? '').trim()
    store.missingJan += storedJanCode ? 0 : 1
    store.withCategory += product.category ? 1 : 0
    store.withSupplier += product.supplier_name ? 1 : 0
    stores.set(storeKey, store)

    if (storedJanCode) increment(exactKeys, `${product.store_id}:${storedJanCode}`)
    const janCode = normalizeDigits(storedJanCode)
    if (!janCode) continue
    increment(janLengths, String(janCode.length))

    const comparisonKey = `${product.store_id}:${leadingZeroComparisonKey(janCode)}`
    const normalizedRows = normalizedKeys.get(comparisonKey) ?? new Set()
    normalizedRows.add(janCode)
    normalizedKeys.set(comparisonKey, normalizedRows)

    const janStoreSet = janStores.get(janCode) ?? new Set()
    janStoreSet.add(product.store_id)
    janStores.set(janCode, janStoreSet)
  }

  return {
    total: products.length,
    stores: mapToObject(stores),
    duplicateStoreJanKeys: [...exactKeys.values()].filter((count) => count > 1).length,
    invalidStoreIds: products.filter((product) => ![6, 7].includes(product.store_id)).length,
    janLengths: mapToObject(janLengths),
    unexpectedJanLengths: [...janLengths.entries()]
      .filter(([length]) => !['8', '12', '13'].includes(length))
      .reduce((total, [, count]) => total + count, 0),
    leadingZeroConflictGroups: [...normalizedKeys.values()]
      .filter((exactCodes) => exactCodes.size > 1).length,
    sharedJanAcrossStores: [...janStores.values()]
      .filter((storeIds) => storeIds.has(6) && storeIds.has(7)).length,
  }
}

function summarizeHistory(cacheRows) {
  const expectedKeys = [
    'cost',
    'productCode',
    'productName',
    'quantity',
    'storeName',
    'taskContent',
    'taskDateTime',
    'totalCost',
  ]
  const expectedKeySet = new Set(expectedKeys)

  return cacheRows.map((cacheRow) => {
    const rows = Array.isArray(cacheRow.history_rows) ? cacheRow.history_rows : []
    const posRows = rows.filter(
      (row) => !['店舗間移動', '物品使用'].includes(row.taskContent),
    )
    const taskTypes = new Map()
    const exactRows = new Map()
    const extraKeys = new Set()
    const stableIdKeys = new Set()

    for (const row of posRows) {
      increment(taskTypes, String(row.taskContent || '(empty)'))
      increment(exactRows, JSON.stringify(row))
      for (const key of Object.keys(row)) {
        if (!expectedKeySet.has(key)) extraKeys.add(key)
        if (/(^|_)(transaction|receipt|event)?_?id$/i.test(key)) stableIdKeys.add(key)
      }
    }

    return {
      storeId: cacheRow.store_id,
      startDate: cacheRow.start_date,
      endDate: cacheRow.end_date,
      itemCount: cacheRow.item_count,
      actualRows: rows.length,
      gasCount: cacheRow.gas_count,
      transferCount: cacheRow.transfer_count,
      identifiedPosRows: posRows.length,
      taskTypes: mapToObject(taskTypes),
      missingJanSalesOrReturns: posRows.filter(
        (row) => ['販売', '返品'].includes(row.taskContent) && !String(row.productCode ?? '').trim(),
      ).length,
      exactDuplicateGroups: [...exactRows.values()].filter((count) => count > 1).length,
      exactDuplicateExtraRows: [...exactRows.values()].reduce(
        (total, count) => total + Math.max(0, count - 1),
        0,
      ),
      minutePrecisionRows: posRows.filter(
        (row) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(String(row.taskDateTime ?? '')),
      ).length,
      rowsWithSeconds: posRows.filter(
        (row) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.taskDateTime ?? '')),
      ).length,
      extraContractKeys: [...extraKeys].sort(),
      stableIdKeys: [...stableIdKeys].sort(),
    }
  }).sort((left, right) => left.storeId - right.storeId)
}

function summarizeTransfers(transfers) {
  const entryTypes = new Map()
  const routes = new Map()
  const ids = new Map()

  for (const transfer of transfers) {
    increment(entryTypes, String(transfer.entry_type || '(empty)'))
    increment(routes, `${transfer.from_store_id}->${transfer.to_store_id ?? 'null'}`)
    increment(ids, String(transfer.id))
  }

  return {
    total: transfers.length,
    entryTypes: mapToObject(entryTypes),
    routes: mapToObject(routes),
    duplicateIds: [...ids.values()].filter((count) => count > 1).length,
    missingIds: transfers.filter((transfer) => transfer.id === null || transfer.id === undefined).length,
    missingJan: transfers.filter((transfer) => !String(transfer.jan_code ?? '').trim()).length,
    nonPositiveQuantity: transfers.filter((transfer) => Number(transfer.quantity) <= 0).length,
    invalidUsageDestination: transfers.filter(
      (transfer) => transfer.entry_type === 'usage' && transfer.to_store_id !== null,
    ).length,
  }
}

const [products, cacheRows, transfers] = await Promise.all([
  fetchAll('products', 'id,store_id,jan_code,is_active,category,supplier_name'),
  fetchAll(
    'realtime_history_cache',
    'store_id,start_date,end_date,item_count,gas_count,transfer_count,history_rows,fetched_at',
  ),
  fetchAll('transfers', 'id,from_store_id,to_store_id,jan_code,quantity,entry_type,created_at'),
])

const report = {
  auditedAt: new Date().toISOString(),
  access: {
    credential: 'anon',
    operations: ['read products', 'read realtime_history_cache', 'read transfers'],
    writesPerformed: false,
  },
  products: summarizeProducts(products),
  history: summarizeHistory(cacheRows),
  transfers: summarizeTransfers(transfers),
}

console.log(JSON.stringify(report, null, 2))

const fatalProblems = [
  report.products.duplicateStoreJanKeys,
  report.products.invalidStoreIds,
  ...report.history.map((row) => row.itemCount === row.actualRows ? 0 : 1),
  report.transfers.duplicateIds,
  report.transfers.missingIds,
]
if (fatalProblems.some(Boolean)) process.exitCode = 1

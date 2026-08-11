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
const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

async function fetchAll(table, select) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`/rest/v1/${table}`, supabaseUrl)
    url.searchParams.set('select', select)
    url.searchParams.set('limit', '1000')
    url.searchParams.set('offset', String(offset))
    const response = await fetch(url, { headers })
    const text = await response.text()
    if (!response.ok) throw new Error(`${table} audit failed: ${response.status} ${text.slice(0, 300)}`)
    const page = JSON.parse(text || '[]')
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

const [products, aliases, orders] = await Promise.all([
  fetchAll('products', 'id,store_id,jan_code,product_name,cost_price,selling_price,is_active,tags'),
  fetchAll('product_aliases', 'id,product_id,store_id'),
  fetchAll('customer_orders', 'id,product_id,store_id'),
])

const productById = new Map(products.map((product) => [product.id, product]))
const keys = new Map()
for (const product of products) {
  const key = `${product.store_id}:${product.jan_code}`
  keys.set(key, (keys.get(key) ?? 0) + 1)
}

const byJan = new Map()
for (const product of products.filter((row) => row.jan_code)) {
  const rows = byJan.get(product.jan_code) ?? []
  rows.push(product)
  byJan.set(product.jan_code, rows)
}
const sharedPairs = [...byJan.values()].filter(
  (rows) => rows.some((row) => row.store_id === 7) && rows.some((row) => row.store_id === 6),
)
const differentDetails = sharedPairs.filter((rows) => {
  const main = rows.find((row) => row.store_id === 7)
  const wanwan = rows.find((row) => row.store_id === 6)
  return main && wanwan && (
    main.product_name !== wanwan.product_name ||
    main.cost_price !== wanwan.cost_price ||
    main.selling_price !== wanwan.selling_price
  )
})

const wanwanNamePattern = /[\(（]\s*[wｗ]\s*[\)）]/i
const inactiveWanwanRowsInMain = products.filter(
  (row) => row.store_id === 7 && !row.is_active && wanwanNamePattern.test(row.product_name || ''),
)
const inactiveWanwanIdsInMain = new Set(inactiveWanwanRowsInMain.map((row) => row.id))
const wanwanJanCodes = new Set(
  products.filter((row) => row.store_id === 6).map((row) => row.jan_code),
)

const result = {
  totalProducts: products.length,
  activeMain: products.filter((row) => row.store_id === 7 && row.is_active).length,
  activeWanwan: products.filter((row) => row.store_id === 6 && row.is_active).length,
  duplicateStoreJanKeys: [...keys.values()].filter((count) => count > 1).length,
  invalidStoreIds: products.filter((row) => row.store_id !== 6 && row.store_id !== 7).length,
  tagStoreMismatches: products.filter(
    (row) => (row.store_id === 7 && row.tags !== '本店') || (row.store_id === 6 && row.tags !== 'わんわん'),
  ).length,
  sharedJanPairs: sharedPairs.length,
  sharedJanPairsWithDifferentDetails: differentDetails.length,
  aliasStoreMismatches: aliases.filter(
    (alias) => productById.get(alias.product_id)?.store_id !== alias.store_id,
  ).length,
  orderStoreMismatches: orders.filter(
    (order) => order.product_id && order.store_id && productById.get(order.product_id)?.store_id !== order.store_id,
  ).length,
  inactiveWanwanRowsInMain: inactiveWanwanRowsInMain.length,
  inactiveWanwanRowsWithJanConflict: inactiveWanwanRowsInMain.filter(
    (row) => wanwanJanCodes.has(row.jan_code),
  ).length,
  inactiveWanwanRowsWithAliasReferences: aliases.filter(
    (alias) => inactiveWanwanIdsInMain.has(alias.product_id),
  ).length,
  inactiveWanwanRowsWithOrderReferences: orders.filter(
    (order) => inactiveWanwanIdsInMain.has(order.product_id),
  ).length,
}

console.log(JSON.stringify(result, null, 2))

if (
  result.duplicateStoreJanKeys ||
  result.invalidStoreIds ||
  result.tagStoreMismatches ||
  result.aliasStoreMismatches ||
  result.orderStoreMismatches
) {
  process.exitCode = 1
}

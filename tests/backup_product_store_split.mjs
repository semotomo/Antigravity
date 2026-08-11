import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const envPath = path.join(projectRoot, 'next_app', '.env.local')
const envLines = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)

function readEnvValue(...names) {
  for (const name of names) {
    const line = envLines.find((candidate) => candidate.startsWith(`${name}=`))
    if (line) return line.slice(line.indexOf('=') + 1).trim()
  }
  throw new Error(`next_app/.env.local に ${names.join(' または ')} がありません。`)
}

const supabaseUrl = readEnvValue('NEXT_PUBLIC_SUPABASE_URL')
const supabaseKey = readEnvValue(
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
)
const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

async function fetchAll(table, select) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`/rest/v1/${table}`, supabaseUrl)
    url.searchParams.set('select', select)
    url.searchParams.set('limit', '1000')
    url.searchParams.set('offset', String(offset))
    const response = await fetch(url, { headers })
    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`${table} backup failed: ${response.status} ${responseText.slice(0, 300)}`)
    }
    const page = JSON.parse(responseText || '[]')
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

const [products, aliases, orders] = await Promise.all([
  fetchAll('products', '*'),
  fetchAll('product_aliases', '*'),
  fetchAll('customer_orders', '*'),
])

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputPath = path.join(projectRoot, 'local_exports', `product-store-split-${timestamp}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(
  outputPath,
  JSON.stringify({ exportedAt: new Date().toISOString(), products, aliases, orders }, null, 2),
  'utf8',
)

console.log(JSON.stringify({ outputPath, products: products.length, aliases: aliases.length, orders: orders.length }))

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(testDir, '..', 'next_app', '.env.local')
const envLines = fs.readFileSync(envPath, 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)

function readEnvValue(name) {
  const line = envLines.find((candidate) => candidate.startsWith(`${name}=`))
  if (!line) throw new Error(`next_app/.env.local に ${name} がありません。`)
  return line.slice(line.indexOf('=') + 1).trim()
}

const supabaseUrl = readEnvValue('NEXT_PUBLIC_SUPABASE_URL')
const supabaseKey = readEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
}

const products = []
for (let offset = 0; ; offset += 1000) {
  const url = new URL('/rest/v1/products', supabaseUrl)
  url.searchParams.set('select', 'jan_code,tags,is_active')
  url.searchParams.set('limit', '1000')
  url.searchParams.set('offset', String(offset))
  const response = await fetch(url, { headers })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`商品監査GET失敗: ${response.status} ${responseText.slice(0, 300)}`)
  }
  const page = JSON.parse(responseText || '[]')
  products.push(...page)
  if (page.length < 1000) break
}

function storeTags(product) {
  return (product.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

const activeProducts = products.filter((product) => product.is_active)
const honten = activeProducts.filter((product) => storeTags(product).includes('本店'))
const wanwan = activeProducts.filter((product) => storeTags(product).includes('わんわん'))
const both = activeProducts.filter((product) => {
  const tags = storeTags(product)
  return tags.includes('本店') && tags.includes('わんわん')
})

console.log(JSON.stringify({
  totalRows: products.length,
  activeRows: activeProducts.length,
  inactiveRows: products.length - activeProducts.length,
  hontenMemberships: honten.length,
  wanwanMemberships: wanwan.length,
  bothMemberships: both.length,
  exactHontenTags: activeProducts.filter((product) => product.tags === '本店').length,
  exactWanwanTags: activeProducts.filter((product) => product.tags === 'わんわん').length,
  untaggedActiveRows: activeProducts.filter((product) => storeTags(product).length === 0).length,
}, null, 2))

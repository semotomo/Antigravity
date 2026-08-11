import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('DB移行は商品を店舗IDとJANの複合キーで分離する', () => {
  const migration = source('supabase/migrations/20260811193000_split_products_by_store.sql')

  assert.match(migration, /UNIQUE \(store_id, jan_code\)/)
  assert.match(migration, /'わんわん',\s*6/)
  assert.match(migration, /FOREIGN KEY \(product_id, store_id\)/)
  assert.match(migration, /alias_row\.store_id = source_row\.store_id/)
  assert.match(migration, /product_row\.store_id = source_row\.store_id/)
})

test('商品検索と手動CSV取込はタグではなく店舗IDを使う', () => {
  const searchRoute = source('next_app/app/api/products/search/route.ts')
  const productActions = source('next_app/app/actions/products.ts')

  assert.match(searchRoute, /queryBuilder = queryBuilder\.eq\('store_id', productStoreId\)/)
  assert.doesNotMatch(searchRoute, /tags\.ilike/)
  assert.match(productActions, /onConflict: 'store_id,jan_code'/)
  assert.match(productActions, /\.eq\('store_id', store\.id\)/)
})

test('店舗間移動の商品検索は移動元店舗IDを必須にする', () => {
  const transferQueries = source('next_app/lib/queries/transfers.ts')
  const transferForm = source('next_app/components/transfers/TransferFormModal.tsx')

  assert.match(transferQueries, /searchProductByJan\(\s*janCode: string,\s*storeId: number/)
  assert.match(transferQueries, /\.eq\('store_id', storeId\)/)
  assert.match(
    transferForm,
    /lookupTransferProductByJanAction\(janCode, selectedFromStoreId \?\? 0\)/,
  )
})

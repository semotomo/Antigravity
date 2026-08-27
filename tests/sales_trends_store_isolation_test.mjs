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

test('売上推移APIは店舗IDを必須化しDB権限を確認してから店舗で絞り込む', () => {
  const route = source('next_app/app/api/sales/trends/route.ts')

  assert.match(route, /searchParams\.get\('storeId'\)/)
  assert.match(route, /storeId !== 6 && storeId !== 7/)
  assert.match(route, /await requireInventoryStoreAccess\(supabase, storeId\)/)
  assert.match(route, /\.eq\('store_id', storeId\)/)
  assert.match(route, /error instanceof InventoryAccessError/)
  assert.doesNotMatch(route, /storeId\s*\|\|\s*[67]/)
})

test('正当な同一店舗リクエストは従来どおり期間とJANで推移を集計する', () => {
  const route = source('next_app/app/api/sales/trends/route.ts')

  assert.match(route, /\.gte\('sale_date', dateLimitStr\)/)
  assert.match(route, /\.lte\('sale_date', dateEndStr\)/)
  assert.match(route, /query = query\.eq\('jan_code', janCode\)/)
  assert.match(route, /quantity: current\.quantity \+ \(row\.quantity \|\| 0\)/)
  assert.match(route, /amount: current\.amount \+ \(row\.sales_amount \|\| 0\)/)
})

test('売上推移モーダルは選択行の店舗IDをAPIへ必ず渡す', () => {
  const modal = source('next_app/components/sales/ProductSalesTrendsModal.tsx')
  const salesList = source('next_app/components/sales/SalesListView.tsx')

  assert.match(modal, /storeId: 6 \| 7/)
  assert.match(modal, /url\.searchParams\.set\('storeId', String\(storeId\)\)/)
  assert.match(salesList, /storeId: item\.store_id/)
  assert.match(salesList, /storeId=\{selectedProduct\.storeId/)
})

test('ABC分析も店舗単位で行を分けて選択店舗IDを売上推移へ渡す', () => {
  const abcQuery = source('next_app/lib/queries/abc.ts')
  const abcView = source('next_app/components/sales/AbcAnalysisView.tsx')

  assert.match(abcQuery, /storeId: 6 \| 7/)
  assert.match(abcQuery, /row\.store_id/)
  assert.match(abcView, /storeId: item\.storeId/)
  assert.match(abcView, /storeId=\{selectedProduct\.storeId/)
})

test('追加migrationは既存列順を保ったままsales_enriched_vへstore_idを公開する', () => {
  const migration = source(
    'supabase/migrations/20260827200000_add_store_id_to_sales_enriched_view.sql',
  )
  const databaseTypes = source('next_app/lib/types/database.ts')

  assert.match(migration, /CREATE OR REPLACE VIEW public\.sales_enriched_v AS/)
  assert.match(migration, /matched_row\.created_at,\s*matched_row\.store_id/)
  assert.match(migration, /CREATE OR REPLACE VIEW public\.sales_product_summary_v AS/)
  assert.match(migration, /GROUP BY[\s\S]*?store_id;/)
  assert.match(databaseTypes, /sales_enriched_v:[\s\S]*?store_id: 6 \| 7/)
  assert.match(databaseTypes, /sales_product_summary_v:[\s\S]*?store_id: 6 \| 7/)
})

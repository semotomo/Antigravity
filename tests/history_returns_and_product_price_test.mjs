import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const historyModule = await import('../next_app/lib/realtimeHistory.ts')
const productsModule = await import('../next_app/lib/products.ts')

function historyRow(overrides = {}) {
  return {
    productCode: '4900000000001',
    productName: 'テスト商品',
    taskContent: '販売',
    storeName: '本店',
    taskDateTime: '2026/08/23 10:00',
    quantity: 1,
    cost: 500,
    totalCost: 500,
    ...overrides,
  }
}

test('販売2個と返品1個を販売1個へ相殺する', () => {
  const rows = historyModule.netHistorySalesAndReturns([
    historyRow({ quantity: 2, totalCost: 1000 }),
    historyRow({
      taskContent: '返品',
      taskDateTime: '2026/08/23 11:00',
      quantity: 1,
      totalCost: 500,
    }),
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].taskContent, '販売')
  assert.equal(rows[0].quantity, 1)
  assert.equal(rows[0].totalCost, 500)
  assert.equal(rows[0].taskDateTime, '2026/08/23 11:00')
})

test('返品相殺後の数量が0以下なら販売と返品を表示しない', () => {
  for (const returnQuantity of [1, 2]) {
    const rows = historyModule.netHistorySalesAndReturns([
      historyRow(),
      historyRow({ taskContent: '返品', quantity: returnQuantity }),
    ])

    assert.deepEqual(rows, [])
  }
})

test('返品のない販売とその他の作業内容は変更しない', () => {
  const sale = historyRow()
  const order = historyRow({ taskContent: '注文', quantity: 3, totalCost: 1500 })
  const rows = historyModule.netHistorySalesAndReturns([sale, order])

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.find((row) => row.taskContent === '販売'), sale)
  assert.deepEqual(rows.find((row) => row.taskContent === '注文'), order)
})

test('税込価格は売価に10パーセントの切り捨て税額を加算する', () => {
  assert.equal(productsModule.calculateTaxIncludedPrice(980), 1078)
  assert.equal(productsModule.calculateTaxIncludedPrice(99), 108)
  assert.equal(productsModule.calculateTaxIncludedPrice(null), 0)
})

test('商品一覧は価格を仕入れ先の左に表示し、粗利率を表示しない', () => {
  const board = fs.readFileSync(
    path.join(projectRoot, 'next_app/components/products/ProductsBoard.tsx'),
    'utf8',
  )
  const pricingColumn = board.indexOf("key: 'pricing'")
  const supplierColumn = board.indexOf("key: 'supplier_name'")

  assert.ok(pricingColumn >= 0)
  assert.ok(supplierColumn >= 0)
  assert.ok(pricingColumn < supplierColumn)
  assert.match(board, /税込/)
  assert.doesNotMatch(board, /粗利率|formatProductMarkupRate/)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('印刷画面は簡潔な記入用タイトルを使い、不要な仕入れ先・棚番号列を表示しない', () => {
  const printPage = source('next_app/app/inventory/print/page.tsx')
  const printStyles = source('next_app/app/inventory/print/print.css')

  assert.match(printPage, /棚卸し記入用リスト/)
  assert.doesNotMatch(printPage, /数量を隠した記入用リスト/)
  assert.doesNotMatch(printPage, /<th>仕入れ先<\/th>/)
  assert.doesNotMatch(printPage, /<th className="shelf">棚番号<\/th>/)
  assert.doesNotMatch(printPage, /item\.supplierName/)
  assert.doesNotMatch(printPage, /item\.shelfCode/)
  assert.doesNotMatch(printPage, /\['supplier'|\['shelf'/)
  assert.match(printPage, /className="category">カテゴリ/)
  assert.match(printStyles, /\.print-page \.category\s*\{[^}]*width:\s*96px/i)
})

test('印刷ツールバーは現在の店舗・棚卸し・表示条件を引き継ぐCSV出力を提供する', () => {
  const printPage = source('next_app/app/inventory/print/page.tsx')
  const toolbar = source('next_app/app/inventory/print/PrintToolbar.tsx')

  assert.match(printPage, /csvHref\s*=\s*.*api\/inventory\/export/i)
  assert.match(printPage, /<PrintToolbar csvHref=\{csvHref\}/)
  assert.match(toolbar, /CSVで出力/)
  assert.match(toolbar, /href=\{csvHref\}/)
})

test('CSV APIは店舗認証後の印刷データだけをUTF-8添付で返す', () => {
  const route = source('next_app/app/api/inventory/export/route.ts')

  assert.match(route, /requireInventoryStoreAccess\(supabase, storeId\)/)
  assert.match(route, /getInventoryPrintData\(supabase/)
  assert.match(route, /text\/csv; charset=utf-8/i)
  assert.match(route, /Content-Disposition/)
  assert.match(route, /private, no-store/)
})

test('CSVはBOM・CRLF・引用符・改行・数式注入を処理し、仕入れ先と棚番号を含めない', async () => {
  const moduleUrl = pathToFileURL(path.join(projectRoot, 'next_app/lib/inventory/csv.ts')).href
  const { buildInventoryCsv } = await import(moduleUrl)
  const data = {
    storeId: 6,
    sessionId: 'session-1',
    status: 'draft',
    startedAt: '2026-08-24T01:00:00.000Z',
    finalizedAt: null,
    mode: 'blank',
    sort: 'category',
    items: [{
      janCode: '4901234567890',
      productName: '=危険,商品',
      category: '犬用品\nフード',
      supplierName: '出力しない仕入先',
      shelfCode: 'A-1',
      isActive: false,
      excluded: true,
      countedQuantity: 8,
      countedAt: '2026-08-24T01:10:00.000Z',
      physicalQuantity: null,
      salesQuantity: null,
      returnQuantity: null,
      transferInQuantity: null,
      transferOutQuantity: null,
      usageQuantity: null,
      adjustmentDelta: null,
      calculatedQuantity: null,
      calculatedAsOf: null,
      isLargeAdjustment: false,
    }],
  }
  const csv = buildInventoryCsv(data, 'わんわん')

  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /\r\n/)
  assert.match(csv, /"'=危険,商品"/)
  assert.match(csv, /"犬用品\nフード"/)
  assert.match(csv, /商品状態,棚卸し状態,数量/)
  assert.doesNotMatch(csv, /出力しない仕入先|A-1|仕入れ先|棚番号/)
  assert.match(csv, /,停止,除外,\r\n$/)

  const inputCsv = buildInventoryCsv({ ...data, mode: 'result' }, 'わんわん')
  assert.match(inputCsv, /商品状態,棚卸し状態,入力数量/)
  assert.match(inputCsv, /,停止,除外,8\r\n$/)

  const calculatedCsv = buildInventoryCsv({
    ...data,
    mode: 'result',
    status: 'finalized',
    items: data.items.map((item) => ({
      ...item,
      adjustmentDelta: -1,
      calculatedQuantity: 2,
      physicalQuantity: 10,
      returnQuantity: 1,
      salesQuantity: 2,
      transferInQuantity: 3,
      transferOutQuantity: 4,
      usageQuantity: 5,
    })),
  }, 'わんわん')
  assert.match(calculatedCsv, /実在庫,販売,返品,移動入,移動出,物品使用,手動調整,現在庫/)
  assert.match(calculatedCsv, /,10,2,1,3,4,5,-1,2\r\n$/)
})

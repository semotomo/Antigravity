import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const fixture = JSON.parse(
  fs.readFileSync(path.join(testDir, 'fixtures', 'gas_history_response_current.json'), 'utf8'),
)
const autoDownloadSource = fs.readFileSync(
  path.join(projectRoot, 'gas', 'autoDownload.js'),
  'utf8',
)

const currentRowKeys = [
  'cost',
  'productCode',
  'productName',
  'quantity',
  'storeName',
  'taskContent',
  'taskDateTime',
  'totalCost',
]

function createGasContext(scriptProperties = {}) {
  const context = vm.createContext({
    console,
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: (name) => scriptProperties[name] ?? '' }
      },
    },
    Utilities: {
      parseCsv(csvText) {
        return csvText.trimEnd().split(/\r?\n/).map((line) => line.split(','))
      },
      sleep() {},
    },
  })
  vm.runInContext(autoDownloadSource, context, { filename: 'autoDownload.js' })
  return context
}

test('現行履歴fixtureは8項目契約と分単位時刻を固定する', () => {
  const rows = fixture.history.data

  assert.equal(fixture.history.count, rows.length)
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), currentRowKeys)
    assert.match(row.taskDateTime, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
  }
  assert.equal(rows.some((row) => row.productCode === '' && row.taskContent === '販売'), true)
  assert.equal(rows.some((row) => row.taskContent === '返品'), true)
  assert.equal(rows.some((row) => row.taskContent === '注文'), true)
  assert.equal(rows.some((row) => row.taskContent === '調整'), true)
})

test('現行履歴fixtureには安定取引IDがなく、同内容行を保持する', () => {
  const rows = fixture.history.data
  const serializedCounts = new Map()

  for (const row of rows) {
    const serialized = JSON.stringify(row)
    serializedCounts.set(serialized, (serializedCounts.get(serialized) ?? 0) + 1)
  }

  assert.equal(
    rows.some((row) => Object.keys(row).some((key) => /(^|_)(transaction|receipt|event)?_?id$/i.test(key))),
    false,
  )
  assert.equal([...serializedCounts.values()].some((count) => count > 1), true)
})

test('GASヘッダー診断は行データを返さずID候補だけを報告する', () => {
  const context = createGasContext()
  const csvText = [
    '\uFEFF商品コード,商品名,処理内容,店舗名,処理日時,数量,原価,合計,取引ID',
    '4900000000001,secret-product,販売,secret-store,2026/08/22 10:15,1,100,100,T-001',
  ].join('\n')

  const result = context.parseSalesHistoryCsv_(csvText, { schemaOnly: true })
  const plainResult = JSON.parse(JSON.stringify(result))

  assert.equal(plainResult.success, true)
  assert.deepEqual(plainResult.data, [])
  assert.equal(plainResult.count, 0)
  assert.equal(plainResult.schema.headerDetected, true)
  assert.deepEqual(plainResult.schema.stableTransactionIdCandidateHeaders, ['取引ID'])
  assert.equal(plainResult.schema.stableTransactionIdVerified, false)
  assert.equal(JSON.stringify(plainResult).includes('secret-product'), false)
  assert.equal(JSON.stringify(plainResult).includes('T-001'), false)
})

test('GASヘッダー診断は専用Script Propertyトークンを必須にする', () => {
  const context = createGasContext({ HISTORY_SCHEMA_DIAGNOSTIC_TOKEN: 'fixture-secret' })

  assert.equal(context.isHistorySchemaDiagnosticAuthorized_(''), false)
  assert.equal(context.isHistorySchemaDiagnosticAuthorized_('wrong-secret'), false)
  assert.equal(context.isHistorySchemaDiagnosticAuthorized_('fixture-secret'), true)
  assert.equal(createGasContext().isHistorySchemaDiagnosticAuthorized_('fixture-secret'), false)
})

test('通常のGAS履歴パースは従来の8項目と数値変換を維持する', () => {
  const context = createGasContext()
  const csvText = [
    '商品コード,商品名,処理内容,店舗名,処理日時,数量,原価,合計',
    '4900000000001,fixture-product,返品,fixture-store,2026/08/22 10:18,2,100,200',
  ].join('\n')

  const result = JSON.parse(JSON.stringify(context.parseSalesHistoryCsv_(csvText)))

  assert.deepEqual(result, {
    success: true,
    data: [{
      productCode: '4900000000001',
      productName: 'fixture-product',
      taskContent: '返品',
      storeName: 'fixture-store',
      taskDateTime: '2026/08/22 10:18',
      quantity: 2,
      cost: 100,
      totalCost: 200,
    }],
    count: 1,
  })
})

test('GASヘッダー診断はヘッダーなしCSVの先頭行を外部へ露出しない', () => {
  const context = createGasContext()
  const result = context.parseSalesHistoryCsv_(
    '4900000000001,secret-product,販売,secret-store,2026/08/22 10:15,1,100,100',
    { schemaOnly: true },
  )
  const plainResult = JSON.parse(JSON.stringify(result))

  assert.equal(plainResult.schema.headerDetected, false)
  assert.deepEqual(plainResult.schema.headers, [])
  assert.equal(plainResult.schema.columnCount, 8)
  assert.equal(JSON.stringify(plainResult).includes('secret-product'), false)
})

test('Web Appのhistory_schemaモードはログを返さない契約になっている', () => {
  const historyDownloadSource = autoDownloadSource.slice(
    autoDownloadSource.indexOf('function downloadSalesHistoryFromPOS_'),
    autoDownloadSource.indexOf('// 【Web App】外部から HTTP GET'),
  )

  assert.match(autoDownloadSource, /mode === 'history_schema'/)
  assert.match(autoDownloadSource, /HISTORY_SCHEMA_DIAGNOSTIC_TOKEN/)
  assert.match(autoDownloadSource, /履歴スキーマ診断は認証付きPOSTだけを許可しています/)
  assert.match(
    autoDownloadSource,
    /results\.logs = results\.mode === 'history_schema' \? '' : Logger\.getLog\(\)/,
  )
  assert.doesNotMatch(historyDownloadSource, /csvText\.slice\(/)
  assert.doesNotMatch(historyDownloadSource, /JSON\.stringify\(lines\[0\]\)/)
})

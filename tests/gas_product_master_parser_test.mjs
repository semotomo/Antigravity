import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const importCsvSource = fs.readFileSync(path.join(projectRoot, 'gas', 'importCSV.js'), 'utf8')
const autoDownloadSource = fs.readFileSync(path.join(projectRoot, 'gas', 'autoDownload.js'), 'utf8')

function createGasContext() {
  const context = vm.createContext({
    console,
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: () => '' }
      },
    },
    Utilities: {
      parseCsv(csvText) {
        return csvText.trimEnd().split(/\r?\n/).map((line) => line.split(','))
      },
      sleep() {},
    },
  })
  vm.runInContext(importCsvSource, context, { filename: 'importCSV.js' })
  vm.runInContext(autoDownloadSource, context, { filename: 'autoDownload.js' })
  return context
}

test('商品マスタ診断は各列のJAN形式件数を集計できる', () => {
  const context = createGasContext()
  const csvText = [
    '11053,からつケンネル本店,1,,721420832,犬フード,商品A,００１００００１,100,2,,50',
    '11053,からつケンネル本店,1,,721420832,犬フード,商品A重複,00100001,100,2,,50',
    '11053,からつケンネル本店,1,,721420833,猫フード,商品B,4901234567890.0,200,2,,80',
  ].join('\n')
  const blob = { getDataAsString: () => csvText }

  const result = context.inspectProductMasterCSV_(blob)

  assert.equal(result.rawRowCount, 3)
  assert.equal(result.validRowCount, 0)
  assert.equal(result.columnStats[7].nonEmptyCount, 3)
  assert.equal(result.columnStats[7].uniqueCount, 2)
  assert.equal(result.columnStats[7].janLikeCount, 3)
  assert.equal(context.normalizeProductMasterJanCode_('００１００００１'), '00100001')
  assert.equal(context.normalizeProductMasterJanCode_('4901234567890.0'), '4901234567890')
  assert.deepEqual(JSON.parse(JSON.stringify(result.storeSummary)), [
    { storeCode: '11053', storeName: 'からつケンネル本店', rowCount: 3 },
  ])
  assert.equal(context.isExpectedProductMasterStore_(result.storeSummary, '本店'), true)
  assert.equal(context.isExpectedProductMasterStore_(result.storeSummary, 'わんわん'), false)
})

test('商品マスタ同期は検証済み店舗タグを使い、成功後だけ旧商品を無効化する', () => {
  const context = createGasContext()
  const events = []
  context.upsertProductMasterToSupabase_ = (records, syncStartedAt, storeTag) => {
    events.push({ type: 'upsert', records: structuredClone(records), syncStartedAt, storeTag })
  }
  context.reconcileStaleProductStoreMembership_ = (storeTag, syncStartedAt) => {
    events.push({ type: 'reconcile', storeTag, syncStartedAt })
  }
  const csvText = [
    '11053,からつケンネル本店,2,４９０１２３４５６７８９０,721420835,犬フード,商品(w),,2100,1,,1260',
    '11053,からつケンネル本店,2,4901234567891,721420835,犬フード,商品B,,1800,1,,990',
  ].join('\n')

  const result = context.processProductMasterCSV_({ getDataAsString: () => csvText }, '本店')

  assert.equal(result.success, true)
  assert.equal(result.count, 2)
  assert.equal(events[0].type, 'upsert')
  assert.equal(events[0].records[0].jan_code, '4901234567890')
  assert.equal(events[0].records[0].store_id, 7)
  assert.equal(events[0].records[0].tags, '本店')
  assert.equal(events[0].storeTag, '本店')
  assert.equal(events[1].type, 'reconcile')
  assert.equal(events[1].storeTag, '本店')
  assert.equal(events[1].syncStartedAt, events[0].syncStartedAt)
})

test('商品マスタUPSERT失敗時は旧商品を無効化しない', () => {
  const context = createGasContext()
  let reconciled = false
  context.upsertProductMasterToSupabase_ = () => {
    throw new Error('upsert failed')
  }
  context.reconcileStaleProductStoreMembership_ = () => {
    reconciled = true
  }
  const csvText = '11054,わんわんペットセンター,2,4901234567890,721421579,その他(w),商品A,,100,1,,50'

  assert.throws(
    () => context.processProductMasterCSV_({ getDataAsString: () => csvText }, 'わんわん'),
    /upsert failed/,
  )
  assert.equal(reconciled, false)
})

test('商品マスタ同期は店舗タグを固定の店舗IDへ変換する', () => {
  const context = createGasContext()

  assert.equal(context.getProductStoreId_('本店'), 7)
  assert.equal(context.getProductStoreId_('わんわん'), 6)
  assert.equal(context.getProductStoreId_('わんわんペットセンター'), 6)
})

test('商品マスタUPSERTは店舗IDとJANの複合キーを使う', () => {
  const upsertSource = importCsvSource.slice(
    importCsvSource.indexOf('function upsertProductMasterToSupabase_'),
    importCsvSource.indexOf('function fetchExistingProductTags_'),
  )

  assert.match(upsertSource, /on_conflict=store_id,jan_code/)
  assert.match(upsertSource, /records\[i\]\.store_id = getProductStoreId_\(storeTag\)/)
  assert.doesNotMatch(upsertSource, /fetchExistingProductTags_\(/)
})

test('履歴店舗選択は店舗ID設定後に選択ボタンだけをPOSTする', () => {
  const context = createGasContext()
  const prefix = 'includeChildBody:hmma0244AForm:'
  const result = context.buildHistoryStoreSelectionPayload_({
    [`${prefix}schTenpoGroup`]: '11098',
    [`${prefix}doSelectTenpoGroup`]: '',
    [`${prefix}doSerchNormal`]: '検索',
    [`${prefix}doCsvPrintEntryOrExitHistory`]: 'CSV',
    [`${prefix}workStartDate`]: '2026/08/11',
  }, '11099')

  assert.equal(result.groupField, `${prefix}schTenpoGroup`)
  assert.equal(result.selectButton, `${prefix}doSelectTenpoGroup`)
  assert.equal(result.payload[`${prefix}schTenpoGroup`], '11099')
  assert.ok(`${prefix}doSelectTenpoGroup` in result.payload)
  assert.equal(`${prefix}doSerchNormal` in result.payload, false)
  assert.equal(`${prefix}doCsvPrintEntryOrExitHistory` in result.payload, false)
  assert.equal(result.payload[`${prefix}workStartDate`], '2026/08/11')
})

test('履歴店舗選択フィールドがない場合はPOSTペイロードを作らない', () => {
  const context = createGasContext()

  assert.equal(context.buildHistoryStoreSelectionPayload_({}, '11099'), null)
})

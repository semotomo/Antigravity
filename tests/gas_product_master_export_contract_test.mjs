import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { attachProductMasterCsvFlow } from './helpers/pos_product_csv_flow.mjs'

const read = name => fs.readFileSync(new URL(`../gas/${name}`, import.meta.url), 'utf8')
const names = ['ofNameChk', 'gdsSalesKbnChk', 'goodsGroupChk', 'goodsGroupNameChk',
  'goodsNameKanaChk', 'goodsPriceChk', 'liveMembersDispChk', 'goodsTaxCdChk', 'goodsCostChk']
const prefix = 'includeChildBody:hmma02494Form:'
const input = name => `<input value="true" type="checkbox" name="${prefix}${name}" id="${name}" />`
const form = (inputs = names.map(input).join(''), attributes = 'id="hmma02494Form" name="includeChildBody:hmma02494Form"') =>
  `<form ${attributes}>${inputs}<input type="hidden" name="${prefix}viewState" value="private-state" /><input type="submit" name="${prefix}doExport" value="" /></form>`
function fixture() {
  const writes = [], logs = []
  const context = vm.createContext({
    Logger: { log: value => logs.push(value) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities: { parseCsv: csv => csv.split('\n').map(row => row.split(',')) },
  })
  for (const name of ['importCSV.js', 'autoDownload.js', 'posProductSync.js', 'posProductMasterSyncGateway.js']) vm.runInContext(read(name), context)
  context.applyCoordinatedProductMasterSync_ = records => { writes.push(JSON.parse(JSON.stringify(records))); return { success: true, count: records.length } }
  return { context, writes, logs }
}

test('実抽出で両店舗の検索/遷移/出力/ダウンロードは単一操作と現在フォームの状態だけを送る', () => {
  for (const storeId of [6, 7]) for (const directExport of [false, true]) {
    const f = fixture(), flow = attachProductMasterCsvFlow(f.context, { storeId, directExport })
    const result = f.context.downloadProductMasterFromPOS_(flow.config, storeId === 7 ? '本店' : 'わんわん', { dryRun: true })
    assert.equal(result.success, true)
    assert.equal(result.csvRowCount, 1)
    assert.equal(result.diagnostics.excludedRowCount, 1)
    assert.deepEqual(flow.posts.map(post => post.commands), directExport
      ? [['doSearch'], ['doExport'], ['doDownload']] : [['doSearch'], ['goHmma02494'], ['doExport'], ['doDownload']])
    assert.equal(flow.counts.exports, 1); assert.equal(flow.counts.downloads, 1)
    assert.equal(flow.counts.driveWrites, 0); assert.equal(flow.counts.dbWrites, 0); assert.equal(f.writes.length, 0)
    assert.doesNotMatch(JSON.stringify(f.logs), /private-password|private-login|outside-state|search-state-|export-state/)
  }
})

test('ダウンロードという表示だけで完了とせず、実ボタンが有効になるまで送信しない', () => {
  const f = fixture(), flow = attachProductMasterCsvFlow(f.context, { readyAfter: 4 })
  const result = f.context.downloadProductMasterFromPOS_(flow.config, '本店', { dryRun: true })
  assert.equal(result.success, true)
  assert.ok(flow.counts.reloads >= 4)
  assert.equal(flow.counts.downloads, 1); assert.equal(flow.counts.exports, 1)
})

test('待機上限の最後の取得で有効になったダウンロードも検査して一度だけ送る', () => {
  const f = fixture(), flow = attachProductMasterCsvFlow(f.context, { readyAfter: 12 })
  const result = f.context.downloadProductMasterFromPOS_(flow.config, '本店', { dryRun: true })
  assert.equal(result.success, true)
  assert.equal(flow.counts.reloads, 12)
  assert.equal(flow.counts.downloads, 1); assert.equal(flow.counts.exports, 1)
  assert.equal(flow.counts.dbWrites, 0); assert.equal(flow.counts.driveWrites, 0)
})

test('ダウンロード未完了の上限到達は再出力/ダウンロード/DB適用をせず固定拒否する', () => {
  const f = fixture(), flow = attachProductMasterCsvFlow(f.context, { readyAfter: 13 })
  assert.throws(() => f.context.downloadProductMasterFromPOS_(flow.config, '本店', { dryRun: true }),
    error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.exportFailureReason === 'DOWNLOAD_NOT_READY')
  assert.equal(flow.counts.exports, 1); assert.equal(flow.counts.downloads, 0); assert.equal(flow.counts.dbWrites, 0)
  assert.equal(flow.counts.reloads, 12)
})

test('検索フォームや既知遷移submitの欠落/重複/無効化は出力送信前に拒否する', () => {
  for (const change of [html => html.replace('id="hmma02405Form"', 'id="otherSearchForm"'),
    html => html.replace('name="includeChildBody:hmma02405Form"', 'name="wrongForm"'),
    html => html.replace('<input type="submit" name="includeChildBody:hmma02405Form:goHmma02494"',
      '<input disabled type="submit" name="includeChildBody:hmma02405Form:goHmma02494"'),
    html => html.replace('</form>', '<input type="submit" name="includeChildBody:hmma02405Form:goHmma02494"/></form>')]) {
    const f = fixture(), flow = attachProductMasterCsvFlow(f.context, { searchHtml: change })
    assert.throws(() => f.context.downloadProductMasterFromPOS_(flow.config, '本店', { dryRun: true }),
      error => error.code === 'PRODUCT_SYNC_INVALID_DATA')
    assert.equal(flow.counts.exports, 0); assert.equal(flow.counts.downloads, 0); assert.equal(flow.counts.dbWrites, 0)
  }
})

test('既知POSの同一type/表示class/style重複だけを許可し、業務属性の重複は拒否する', () => {
  const f = fixture()
  const html = form().replace('type="checkbox"', 'type="checkbox" type="checkbox" class="a" class="b" style="x" style="y"')
  assert.equal(Object.keys(f.context.configureProductMasterExportFields_(html, 'hmma02494Form').payload).length, 10)
  for (const attributes of ['type="checkbox" type="text"', 'type="checkbox" name="duplicate"',
    'type="checkbox" value="true"', 'type="checkbox" id="first" id="second"']) {
    assert.throws(() => f.context.configureProductMasterExportFields_(form().replace('type="checkbox"', attributes), 'hmma02494Form'),
      error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && /^ATTRIBUTE_DUPLICATE_/.test(error.exportFailureReason))
  }
})

test('実9項目を未チェックでも明示ONにし、存在しない推測checkboxは送らない', () => {
  const f = fixture(), payload = { [`${prefix}viewState`]: 'private-state' }
  const contract = f.context.configureProductMasterExportFields_(form(), 'hmma02494Form', payload), result = contract.payload
  assert.equal(result[`${prefix}viewState`], 'private-state')
  for (const name of names) assert.equal(result[prefix + name], 'true')
  assert.equal(Object.keys(result).length, 10)
  assert.equal(contract.buttonKey, prefix + 'doExport')
  assert.deepEqual(payload, { [`${prefix}viewState`]: 'private-state' })
  assert.doesNotMatch(JSON.stringify(f.logs), /private/)
  assert.match(read('autoDownload.js'), /exportContract = configureProductMasterExportFields_\(exportPageHtml, expFormName\)/)
  assert.match(read('autoDownload.js'), /extractFormAction_\(exportContract\.formHtml, expFormName\)/)
  assert.doesNotMatch(read('autoDownload.js'), /'chkGoods(?:Cd|Nm|Price|Genka)'/)
})

test('欠落・重複・別フォーム・無効項目・追加列は出力前に拒否する', () => {
  const f = fixture(), validInputs = names.map(input).join('')
  const invalid = [
    form(names.slice(0, -1).map(input).join('')),
    form(validInputs + input(names[0])),
    form(validInputs.replace('type="checkbox"', 'type="text"')),
    form(validInputs.replace('value="true"', 'value="false"')),
    form(validInputs.replace('type="checkbox"', 'disabled="disabled" type="checkbox"')),
    form(validInputs + input('newUnknownColumnChk')),
    form(validInputs, 'id="otherForm" name="includeChildBody:otherForm"'),
    form() + form(),
    form(validInputs.replace('type="checkbox"', 'type="checkbox" type="text"')),
    form('') + `<form id="otherForm">${validInputs}</form>`,
    form().replace(`<input type="submit" name="${prefix}doExport" value="" />`, ''),
    form().replace(`<input type="submit" name="${prefix}doExport"`, `<input disabled type="submit" name="${prefix}doExport"`),
    form().replace('</form>', `<input type="submit" name="${prefix}doExport" value="" /></form>`),
  ]
  for (const html of invalid) {
    const payload = { original: 'private-state' }
    assert.throws(() => f.context.configureProductMasterExportFields_(html, 'hmma02494Form', payload),
      error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected' && !error.message.includes('private'))
    assert.deepEqual(payload, { original: 'private-state' })
  }
  assert.equal(f.writes.length, 0)
})

test('対象外フォームやscript/comment内の偽項目を実checkboxとして採用しない', () => {
  const f = fixture()
  const html = `<form id="otherForm">${input(names[0])}</form><!-- ${input(names[0])} -->` +
    `<script>const sample = '${input(names[0])}'</script>` + form()
  assert.equal(Object.keys(f.context.configureProductMasterExportFields_(html, 'hmma02494Form', {}).payload).length, 10)
})

test('別formの同接頭辞checkbox/hidden/ボタン/actionを持ち越さない', () => {
  const f = fixture()
  const outside = `<form id="otherForm" action="https://other.test/">${input('newUnknownColumnChk')}` +
    `<input type="hidden" name="${prefix}viewState" value="outside" />` +
    `<input type="submit" name="${prefix}doExportWrong" value="" /></form>`
  const html = form().replace('name="includeChildBody:hmma02494Form"', 'name="includeChildBody:hmma02494Form" action="/verified.html"') + outside
  // 汎用抽出では後の別formの値が勝つため、実際にその不具合も再現する。
  const unscoped = f.context.extractAllFormFields_(html, 'hmma02494Form')
  assert.equal(unscoped[prefix + 'viewState'], 'outside')
  const result = f.context.configureProductMasterExportFields_(html, 'hmma02494Form', unscoped)
  assert.equal(result.payload[prefix + 'viewState'], 'private-state')
  assert.equal(Object.hasOwn(result.payload, prefix + 'newUnknownColumnChk'), false)
  assert.equal(Object.hasOwn(result.payload, prefix + 'doExportWrong'), false)
  assert.equal(f.context.extractFormAction_(result.formHtml, 'hmma02494Form'), '/verified.html')
  assert.equal(result.buttonKey, prefix + 'doExport')
})

test('出力項目不備を未適用の固定拒否として通知経路へ伝え、曖昧な成功にしない', () => {
  const f = fixture(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let failure
  try { f.context.configureProductMasterExportFields_(form(''), 'hmma02494Form', {}) }
  catch (error) { failure = f.context.productMasterSyncFailure_(error, 7, id) }
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), {
    success: false, storeId: 7, code: 'PRODUCT_SYNC_INVALID_DATA', outcome: 'rejected', runId: id,
  })
  assert.equal(f.writes.length, 0)
})

test('署名同期は11列/13列をapply前に拒否し、正しい12列だけ固定マッピングを使う', () => {
  for (const storeId of [6, 7]) {
    const f = fixture(), storeTag = storeId === 6 ? 'わんわん' : '本店'
    const row = [storeId === 6 ? '11054' : '11053', storeId === 6 ? 'わんわんペットセンター' : 'からつケンネル本店',
      '2', '0012345678901', 'group-id', 'category', 'product', 'furigana', '200', '1', 'tax', '100']
    const sync = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', storeId, startedAt: new Date().toISOString() }
    for (const invalid of [row.slice(0, -1), [...row, 'extra']]) {
      assert.throws(() => f.context.processProductMasterCSV_({ getDataAsString: () => invalid.join(',') }, storeTag, sync),
        error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected')
      assert.equal(f.writes.length, 0)
    }
    const result = f.context.processProductMasterCSV_({ getDataAsString: () => row.join(',') }, storeTag, sync)
    assert.equal(result.success, true)
    assert.equal(f.writes.length, 1)
    assert.equal(f.writes[0][0].jan_code, '0012345678901')
    assert.equal(f.writes[0][0].store_id, storeId)
    assert.equal(f.writes[0][0].category, 'category')
    assert.equal(f.writes[0][0].product_name, 'product')
    assert.equal(f.writes[0][0].selling_price, 200)
    assert.equal(f.writes[0][0].cost_price, 100)
  }
})

test('3970行に同区分20競合があっても全競合を診断し、部分適用や先勝ちをしない', () => {
  const f = fixture()
  const row = (code, name) => ['11053', 'からつケンネル本店', '2', code, 'group', 'category', name, '', '200', '1', 'tax', '100'].join(',')
  const rows = Array.from({ length: 3920 }, (_, i) => row(String(1000000000000 + i), `unique-${i}`))
  for (let i = 0; i < 19; i++) rows.push(row(String(2000000000000 + i), 'first'), row(String(2000000000000 + i), 'second'))
  for (let i = 0; i < 12; i++) rows.push(row('999998', `category-${i}`))
  assert.equal(rows.length, 3970)
  const blob = { getDataAsString: () => rows.join('\n') }
  const diagnostic = f.context.inspectProductMasterCSV_(blob)
  assert.equal(diagnostic.syncSafety.conflictingRowGroups, 20)
  assert.equal(diagnostic.syncSafety.duplicateExtraRows, 30)
  assert.equal(diagnostic.syncSafety.duplicateProfile.groupsByKind['2'], 20)
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.syncSafety.duplicateProfile.groupSizeCounts)), { 2: 19, 12: 1 })
  assert.throws(() => f.context.processProductMasterCSV_(blob, '本店', {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', storeId: 7, startedAt: new Date().toISOString(),
  }), error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected')
  assert.equal(f.writes.length, 0)
  assert.doesNotMatch(JSON.stringify(f.logs), /unique-|category-|2000000000000/)
})

const productRow = (jan, storeId = 7) => [storeId === 6 ? '11054' : '11053',
  storeId === 6 ? 'わんわんペットセンター' : 'からつケンネル本店', '2', jan, 'group', 'category',
  'private-product', '', '200', '1', 'tax', '100']
const productBlob = rows => ({ getDataAsString: () => rows.map(row => row.join(',')).join('\n') })
const productRun = storeId => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', storeId,
  startedAt: '2026-10-08T00:00:00Z' })

test('両店舗で正規化後999999だけを除外し、先頭ゼロと近似コードは保持する', () => {
  for (const storeId of [6, 7]) {
    const f = fixture(), storeTag = storeId === 6 ? 'わんわん' : '本店'
    const codes = ['999999', ' ９９９９９９.０ ', '999999.0', '0999999', '999998', '999999.00', '9999990']
    const rows = codes.map(jan => productRow(jan, storeId))
    const result = f.context.processProductMasterCSV_(productBlob(rows), storeTag, productRun(storeId))
    assert.equal(result.success, true); assert.equal(result.count, 4)
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.writes[0].map(row => row.jan_code), codes.slice(3))
    assert.ok(f.writes[0].every(row => row.store_id === storeId))
    assert.doesNotMatch(JSON.stringify(f.logs), /private-product/)
  }
})

test('999999の12行は診断の対象件数・重複・商品サンプルから除外し、生CSV検査は保持する', () => {
  const f = fixture(), rows = Array.from({ length: 12 }, (_, i) => {
    const row = productRow('999999'); row[6] = `excluded-${i}`; return row
  })
  rows.push(productRow('00123456'))
  const diagnostic = f.context.inspectProductMasterCSV_(productBlob(rows))
  assert.equal(diagnostic.rawRowCount, 13); assert.equal(diagnostic.validRowCount, 1)
  assert.equal(diagnostic.skippedRowCount, 12); assert.equal(diagnostic.excludedRowCount, 12)
  assert.equal(diagnostic.syncSafety.duplicateGroups, 0); assert.equal(diagnostic.syncSafety.duplicateExtraRows, 0)
  assert.equal(diagnostic.syncSafety.rowsByKind['2'], 13)
  assert.equal(diagnostic.storeSummary[0].rowCount, 13)
  assert.equal(diagnostic.rowWidthCounts['12'], 13)
  assert.equal(diagnostic.columnStats[3].nonEmptyCount, 13)
  assert.equal(diagnostic.sample.length, 1); assert.equal(diagnostic.sample[0].janCode, '00123456')
  assert.doesNotMatch(JSON.stringify(diagnostic.sample), /excluded-|999999/)
})

test('全件999999または空CSVは拒否し、一件もapplyしない', () => {
  for (const storeId of [6, 7]) {
    const f = fixture(), storeTag = storeId === 6 ? 'わんわん' : '本店'
    for (const rows of [[], [productRow('999999', storeId)],
      [productRow('999999', storeId), productRow('９９９９９９.０', storeId)]]) {
      assert.throws(() => f.context.processProductMasterCSV_(productBlob(rows), storeTag, productRun(storeId)),
        error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected')
      assert.equal(f.writes.length, 0)
    }
  }
})

test('除外行も店舗・12列・名称・金額の検証を迂回できず、他行を部分適用しない', () => {
  const mutations = [row => { row[0] = '11054' }, row => { row[1] = 'わんわんペットセンター' },
    row => { row.pop() }, row => { row.push('extra') }, row => { row[6] = '' },
    row => { row[8] = '不明' }, row => { row[11] = '-1' }]
  for (const mutate of mutations) {
    const f = fixture(), row = productRow('999999'); mutate(row)
    assert.throws(() => f.context.processProductMasterCSV_(productBlob([productRow('00123456'), row]), '本店', productRun(7)),
      error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected')
    assert.equal(f.writes.length, 0)
  }
  const f = fixture(), row = productRow('999999'); row[8] = '不明'
  const safety = f.context.inspectProductMasterCSV_(productBlob([row])).syncSafety
  assert.equal(safety.invalidMoneyRows, 1); assert.equal(safety.duplicateGroups, 0)
})

test('999999を除外しても他JANの同一行/競合/正規化重複は同期全体を拒否する', () => {
  for (const second of ['00123456', ' ００１２３４５６.０ ']) {
    const f = fixture(), rows = [productRow('999999'), productRow('00123456'), productRow(second)]
    assert.throws(() => f.context.processProductMasterCSV_(productBlob(rows), '本店', productRun(7)),
      error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected')
    assert.equal(f.writes.length, 0)
  }
})

test('旧経路も共通コードを送らず、全件除外ではupsertと停止処理を呼ばない', () => {
  const f = fixture(), calls = []
  f.context.upsertProductMasterToSupabase_ = rows => calls.push(Array.from(rows, row => row.jan_code))
  f.context.reconcileStaleProductStoreMembership_ = () => calls.push('reconcile')
  const empty = f.context.processProductMasterCSV_(productBlob([productRow('999999')]), '本店')
  assert.equal(empty.success, false); assert.equal(empty.count, 0); assert.equal(calls.length, 0)
  const mixed = f.context.processProductMasterCSV_(productBlob([productRow('999999'), productRow('00123456')]), '本店')
  assert.equal(mixed.count, 1); assert.deepEqual(calls, [['00123456'], 'reconcile'])
})

test('旧stale取得と停止PATCHは両店舗とも店舗・999999除外条件を維持する', () => {
  for (const storeId of [6, 7]) {
    const f = fixture(), requests = []
    f.context.PropertiesService = { getScriptProperties: () => ({ getProperty: key =>
      ({ SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_KEY: 'fixture-key' })[key] ?? null }) }
    f.context.UrlFetchApp = { fetch: (url, options) => {
      requests.push({ url, options })
      return { getResponseCode: () => options.method === 'get' ? 200 : 204,
        getContentText: () => JSON.stringify([{ id: 42 }]) }
    } }
    f.context.reconcileStaleProductStoreMembership_(storeId === 6 ? 'わんわん' : '本店', '2026-10-08T00:00:00Z')
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.match(request.url, new RegExp(`store_id=eq\\.${storeId}(?:&|$)`))
      assert.match(request.url, /jan_code=neq\.999999(?:&|$)/)
    }
    assert.equal(requests[1].options.method, 'patch')
    assert.deepEqual(JSON.parse(requests[1].options.payload), { tags: storeId === 6 ? 'わんわん' : '本店', is_active: false })
  }
})

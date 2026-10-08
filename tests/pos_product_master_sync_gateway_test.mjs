import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { createRequire } from 'node:module'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const require = createRequire(new URL('../next_app/package.json', import.meta.url)), ts = require('typescript')
const secret = 'ab'.repeat(32), url = 'https://script.google.com/macros/s/' + 'x'.repeat(40) + '/exec'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function load(path, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Buffer, Date, fetch, Response, AbortSignal, TextDecoder, Uint8Array, URL, process,
      require: name => name === 'server-only' ? {} : dependencies[name] ?? require(name) })
  return module.exports
}
function fixture(changes = {}) {
  const props = { POS_PRODUCT_MASTER_SYNC_ENABLED: 'true', POS_PRODUCT_SYNC_FENCE_ENABLED: 'true', POS_PRODUCT_MASTER_SYNC_SECRET: secret,
    SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-service',
    POS_PRODUCT_SYNC_STORE_6_BASE_URL: 'https://cg8.power-k.jp/fixture6', POS_PRODUCT_SYNC_STORE_6_LOGIN_ID: 'private-user6',
    POS_PRODUCT_SYNC_STORE_6_PASSWORD: 'private-password6', POS_PRODUCT_SYNC_STORE_6_COMPANY_CD: 'fixture',
    POS_PRODUCT_SYNC_STORE_6_COMPANY_KEY: '', POS_PRODUCT_SYNC_STORE_6_TENPO_GROUP_ID: '11054', POS_PRODUCT_SYNC_STORE_6_TENPO_GROUP_NAME: 'わんわんペットセンター',
    POS_PRODUCT_SYNC_STORE_7_BASE_URL: 'https://cg8.power-k.jp/fixture7', POS_PRODUCT_SYNC_STORE_7_LOGIN_ID: 'private-user7',
    POS_PRODUCT_SYNC_STORE_7_PASSWORD: 'private-password7', POS_PRODUCT_SYNC_STORE_7_COMPANY_CD: 'fixture',
    POS_PRODUCT_SYNC_STORE_7_COMPANY_KEY: '', POS_PRODUCT_SYNC_STORE_7_TENPO_GROUP_ID: '11053', POS_PRODUCT_SYNC_STORE_7_TENPO_GROUP_NAME: 'からつケンネル本店', ...changes }
  const calls = [], downloads = []
  const context = vm.createContext({ Date, Logger: { log() {}, getLog() { throw Error('logs forbidden') } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] ?? null }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this } }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' }, newBlob: text => ({ getBytes: () => [...Buffer.from(text)] }),
      computeDigest: (_, text) => [...createHash('sha256').update(text).digest()], computeHmacSha256Signature: (text, key) => [...createHmac('sha256', key).update(text).digest()] },
    UrlFetchApp: { fetch: (dest, options) => { calls.push({ dest, options }); return { getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ accepted: true, id: attemptId, storeId: JSON.parse(options.payload).p_store_id, startedAt: new Date().toISOString() }) } } } })
  vm.runInContext(read('gas/autoDownload.js') + '\n' + read('gas/posProductSync.js') + '\n' + read('gas/posProductMasterSyncGateway.js'), context)
  const originalDownload = context.downloadProductMasterFromPOS_
  context.getPOSConfig_ = () => { throw Error('generic config forbidden') }
  context.downloadProductMasterFromPOS_ = (config, store, options) => { downloads.push({ config, store, options });
    return { success: true, csvRowCount: 2, syncResult: { success: true, count: 2, deactivatedCount: 0, syncStartedAt: options.syncContext.startedAt } } }
  const post = body => JSON.parse(context.doPost({ postData: { contents: body, type: 'application/json' } }).text)
  return { context, props, calls, downloads, post, originalDownload }
}

test('専用要求と署名応答を相関させ、店舗固定設定と一回の開始権だけを使う', async () => {
  const protocol = load('next_app/lib/pos-products/master-sync-protocol.ts')
  const api = load('next_app/lib/pos-products/master-sync-transport.server.ts', { './master-sync-protocol': protocol })
  for (const storeId of [6, 7]) {
    const f = fixture(); let sent = 0
    const transport = api.createSignedProductMasterSyncTransport({ enabled: true, url, secret }, async (dest, options) => {
      sent++; assert.equal(dest, url); assert.equal(options.redirect, 'manual')
      const request = protocol.verifyProductMasterSyncRequest(options.body, secret)
      assert.equal(request.requestId, attemptId); assert.equal(request.storeId, storeId)
      return Response.json(f.post(options.body))
    })
    const result = await transport.sync(storeId, attemptId)
    assert.equal(result.success, true); assert.equal(result.storeId, storeId); assert.equal(result.runId, attemptId)
    assert.equal(result.csvRowCount, 2); assert.equal(result.syncResult.count, 2)
    assert.equal(sent, 1); assert.equal(f.calls.length, 1); assert.match(f.calls[0].dest, /begin_product_master_sync_request$/)
    assert.equal(JSON.parse(f.calls[0].options.payload).p_request_id, attemptId)
    assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].config.loginId, 'private-user' + storeId)
    assert.equal(f.downloads[0].options.syncContext.id, attemptId)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
})

test('旧GET/POST master/fullは切替ON時、設定解決やPOS通信より前に拒否する', () => {
  for (const mode of ['master', 'full']) {
    const f = fixture()
    const post = f.post(JSON.stringify({ mode, lpw: 'private-client' }))
    const get = JSON.parse(f.context.doGet({ parameter: { mode } }).text)
    for (const result of [post, get]) { assert.equal(result.success, false); assert.equal(result.code, 'PRODUCT_SYNC_DISABLED'); assert.ok(!('logs' in result)) }
    assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0)
  }
})

test('別audience・余計な鍵・期限・店舗・署名・MIME不正は既存modeへ流さない', () => {
  const protocol = load('next_app/lib/pos-products/master-sync-protocol.ts')
  const valid = protocol.signProductMasterSyncRequest(6, attemptId, secret)
  for (const change of [{ audience: 'kennel.pos-products.v1' }, { storeId: 8 }, { signature: '0'.repeat(64) },
    { expiresAt: Date.now() - 1 }, { issuedAt: Date.now() + 6000 }, { credentials: 'private' }, { mode: 'master' }]) {
    const f = fixture(); const result = f.post(JSON.stringify({ ...valid, ...change }))
    assert.equal(result.success, false); assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
  const f = fixture(); const output = f.context.doPost({ postData: { contents: JSON.stringify(valid), type: 'text/plain' } })
  assert.equal(JSON.parse(output.text).success, false); assert.equal(f.calls.length, 0)
})

test('専用設定OFF/欠落では汎用POS設定・旧writerへ後退しない', () => {
  const protocol = load('next_app/lib/pos-products/master-sync-protocol.ts')
  for (const change of [{ POS_PRODUCT_MASTER_SYNC_ENABLED: null }, { POS_PRODUCT_SYNC_FENCE_ENABLED: null },
    { POS_PRODUCT_MASTER_SYNC_SECRET: null }, { POS_PRODUCT_SYNC_STORE_6_PASSWORD: null },
    { POS_PRODUCT_SIGNING_SECRET: secret },
    { POS_PRODUCT_SYNC_STORE_6_BASE_URL: 'https://evil.test/private' }, { POS_PRODUCT_SYNC_STORE_6_TENPO_GROUP_NAME: '本店' }]) {
    const f = fixture(change), envelope = f.post(JSON.stringify(protocol.signProductMasterSyncRequest(6, attemptId, secret)))
    const result = envelope.payload ? JSON.parse(envelope.payload) : envelope
    assert.equal(result.success, false); assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
})

test('Google既知結果redirectは本文なしGETだけ、ACK消失や不正相関はunknownで自動再送しない', async () => {
  const protocol = load('next_app/lib/pos-products/master-sync-protocol.ts')
  const api = load('next_app/lib/pos-products/master-sync-transport.server.ts', { './master-sync-protocol': protocol })
  const config = { enabled: true, url, secret }, redirect = 'https://script.googleusercontent.com/macros/echo?user_content_key=fixture&lib=fixture'
  let calls = []
  const f = fixture(); let body
  const transport = api.createSignedProductMasterSyncTransport(config, async (dest, options) => {
    calls.push({ dest, options }); if (calls.length === 1) { body = options.body; return new Response(null, { status: 302, headers: { location: redirect } }) }
    return Response.json(f.post(body))
  })
  assert.equal((await transport.sync(6, attemptId)).success, true); assert.equal(calls.length, 2)
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[1].options.body, undefined); assert.equal(calls[1].options.headers, undefined)
  for (const response of [() => { throw Error('private-secret') }, () => Response.json({ success: true }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.test/macros/echo' } }),
    () => Response.json(f.post(JSON.stringify(protocol.signProductMasterSyncRequest(7, attemptId, secret))))]) {
    let sent = 0; const result = await api.createSignedProductMasterSyncTransport(config, async () => { sent++; return response() }).sync(6, attemptId)
    assert.equal(result.success, false); assert.equal(result.outcome, 'unknown'); assert.equal(result.code, 'PRODUCT_SYNC_UNKNOWN')
    assert.equal(sent, 1); assert.equal(result.runId, attemptId); assert.ok(!JSON.stringify(result).includes('private'))
  }
})

test('RPCの明示rollbackだけを固定拒否へ変換し、曖昧な応答を未更新と断言しない', () => {
  const f = fixture()
  for (const [status, data, code, outcome] of [[409, { code: '40001', message: 'stale sync' }, 'PRODUCT_SYNC_STALE', 'rejected'],
    [400, { code: '55000', message: 'pending product operation' }, 'PRODUCT_SYNC_PENDING_EDIT', 'rejected'],
    [400, { code: '55000', message: 'sync expired' }, 'PRODUCT_SYNC_EXPIRED', 'rejected'],
    [400, { code: '22023', message: 'invalid sync values' }, 'PRODUCT_SYNC_INVALID_DATA', 'rejected'],
    [500, { code: '40001', message: 'private-data' }, 'PRODUCT_SYNC_UNKNOWN', 'unknown'],
    [200, { unexpected: 'private-data' }, 'PRODUCT_SYNC_UNKNOWN', 'unknown']]) {
    f.context.UrlFetchApp.fetch = () => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(data) })
    assert.throws(() => f.context.beginRequestedProductMasterSync_(6, attemptId, Date.now() + 60000), error => {
      assert.equal(error.code, code); assert.equal(error.outcome, outcome); assert.ok(!error.message.includes('private')); return true
    })
  }
})

test('署名応答の追加鍵・別audience・期限・本文改ざん・意味矛盾・巨大応答をunknownへ限定する', async () => {
  const protocol = load('next_app/lib/pos-products/master-sync-protocol.ts')
  const api = load('next_app/lib/pos-products/master-sync-transport.server.ts', { './master-sync-protocol': protocol })
  const config = { enabled: true, url, secret }
  const success = request => ({ success: true, storeId: 6, runId: request.requestId, csvRowCount: 2,
    syncResult: { success: true, count: 2, deactivatedCount: 0, syncStartedAt: new Date().toISOString() } })
  const signed = (request, change) => {
    const e = protocol.signProductMasterSyncResponse(request, success(request), secret)
    if (change.payload) {
      e.payload = JSON.stringify({ ...success(request), ...change.payload }); e.payloadHash = createHash('sha256').update(e.payload).digest('hex')
      e.signature = createHmac('sha256', secret).update(JSON.stringify([e.version, e.audience, e.requestId, e.storeId, e.issuedAt, e.expiresAt, e.payloadHash])).digest('hex')
      return e
    }
    return { ...e, ...change }
  }
  for (const change of [{ extra: 'private' }, { audience: 'kennel.pos-products.v1' }, { expiresAt: Date.now() - 1 },
    { signature: '0'.repeat(64) }, { payloadHash: '0'.repeat(64) }, { payload: { csvRowCount: 3 } },
    { payload: { syncResult: { success: true, count: 2, deactivatedCount: -1, syncStartedAt: 'bad' } } },
    { payload: { success: false, code: 'PRODUCT_SYNC_UNKNOWN', outcome: 'rejected' } }]) {
    let sent = 0
    const result = await api.createSignedProductMasterSyncTransport(config, async (_, options) => {
      sent++; return Response.json(signed(protocol.verifyProductMasterSyncRequest(options.body, secret), change))
    }).sync(6, attemptId)
    assert.equal(result.outcome, 'unknown'); assert.equal(result.code, 'PRODUCT_SYNC_UNKNOWN'); assert.equal(sent, 1)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
  let sent = 0
  const huge = await api.createSignedProductMasterSyncTransport(config, async () => { sent++; return new Response('x'.repeat(8193), { headers: { 'Content-Type': 'application/json' } }) }).sync(6, attemptId)
  assert.equal(huge.outcome, 'unknown'); assert.equal(sent, 1)
})

test('送信前停止とSheets内部同期は店舗固定・一回の開始権を保ち、旧POS設定へ落ちない', async () => {
  const protocol = load('next_app/lib/pos-products/master-sync-protocol.ts')
  const api = load('next_app/lib/pos-products/master-sync-transport.server.ts', { './master-sync-protocol': protocol })
  let sent = 0
  for (const change of [{ enabled: false }, { url: 'https://evil.test/' }, { secret: 'bad' }]) {
    const result = await api.createSignedProductMasterSyncTransport({ enabled: true, url, secret, ...change }, async () => { sent++; throw Error('must not send') }).sync(6, attemptId)
    assert.equal(result.success, false); assert.equal(result.outcome, 'rejected'); assert.equal(result.runId, undefined)
  }
  assert.equal(sent, 0)
  for (const storeId of [6, 7]) {
    const f = fixture(); f.context.Utilities.getUuid = () => attemptId
    const result = f.context.downloadFixedProductMasterSync_(storeId)
    assert.equal(result.success, true); assert.equal(f.calls.length, 1); assert.equal(f.downloads.length, 1)
    assert.equal(f.downloads[0].config.loginId, 'private-user' + storeId)
  }
  const stopped = fixture({ POS_PRODUCT_MASTER_SYNC_ENABLED: null })
  assert.equal(stopped.context.downloadFixedProductMasterSync_(6).code, 'PRODUCT_SYNC_DISABLED')
  assert.equal(stopped.calls.length, 0); assert.equal(stopped.downloads.length, 0)
})

test('CSVの既知検証拒否はapply前に確定し、原文サンプルをログへ出さない', () => {
  const f = fixture(), logs = []
  f.context.Logger.log = value => logs.push(value)
  f.context.Utilities.parseCsv = text => text.split('\n').map(row => row.split(','))
  vm.runInContext(read('gas/importCSV.js'), f.context)
  const row = jan => ['11054', 'わんわんペットセンター', '2', jan, '', 'private-category', 'private-name', '', '999', '', '', '499'].join(',')
  const context = { id: attemptId, storeId: 6, startedAt: new Date().toISOString() }
  assert.throws(() => f.context.processProductMasterCSV_({ getDataAsString: () => row('12345678') + '\n' + row('12345678') }, 'わんわん', context),
    error => error.code === 'PRODUCT_SYNC_INVALID_DATA' && error.outcome === 'rejected')
  assert.equal(f.calls.length, 0); assert.ok(!JSON.stringify(logs).includes('private')); assert.ok(!JSON.stringify(logs).includes('12345678'))
})

test('実CSVダウンロード上位はsyncResultの固定code/outcomeを保ち、成功として返さない', () => {
  const f = fixture(), c = f.context
  // 実ダウンロード関数へ戻し、POSの各画面とDriveだけを合成fixtureで置き換える。
  c.downloadProductMasterFromPOS_ = f.originalDownload
  c.CONFIG = { CSV_FOLDER_ID: 'fixture-folder', CSV_ENCODING: 'Shift_JIS' }
  c.Session = { getScriptTimeZone: () => 'Asia/Tokyo' }
  c.Utilities.sleep = () => {}; c.Utilities.formatDate = () => '20261005'
  const blob = { setName() { return this } }
  // 実出力画面の9項目を使い、出力契約検証を迂回せず後段の失敗伝播を確認する。
  const exportHtml = '<form id="hmma02494Form" name="includeChildBody:hmma02494Form">' +
    ['ofNameChk', 'gdsSalesKbnChk', 'goodsGroupChk', 'goodsGroupNameChk', 'goodsNameKanaChk',
      'goodsPriceChk', 'liveMembersDispChk', 'goodsTaxCdChk', 'goodsCostChk']
      .map(name => `<input type="checkbox" name="includeChildBody:hmma02494Form:${name}" value="true" />`).join('') +
    '<input type="submit" name="includeChildBody:hmma02494Form:doExport" value="" />処理完了 ダウンロード</form>'
  const response = { getResponseCode: () => 200, getContentText: () => exportHtml,
    getHeaders: () => ({ 'Content-Type': 'text/csv' }), getBlob: () => blob }
  c.UrlFetchApp.fetch = () => response; c.fetchWithCookies_ = () => response
  c.extractCookies_ = () => ''; c.mergeCookies_ = () => ''; c.extractFormAction_ = () => null
  c.extractAllFormFields_ = () => ({ 'hmma02494Form:doSearch': '', 'hmma02494Form:doExport': '', 'hmma02494Form:doDownload': '' })
  c.applyTenpoParamsGlobal_ = () => {}; c.switchStoreContext_ = (_, cookies) => cookies
  c.inspectProductMasterCSV_ = () => ({ storeSummary: [{ storeName: 'わんわんペットセンター' }] })
  c.DriveApp = { getFolderById: () => ({ getFilesByName: () => ({ hasNext: () => false }), createFile: () => ({ getName: () => 'fixture.csv' }) }) }
  const context = { id: attemptId, storeId: 6, startedAt: new Date().toISOString() }
  for (const [code, outcome] of [['PRODUCT_SYNC_STALE', 'rejected'], ['PRODUCT_SYNC_UNKNOWN', 'unknown']]) {
    c.processProductMasterCSV_ = () => { throw c.productMasterSyncError_(code, outcome, attemptId) }
    const result = c.downloadProductMasterFromPOS_(c.productMasterSyncFixedStoreConfig_(6), 'わんわん', { syncContext: context })
    assert.equal(result.success, false); assert.equal(result.code, code); assert.equal(result.outcome, outcome)
    assert.equal(result.syncResult.code, code); assert.equal(result.syncResult.outcome, outcome); assert.equal(result.runId, attemptId)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
  // 実パーサーを通し、raw件数ではなく除外後の件数で成功応答を照合する。
  vm.runInContext(read('gas/importCSV.js'), c)
  vm.runInContext('CONFIG.CSV_FOLDER_ID = "fixture-folder"', c)
  const csvRows = ['11054,わんわんペットセンター,2,999999,,分類,共通コード,,100,1,,50',
    '11054,わんわんペットセンター,2,00123456,,分類,商品,,100,1,,50']
  c.Utilities.parseCsv = text => text.split('\n').map(line => line.split(','))
  blob.getDataAsString = () => csvRows.join('\n')
  let appliedRows
  c.applyCoordinatedProductMasterSync_ = records => {
    appliedRows = JSON.parse(JSON.stringify(records)); return { success: true, count: records.length }
  }
  const success = c.downloadProductMasterFromPOS_(c.productMasterSyncFixedStoreConfig_(6), 'わんわん', { syncContext: context })
  assert.equal(success.success, true, JSON.stringify(success)); assert.equal(success.csvRowCount, 1); assert.equal(success.syncResult.count, 1)
  assert.equal(appliedRows.length, 1); assert.equal(appliedRows[0].jan_code, '00123456')
  // 診断経路も実関数を通し、除外・重複件数の伝播とDB/Drive非更新を確認する。
  c.inspectProductMasterCSV_ = () => ({
    storeSummary: [{ storeName: 'わんわんペットセンター' }], rawRowCount: 5, validRowCount: 2,
    skippedRowCount: 3, excludedRowCount: 2, syncSafety: { duplicateGroups: 1, duplicateExtraRows: 1, conflictingRowGroups: 1 },
  })
  c.DriveApp = { getFolderById: () => { throw Error('dry-run must not access Drive') } }
  c.processProductMasterCSV_ = () => { throw Error('dry-run must not write products') }
  const diagnostic = c.downloadProductMasterFromPOS_(c.productMasterSyncFixedStoreConfig_(6), 'わんわん', { dryRun: true })
  assert.equal(diagnostic.success, true)
  assert.equal(diagnostic.dryRun, true)
  assert.equal(diagnostic.syncResult, null)
  assert.equal(diagnostic.csvRowCount, 2)
  assert.equal(diagnostic.diagnostics.rawRowCount, 5)
  assert.equal(diagnostic.diagnostics.excludedRowCount, 2)
  assert.equal(diagnostic.diagnostics.syncSafety.duplicateExtraRows, 1)
  assert.equal(diagnostic.diagnostics.syncSafety.conflictingRowGroups, 1)
  assert.equal(f.calls.length, 0)
})

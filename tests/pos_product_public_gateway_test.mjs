import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { signPosProductRequest, verifyPosProductNotSentProof } from '../next_app/lib/pos-products/protocol.ts'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const now = 1_800_000_000_000, secret = 'ab'.repeat(32)
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const janCode = '0490123456789'
const failure = { version: 1, success: false, code: 'POS_PRODUCT_PUBLIC_GATEWAY_UNAVAILABLE' }
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)
const hash = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex')
const command = storeId => ({ operationId, actorId, storeId, janCode,
  before: { identity: {}, fields: {}, settings: {}, groups: [], suppliers: [] }, patch: { goodsName: '新しい商品名' }, expiresAt: now + 100_000 })
const signed = (action = 'inspect', storeId = 7, payload = action === 'dispatch' ? command(storeId) : { operationId, storeId, janCode }) =>
  JSON.stringify(signPosProductRequest({ action, operationId, actorId, storeId, payload }, secret, now))

function fixture(options = {}) {
  const props = options.defaultOff ? {} : { POS_PRODUCT_PUBLIC_GATEWAY_ENABLED: 'true', POS_PRODUCT_INSPECTION_ENABLED: 'true',
    POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'true', POS_PRODUCT_SIGNING_SECRET: secret, POS_PRODUCT_CONSUME_ENABLED: 'true',
    POS_PRODUCT_CONSUME_SECRET: 'cd'.repeat(32), POS_PRODUCT_CONSUME_URL: 'https://kennel-dashboard.vercel.app/api/pos-products/consume',
    HISTORY_SCHEMA_DIAGNOSTIC_TOKEN: 'synthetic-diagnostic-token', ...options.props }
  const calls = [], network = [], logs = ['synthetic-private-existing-log']
  let configCalls = 0, logReads = 0
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const context = vm.createContext({ Date: FixedDate,
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name] ?? null }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      newBlob: text => ({ getBytes: () => [...Buffer.from(text, 'utf8')] }), formatDate: () => '2027/01/15',
      computeDigest: (_, text) => [...createHash('sha256').update(text, 'utf8').digest()],
      computeHmacSha256Signature: (text, key) => [...createHmac('sha256', key).update(text, 'utf8').digest()] },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType(mime) { this.mime = mime; return this } }) },
    Logger: { log: text => logs.push(String(text)), getLog: () => { logReads++; return logs.join('\n') } },
    UrlFetchApp: { fetch: (url, request) => { network.push({ url, request }); throw Error('unexpected-synthetic-private-network') } } })
  vm.runInContext(['gas/autoDownload.js', 'gas/posProductProtocol.js', 'gas/posProductInspection.js',
    'gas/posProductEditGateway.js', 'gas/posProductEditExecution.js'].map(read).join('\n'), context)
  context.getPOSConfig_ = () => {
    configCalls++
    return options.noConfig ? null : { baseUrl: 'https://cg8.power-k.jp/0D890OGI', loginId: 'synthetic-private-user',
      password: 'synthetic-private-password', companyCd: 'base-company', companyKey: 'base-key', tenpoGroupId: '11098', tenpoGroupName: 'からつケンネル本店' }
  }
  context.inspectPosProductEdit_ = (config, storeId, jan) => {
    calls.push({ kind: 'inspect', config: plain(config), storeId, janCode: jan })
    if (options.inspectThrows) throw Error('synthetic-private-inspection')
    return { storeId, janCode: jan, capturedAt: now, searches: [{ fixture: 'business-inspection' }] }
  }
  context.downloadProductMasterFromPOS_ = (config, store, settings) => {
    calls.push({ kind: 'master', config: plain(config), store, settings: plain(settings ?? {}) })
    return { success: true, count: 3, store }
  }
  context.downloadProductSalesFromPOS_ = (config, year, month) => {
    calls.push({ kind: 'sales', config: plain(config), year, month })
    return { success: true, count: 2, year, month }
  }
  context.downloadSalesHistoryFromPOS_ = (config, startDate, endDate, settings) => {
    calls.push({ kind: 'history', config: plain(config), startDate, endDate, settings: plain(settings ?? {}) })
    return { success: options.historyFailure !== true, count: 1, data: [{ fixture: 'legacy-history-row' }] }
  }
  context.testGetTenpoDialogJS = () => ({ text: JSON.stringify({ fixture: 'legacy-testJS' }), mime: 'application/json' })
  function result(output) { assert.equal(output.mime, 'application/json'); return JSON.parse(output.text) }
  const post = (body, type = 'application/json', extra = {}) => result(context.doPost({ postData: { contents: body, type }, ...extra }))
  return { context, props, calls, network, logs, post,
    legacy: params => post(JSON.stringify(params), undefined),
    empty: () => result(context.doPost({})),
    get: params => result(context.doGet({ parameter: params })),
    get configCalls() { return configCalls }, get logReads() { return logReads } }
}

function noLegacy(f) {
  assert.equal(f.calls.filter(call => call.kind !== 'inspect').length, 0)
  assert.equal(f.network.length, 0); assert.equal(f.logReads, 0)
  assert.deepEqual(f.logs, ['synthetic-private-existing-log'])
}

test('実doPostから署名付きinspectを両店舗の実private受付へ送り、旧modeやqueryへ流さない', () => {
  for (const storeId of [6, 7]) {
    const f = fixture(), body = signed('inspect', storeId)
    const result = f.post(body, 'application/json; charset=utf-8', { parameter: { mode: 'full', lid: 'synthetic-private-query' } })
    assert.deepEqual(result, { version: 1, success: true, operationId, actorId, storeId, janCode,
      data: { storeId, janCode, capturedAt: now, searches: [{ fixture: 'business-inspection' }] } })
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'inspect')
    assert.equal(f.calls[0].storeId, storeId); assert.equal(f.calls[0].janCode, janCode)
    assert.equal(f.calls[0].config.loginId, 'synthetic-private-user'); assert.equal(f.configCalls, 1)
    noLegacy(f); assert.doesNotMatch(JSON.stringify(result), /synthetic-private|logs|password|signature|payload/)
  }
})

test('署名dispatchは実ゲートウェイ/実実行器へ接続し、実行器フラグ既定OFFでPOS通信0を維持する', () => {
  for (const storeId of [6, 7]) {
    const f = fixture(), body = signed('dispatch', storeId), result = f.post(body)
    const { notSentProof, ...legacyResult } = result
    const dispatchHash = hash(command(storeId)), requestSignature = JSON.parse(body).signature
    assert.deepEqual(legacyResult, { version: 1, success: true, operationId, actorId, storeId, dispatchHash,
      result: { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_DISABLED', saveRequestStarted: false, responseReceived: false } })
    assert.deepEqual(Object.keys(result).sort(), ['version', 'success', 'operationId', 'actorId', 'storeId', 'dispatchHash', 'result', 'notSentProof'].sort())
    assert.deepEqual(Object.keys(notSentProof).sort(), ['version', 'audience', 'operationId', 'actorId', 'storeId', 'dispatchHash',
      'requestSignature', 'stopCode', 'occurredAt', 'signature'].sort())
    const audience = 'kennel.pos-product-not-sent.v1', stopCode = 'POS_PRODUCT_EDIT_DISABLED'
    const signature = createHmac('sha256', secret).update(JSON.stringify([1, audience, operationId, actorId, storeId,
      dispatchHash, requestSignature, stopCode, now]), 'utf8').digest('hex')
    assert.deepEqual(notSentProof, { version: 1, audience, operationId, actorId, storeId, dispatchHash,
      requestSignature, stopCode, occurredAt: now, signature })
    const expected = { operationId, actorId, storeId, dispatchHash, requestSignature, earliestAt: now }
    assert.deepEqual(verifyPosProductNotSentProof(notSentProof, secret, expected, now), notSentProof)
    assert.throws(() => verifyPosProductNotSentProof(notSentProof, secret, { ...expected, requestSignature: '00'.repeat(32) }, now))
    assert.equal(f.configCalls, 1); assert.equal(f.calls.length, 0); noLegacy(f)
  }
})

test('公開フラグは既定OFFでtrue以外を拒否し、private受付や従来同期へ進まない', () => {
  for (const options of [{ defaultOff: true }, { props: { POS_PRODUCT_PUBLIC_GATEWAY_ENABLED: undefined } },
    { props: { POS_PRODUCT_PUBLIC_GATEWAY_ENABLED: 'false' } }, { props: { POS_PRODUCT_PUBLIC_GATEWAY_ENABLED: 'TRUE' } }]) {
    for (const action of ['inspect', 'dispatch']) {
      const f = fixture(options)
      assert.deepEqual(f.post(signed(action)), failure)
      assert.equal(f.configCalls, 0); assert.equal(f.calls.length, 0); noLegacy(f)
    }
  }
})

test('公開フラグだけではprivate読取/編集/consumeの個別フラグや専用鍵を代用できない', () => {
  for (const [action, props, code] of [
    ['inspect', { POS_PRODUCT_INSPECTION_ENABLED: undefined }, 'POS_PRODUCT_INSPECTION_UNAVAILABLE'],
    ['dispatch', { POS_PRODUCT_EDIT_GATEWAY_ENABLED: undefined }, 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE'],
    ['dispatch', { POS_PRODUCT_CONSUME_ENABLED: undefined }, 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE'],
    ['dispatch', { POS_PRODUCT_CONSUME_SECRET: '' }, 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE']]) {
    const f = fixture({ props })
    assert.deepEqual(f.post(signed(action)), { version: 1, success: false, code })
    assert.equal(f.configCalls, 0); assert.equal(f.calls.length, 0); noLegacy(f)
  }
})

test('11項目のexact envelope以外やreconcileは拒否し、mode混在や署名一部欠損でlegacy書込みへ落ちない', () => {
  const envelope = JSON.parse(signed()), keys = Object.keys(envelope)
  const invalid = [{ ...envelope, mode: 'full' }, { ...envelope, extra: 'synthetic-private' },
    { ...envelope, audience: 'other' }, { ...envelope, version: 2 }, { ...envelope, action: 'other' },
    ...keys.map(key => ({ mode: 'full', [key]: 'synthetic-private' })),
    ...keys.map(key => Object.fromEntries(Object.entries(envelope).filter(([name]) => name !== key)))]
  for (const body of [...invalid.map(JSON.stringify), signed('reconcile')]) {
    const f = fixture()
    assert.deepEqual(f.post(body), failure)
    assert.equal(f.calls.length, 0); assert.equal(f.configCalls, 0); noLegacy(f)
  }
})

test('不正JSON/非object/巨大UTF8本文や署名要求の非JSON MIMEを固定結果だけで拒否する', () => {
  for (const body of ['', '{"action":"inspect","mode":"full","private":"synthetic-private"', 'null', '[]', '"synthetic-private"',
    JSON.stringify({ mode: 'full', text: 'x'.repeat(24576) }), JSON.stringify({ mode: 'full', text: 'あ'.repeat(8192) })]) {
    const f = fixture()
    assert.deepEqual(f.post(body), failure)
    assert.equal(f.calls.length, 0); assert.equal(f.configCalls, 0); noLegacy(f)
  }
  for (const type of ['text/html', 'application/x-www-form-urlencoded', '']) {
    const f = fixture()
    assert.deepEqual(f.post(signed(), type), failure); assert.equal(f.configCalls, 0); noLegacy(f)
  }
})

test('署名改ざん/不正payload/読取り例外はprivate固定エラーで止まり、本文や既存ログを返さない', () => {
  const envelope = JSON.parse(signed())
  for (const [body, options] of [[JSON.stringify({ ...envelope, signature: '0'.repeat(64) }), {}],
    [signed('inspect', 7, { operationId, storeId: 7, janCode, password: 'synthetic-private' }), {}],
    [signed(), { inspectThrows: true }]]) {
    const f = fixture(options), result = f.post(body)
    assert.deepEqual(result, { version: 1, success: false, code: 'POS_PRODUCT_INSPECTION_UNAVAILABLE' })
    noLegacy(f); assert.doesNotMatch(JSON.stringify(result), /synthetic-private|logs|payload|signature/)
  }
  const unavailable = fixture()
  unavailable.context.handlePosProductInspection_ = undefined
  assert.deepEqual(unavailable.post(signed()), failure); noLegacy(unavailable)
})

test('従来POSTのmaster/sales/full/history/history_schemaと店舗/資格情報/期間/dryRunを保持する', () => {
  for (const [mode, expected] of [['master', ['master']], ['sales', ['sales']], ['full', ['master', 'sales']],
    ['history', ['history']], ['history_schema', ['history']], ['testJS', []], ['unknown', []]]) {
    const f = fixture({ defaultOff: true })
    f.props.HISTORY_SCHEMA_DIAGNOSTIC_TOKEN = 'synthetic-diagnostic-token'
    const params = { mode, year: '2026', month: '9', targetStoreName: 'わんわん', tenpoGroupId: '11099',
      tenpoGroupName: 'わんわんペットセンター', lid: 'override-user', lpw: 'override-password', lcd: 'override-company',
      lkey: 'override-key', companyKey: '', startDate: '2026/09/01', endDate: '2026/09/30', dryRun: 'true',
      diagnosticToken: 'synthetic-diagnostic-token' }
    const result = f.legacy(params)
    assert.equal(result.success, true); assert.equal(result.mode, mode)
    assert.deepEqual(f.calls.map(call => call.kind), expected); assert.equal(f.configCalls, 1)
    for (const call of f.calls) {
      assert.equal(call.config.loginId, params.lid); assert.equal(call.config.password, params.lpw)
      assert.equal(call.config.companyCd, params.lcd); assert.equal(call.config.companyKey, '')
      assert.equal(call.config.tenpoGroupId, '11099'); assert.equal(call.config.tenpoGroupName, params.tenpoGroupName)
      if (call.kind === 'master') { assert.equal(call.store, 'わんわん'); assert.deepEqual(call.settings, { dryRun: true }) }
      if (call.kind === 'sales') { assert.equal(call.year, 2026); assert.equal(call.month, 9) }
      if (call.kind === 'history') { assert.equal(call.startDate, params.startDate); assert.equal(call.endDate, params.endDate); assert.deepEqual(call.settings, { schemaOnly: mode === 'history_schema' }) }
    }
    assert.equal(f.network.length, 0)
    assert.equal(result.logs, mode === 'history_schema' ? '' : f.logs.join('\n'))
  }
})

test('旧default history/設定未完了/履歴診断認証とダウンロード失敗の挙動を保持する', () => {
  for (const run of [f => f.empty(), f => f.legacy({})]) {
    const f = fixture({ defaultOff: true }), result = run(f)
    assert.equal(result.mode, 'history'); assert.equal(result.success, true)
    assert.deepEqual(f.calls.map(call => call.kind), ['history'])
  }
  const unauthorized = fixture({ defaultOff: true })
  assert.equal(unauthorized.legacy({ mode: 'history_schema', diagnosticToken: 'bad' }).success, false)
  assert.equal(unauthorized.configCalls, 0); assert.equal(unauthorized.calls.length, 0)
  const unconfigured = fixture({ noConfig: true })
  assert.deepEqual(unconfigured.legacy({ mode: 'master' }), { success: false, message: 'POS接続設定が未完了です。' })
  const failed = fixture({ historyFailure: true })
  assert.equal(failed.legacy({ mode: 'history' }).success, false)
})

test('doGetの全既存modeとhistory_schemaの認証付きPOST限定を保持する', () => {
  for (const [mode, expected] of [['master', ['master']], ['sales', ['sales']], ['full', ['master', 'sales']],
    ['history', ['history']], ['unknown', []]]) {
    const f = fixture({ defaultOff: true }), result = f.get({ mode, year: '2026', month: '9', startDate: '2026/09/01', endDate: '2026/09/30' })
    assert.equal(result.success, true); assert.equal(result.mode, mode); assert.deepEqual(f.calls.map(call => call.kind), expected)
  }
  const schema = fixture()
  assert.equal(schema.get({ mode: 'history_schema' }).success, false); assert.equal(schema.configCalls, 0)
  const testJS = fixture()
  assert.deepEqual(testJS.get({ mode: 'testJS' }), { fixture: 'legacy-testJS' })
})

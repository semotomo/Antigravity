import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { signPosProductRequest } from '../next_app/lib/pos-products/protocol.ts'
import { form, jan } from './fixtures/pos_product_form_fixture.mjs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const signingSecret = 'ab'.repeat(32), consumeSecret = 'cd'.repeat(32)
const consumeUrl = 'https://kennel-dashboard.vercel.app/api/pos-products/consume'
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const now = 1_800_000_000_000
const plain = value => JSON.parse(JSON.stringify(value))
const hmac = text => createHmac('sha256', consumeSecret).update(text, 'utf8').digest('hex')
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)
const digest = command => createHash('sha256').update(canonical(command), 'utf8').digest('hex')
const rejected = { version: 1, success: false, code: 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE' }
const consumerRejected = error => error.message === 'POS_PRODUCT_EDIT_CONSUME_UNAVAILABLE'
const properties = () => ({ POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'true', POS_PRODUCT_SIGNING_SECRET: signingSecret,
  POS_PRODUCT_CONSUME_ENABLED: 'true', POS_PRODUCT_CONSUME_URL: consumeUrl, POS_PRODUCT_CONSUME_SECRET: consumeSecret,
  POS_PRODUCT_EDIT_EXECUTION_ENABLED: 'true' })
const receiptFor = (request, accepted = true) => ({ operationId: request.operationId, actorId: request.actorId,
  storeId: request.storeId, dispatchHash: request.dispatchHash, accepted })
const responseFor = (request, accepted = true) => {
  const receipt = receiptFor(request, accepted)
  return { version: 1, requestSignature: request.signature, receipt,
    signature: hmac(JSON.stringify([1, 'kennel.pos-product-consume-response.v1', request.signature,
      receipt.operationId, receipt.actorId, receipt.storeId, receipt.dispatchHash, receipt.accepted])) }
}
const response = (body, code = 200, type = 'application/json; charset=utf-8') => ({
  getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
  getHeaders: () => ({ 'Content-Type': type }), getAllHeaders: () => ({}),
})
const simple = (id, fields) => `<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">` +
  Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${id === 'hmma00000Form' ? '' : 'includeChildBody:'}${id}:${key}" value="${value}">`).join('') + '</form>'
const list = count => `${count}件中` + simple('hmma02400Form', { schOfficeCd: '', schTenpoGroupNoSingle: '', schGoodsId: '',
  schMakerCd: '', schGoodsName: '', doSerchNormal: '', 'goodsItems:0:doHmma02402': '' })
const searchPages = html => [list(0), list(1), simple('hmma02402Form', { doHmma02403: '' }), html,
  list(0), list(1), simple('hmma02402Form', { doHmma02403: '' }), html]

function fixture(options = {}) {
  const props = options.defaultOff ? {} : { ...properties(), ...options.props }
  const calls = [], executions = [], events = [], logs = []
  let tick = now, configCalls = 0, saveCount = 0, consumed = false
  const pages = [simple('hmma00000Form', { loginId: '', password: '', doLogin: '' }), 'portal',
    ...searchPages(form()), ...searchPages(form(7, { name: '新しい名前' }))]
  const config = { baseUrl: 'https://cg8.power-k.jp/0D890OGI', loginId: 'fixture-user', password: 'synthetic-private-password' }
  const context = vm.createContext({ Date: { now: () => options.clock ? options.clock() : options.realExecutor ? ++tick : tick },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' }, getUuid: () => operationId,
      newBlob: text => ({ getBytes: () => [...Buffer.from(text, 'utf8')] }),
      computeDigest: (_, text) => [...createHash('sha256').update(text, 'utf8').digest()],
      computeHmacSha256Signature: (text, key) => [...createHmac('sha256', key).update(text, 'utf8').digest()] },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name] ?? null }) },
    Logger: { log: text => logs.push(text) }, console: { log: text => logs.push(text) },
    UrlFetchApp: { fetch: (url, request) => {
      calls.push({ url, request }); events.push(url === consumeUrl ? 'consume' : 'pos')
      if (url === consumeUrl) {
        const body = JSON.parse(request.payload)
        if (options.callbackThrows) throw Error('synthetic-private-network')
        if (options.callbackResponse) return options.callbackResponse(body)
        const accepted = options.accepted !== false && !consumed
        if (accepted) consumed = true
        return response(responseFor(body, accepted))
      }
      if (!options.realExecutor) throw Error('unexpected POS IO')
      if (request.method === 'post' && typeof request.payload === 'string') {
        saveCount++; events.push('save')
        return { ...response('', 303), getHeaders: () => ({ Location: '/hm-hmma/view/hmma/hmma024/hmma02400.html' }) }
      }
      const html = pages.shift()
      if (html === undefined) throw Error('unexpected POS request')
      return response(html)
    } } })
  const sources = ['gas/posProductProtocol.js']
  if (options.realExecutor) sources.push('gas/autoDownload.js', 'gas/posProductReadDiagnostic.js', 'gas/posProductForm.js',
    'gas/posProductSubmission.js', 'gas/posProductEditExecution.js')
  sources.push('gas/posProductEditGateway.js')
  vm.runInContext(sources.map(read).join('\n'), context)
  context.getPOSConfig_ = () => { configCalls++; return config }
  if (!options.realExecutor) context.executePosProductEdit_ = (receivedConfig, command, consumer) => {
    executions.push({ config: receivedConfig, command: plain(command), consumer })
    if (options.executorThrows) throw Error('synthetic-private-executor')
    return options.executorResult ?? { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_DISABLED', saveRequestStarted: false, responseReceived: false }
  }
  const command = { operationId, actorId, storeId: 7, janCode: jan,
    before: options.realExecutor ? plain(context.readPosProductEditForm_(form(), 7, jan)) :
      { identity: {}, fields: {}, settings: {}, groups: [], suppliers: [] }, patch: { goodsName: '新しい名前' }, expiresAt: now + 100_000 }
  const input = { operationId, actorId, storeId: 7, dispatchHash: digest(command) }
  const sign = (value = command, changes = {}, ttl = 120_000) => JSON.stringify(signPosProductRequest({
    action: 'dispatch', operationId, actorId, storeId: 7, payload: value, ...changes }, signingSecret, now, ttl))
  return { context, command, input, sign, calls, executions, events, logs, props,
    run: body => plain(context.handlePosProductEditDispatch_(body)),
    consumer: () => context.createPosProductEditConsumer_({ getProperty: name => props[name] ?? null }),
    retryReads: () => pages.push(simple('hmma00000Form', { loginId: '', password: '', doLogin: '' }), 'portal', ...searchPages(form())),
    get configCalls() { return configCalls }, get saveCount() { return saveCount } }
}

test('ゲートウェイは既定OFFで、無効フラグ/署名では実行器・POS設定・通信を呼ばない', () => {
  for (const options of [{ defaultOff: true }, { props: { POS_PRODUCT_EDIT_GATEWAY_ENABLED: null } },
    { props: { POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'TRUE' } }, { props: { POS_PRODUCT_SIGNING_SECRET: '' } },
    { props: { POS_PRODUCT_SIGNING_SECRET: 'ff'.repeat(32) } }]) {
    const f = fixture(options)
    assert.deepEqual(f.run(f.sign()), rejected)
    assert.equal(f.executions.length, 0); assert.equal(f.configCalls, 0); assert.equal(f.calls.length, 0)
  }
})

test('署名済みdispatchだけを受理し、内外の操作/店舗/利用者と正確な7項目を束縛する', () => {
  const f = fixture()
  for (const body of [f.sign(f.command, { action: 'inspect' }), f.sign(f.command, { action: 'reconcile' }),
    f.sign({ ...f.command, actorId: operationId }), f.sign({ ...f.command, unknown: 'synthetic-private' }),
    f.sign({ ...f.command, expiresAt: undefined }), 'synthetic-private-malformed',
    f.sign().replace('"storeId":7', '"storeId":6'), f.sign().replace(operationId, actorId)]) {
    assert.deepEqual(f.run(body), rejected)
  }
  assert.equal(f.executions.length, 0); assert.equal(f.configCalls, 0); assert.equal(f.calls.length, 0)
})

test('command期限を署名の外側期限内へ制限し、期限切れ/非整数は実行前に止める', () => {
  for (const expiresAt of [now, now - 1, now + 100_001, String(now + 1), null]) {
    const f = fixture()
    assert.deepEqual(f.run(f.sign({ ...f.command, expiresAt }, {}, 100_000)), rejected)
    assert.equal(f.executions.length, 0); assert.equal(f.configCalls, 0)
  }
  const f = fixture()
  assert.equal(f.run(f.sign({ ...f.command, expiresAt: now + 100_000 }, {}, 100_000)).success, true)
})

test('dispatchHashはNodeと同じソートcanonical SHA256で、実行器の業務結果を相関して返す', () => {
  const result = { outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_EXECUTION_RIGHT_UNAVAILABLE', saveRequestStarted: false, responseReceived: false }
  const f = fixture({ executorResult: result })
  assert.deepEqual(f.run(f.sign()), { version: 1, success: true, operationId, actorId, storeId: 7, dispatchHash: digest(f.command), result })
  assert.equal(f.executions.length, 1); assert.equal(typeof f.executions[0].consumer, 'function')
  assert.deepEqual(f.executions[0].command, f.command)
  const reordered = Object.fromEntries(Object.entries(f.command).reverse())
  assert.equal(f.run(f.sign(reordered)).dispatchHash, digest(f.command))
})

test('実行器例外は固定失敗へ変換し、資格情報や例外本文を公開しない', () => {
  const f = fixture({ executorThrows: true })
  assert.deepEqual(f.run(f.sign()), rejected)
  assert.equal(f.executions.length, 1); assert.deepEqual(f.logs, [])
})

test('consume専用フラグ/鍵/固定URLをPOS設定や実行器より先に検査する', () => {
  for (const change of [{ POS_PRODUCT_CONSUME_ENABLED: null }, { POS_PRODUCT_CONSUME_ENABLED: 'TRUE' },
    { POS_PRODUCT_CONSUME_SECRET: '' }, { POS_PRODUCT_CONSUME_SECRET: 'short' }, { POS_PRODUCT_CONSUME_SECRET: 'AA'.repeat(32) },
    ...[undefined, consumeUrl + '/', consumeUrl + '?token=synthetic-private', consumeUrl.replace('vercel.app', 'evil.test'),
      consumeUrl.replace('https:', 'http:')].map(url => ({ POS_PRODUCT_CONSUME_URL: url }))]) {
    const f = fixture({ props: change })
    assert.deepEqual(f.run(f.sign()), rejected)
    assert.throws(() => f.consumer(), consumerRejected)
    assert.equal(f.executions.length, 0); assert.equal(f.configCalls, 0); assert.equal(f.calls.length, 0)
  }
})

test('consume入力は正確な4項目の操作/利用者/店舗/hashで、不正入力は通信しない', () => {
  const f = fixture(), consume = f.consumer()
  for (const input of [null, [], {}, { ...f.input, extra: 'synthetic-private' }, { ...f.input, operationId: 'bad' },
    { ...f.input, actorId: operationId.toUpperCase() }, { ...f.input, storeId: '7' }, { ...f.input, storeId: 8 },
    { ...f.input, dispatchHash: '0'.repeat(63) }, { ...f.input, dispatchHash: 'F'.repeat(64) }]) assert.throws(() => consume(input), consumerRejected)
  assert.equal(f.calls.length, 0)
})

test('consumeはUTF8 HMACの正確な9項目を1POSTし、署名と相関を検証して5項目receiptだけ返す', () => {
  const f = fixture(), received = plain(f.consumer()(f.input))
  assert.deepEqual(received, { ...f.input, accepted: true })
  assert.equal(f.calls.length, 1)
  const { url, request } = f.calls[0], body = JSON.parse(request.payload)
  assert.equal(url, consumeUrl); assert.equal(request.method, 'post'); assert.equal(request.contentType, 'application/json')
  assert.equal(request.followRedirects, false); assert.equal(request.muteHttpExceptions, true)
  assert.equal(request.headers, undefined)
  assert.deepEqual(body, { version: 1, audience: 'kennel.pos-product-consume.v1', ...f.input, issuedAt: now, expiresAt: now + 30_000,
    signature: hmac(JSON.stringify([1, 'kennel.pos-product-consume.v1', operationId, actorId, 7, now, now + 30_000, f.input.dispatchHash])) })
  assert.equal(Object.keys(body).length, 9)
  assert.deepEqual(f.logs, [])
})

test('consume受理falseも署名検証し、再配送のreceiptをそのまま返す', () => {
  const f = fixture(), consume = f.consumer()
  assert.equal(consume(f.input).accepted, true)
  assert.deepEqual(plain(consume(f.input)), { ...f.input, accepted: false })
  assert.equal(f.calls.length, 2)
})

test('consume生成後/POS読取り中/HTTP待機中の停止や鍵・URL更新で旧構成を使わない', () => {
  for (const change of [{ POS_PRODUCT_CONSUME_ENABLED: 'false' }, { POS_PRODUCT_CONSUME_SECRET: 'ef'.repeat(32) },
    { POS_PRODUCT_CONSUME_URL: consumeUrl + '?synthetic-private' }]) {
    const before = fixture(), consume = before.consumer()
    Object.assign(before.props, change)
    assert.throws(() => consume(before.input), consumerRejected)
    assert.equal(before.calls.length, 0)

    const after = fixture({ callbackResponse: request => {
      Object.assign(after.props, change)
      return response(responseFor(request))
    } })
    assert.throws(() => after.consumer()(after.input), consumerRejected)
    assert.equal(after.calls.length, 1)

    const preparing = fixture({ realExecutor: true })
    const fetch = preparing.context.UrlFetchApp.fetch
    preparing.context.UrlFetchApp.fetch = (url, request) => {
      if (url !== consumeUrl) Object.assign(preparing.props, change)
      return fetch(url, request)
    }
    const result = preparing.run(preparing.sign())
    assert.equal(result.result.outcome, 'verification_required'); assert.equal(preparing.saveCount, 0)
    assert.equal(preparing.calls.filter(call => call.url === consumeUrl).length, 0)
  }
})

test('応答の署名/相関/型/余分な鍵は正しいHMACがあっても拒否する', () => {
  const mutations = [body => ({ ...body, version: 2 }), body => ({ ...body, requestSignature: '0'.repeat(64) }),
    body => ({ ...body, signature: '0'.repeat(64) }), body => ({ ...body, extra: 'synthetic-private' }),
    body => ({ ...body, receipt: { ...body.receipt, extra: 'synthetic-private' } }),
    ...[{ operationId: actorId }, { actorId: operationId }, { storeId: 6 }, { dispatchHash: '0'.repeat(64) }, { accepted: 'true' }].map(change => body => {
      const receipt = { ...body.receipt, ...change }
      return { ...body, receipt, signature: hmac(JSON.stringify([1, 'kennel.pos-product-consume-response.v1', body.requestSignature,
        receipt.operationId, receipt.actorId, receipt.storeId, receipt.dispatchHash, receipt.accepted])) }
    })]
  for (const mutate of mutations) {
    const f = fixture({ callbackResponse: request => response(mutate(responseFor(request))) })
    assert.throws(() => f.consumer()(f.input), consumerRejected)
    assert.equal(f.calls.length, 1)
  }
})

test('転送/非200/HTML/JSON欠損/巨大応答は再送せず固定エラーで拒否する', () => {
  for (const callbackResponse of [request => response(responseFor(request), 302), request => response(responseFor(request), 307),
    request => response(responseFor(request), 500), request => response(responseFor(request), 200, 'text/html'),
    () => response('<html>synthetic-private</html>'), () => response(null), () => response('{}'),
    () => response('x'.repeat(4097)), () => response('あ'.repeat(1366))]) {
    const f = fixture({ callbackResponse })
    assert.throws(() => f.consumer()(f.input), consumerRejected)
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].request.followRedirects, false)
  }
  const f = fixture({ callbackThrows: true })
  assert.throws(() => f.consumer()(f.input), consumerRejected); assert.equal(f.calls.length, 1)
})

test('不正な時計値や30秒応答待ちで期限切れならreceiptを返さない', () => {
  for (const clock of [() => NaN, () => Number.MAX_SAFE_INTEGER, () => -1]) {
    const f = fixture({ clock })
    assert.throws(() => f.consumer()(f.input), consumerRejected); assert.equal(f.calls.length, 0)
  }
  let time = now
  const f = fixture({ clock: () => time, callbackResponse: request => { time += 30_000; return response(responseFor(request)) } })
  assert.throws(() => f.consumer()(f.input), consumerRejected); assert.equal(f.calls.length, 1)
})

test('実際のGAS実行器は両検索後のconsumeを検証し、保存1回と結果照合へ進む', () => {
  const f = fixture({ realExecutor: true }), output = f.run(f.sign())
  assert.equal(output.success, true); assert.equal(output.dispatchHash, digest(f.command))
  assert.equal(output.result.outcome, 'values_verified'); assert.equal(output.result.saveRequestStarted, true)
  assert.equal(f.saveCount, 1); assert.equal(f.calls.filter(call => call.url === consumeUrl).length, 1)
  assert.ok(f.events.indexOf('consume') < f.events.indexOf('save'))
  assert.doesNotMatch(JSON.stringify(output), /synthetic-private|Cookie|imageFileName|既存画像|jsessionid|password/)
})

test('実際の実行器でconsume拒否/改ざん/切断は保存0回、再配送は既存保存を再送しない', () => {
  for (const options of [{ accepted: false }, { callbackThrows: true },
    { callbackResponse: request => response({ ...responseFor(request), signature: '0'.repeat(64) }) }]) {
    const f = fixture({ realExecutor: true, ...options }), output = f.run(f.sign())
    assert.equal(output.success, true); assert.equal(output.result.outcome, 'verification_required')
    assert.equal(output.result.saveRequestStarted, false); assert.equal(f.saveCount, 0)
    assert.equal(f.calls.filter(call => call.url === consumeUrl).length, 1)
  }
  const f = fixture({ realExecutor: true })
  assert.equal(f.run(f.sign()).result.outcome, 'values_verified')
  f.retryReads()
  assert.equal(f.run(f.sign()).result.outcome, 'verification_required'); assert.equal(f.saveCount, 1)
  assert.equal(f.calls.filter(call => call.url === consumeUrl).length, 2)
})

test('private保存受付は専用公開分岐だけへ接続し診断/既存同期/ログへ接続しない', () => {
  assert.doesNotMatch(read('gas/posProductEditGateway.js'), /function\s+(?:doPost|doGet|onOpen|onEdit)\b|Logger\.|console\.|DriveApp|SpreadsheetApp/)
  assert.match(read('gas/autoDownload.js'), /POS_PRODUCT_PUBLIC_GATEWAY_ENABLED/)
  assert.match(read('gas/autoDownload.js'), /handlePosProductEditDispatch_/)
  for (const path of ['gas/importCSV.js', 'gas/posProductReadDiagnostic.js', 'gas/posProductInspection.js']) {
    assert.ok(!read(path).includes('handlePosProductEditDispatch_'))
  }
})

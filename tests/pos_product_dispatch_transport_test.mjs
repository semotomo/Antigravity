import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import * as protocol from '../next_app/lib/pos-products/protocol.ts'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'
import * as operations from '../next_app/lib/pos-products/operations.ts'

const require = createRequire(new URL('../next_app/package.json', import.meta.url)), ts = require('typescript')
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const source = read('next_app/lib/pos-products/dispatch-transport.server.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
const now = 1_800_000_000_000, secret = 'a'.repeat(64)
const url = 'https://script.google.com/macros/s/' + 'b'.repeat(40) + '/exec'
const config = { enabled: true, url, secret }
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const failure = 'POSの商品保存結果を確認できません。再送せず、操作状態を確認してください。'
function compile(text, imports, clock = { now: now + 1000 }, env = {}) {
  const module = { exports: {} }
  class Clock extends Date { static now() { return clock.now } }
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Date: Clock, process: { env }, fetch, Response, AbortSignal, Buffer, TextDecoder, Uint8Array, URL, structuredClone,
      require: name => { if (Object.hasOwn(imports, name)) return imports[name]; throw Error('Unexpected import ' + name) } })
  return module.exports
}
const review = compile(read('next_app/lib/pos-products/edit-review.server.ts'), { 'server-only': {}, 'node:crypto': { createHash }, './validation': validation, './identity': identity })
const inspection = compile(read('next_app/lib/pos-products/inspection.server.ts'), { 'server-only': {}, './identity': identity, './edit-review.server': review })
const builder = compile(read('next_app/lib/pos-products/edit-dispatch.server.ts'), { 'server-only': {}, 'node:crypto': { createHash }, './validation': validation, './operations': operations, './edit-review.server': review })
function load(clock = { now: now + 1000 }, env = {}) {
  const http = compile(read('next_app/lib/pos-products/inspection-transport.server.ts'), { 'server-only': {}, './protocol': protocol }, clock, env)
  return compile(source, { 'server-only': {}, 'node:crypto': { createHash }, './protocol': protocol,
    './inspection-transport.server': http, './inspection.server': inspection, './edit-review.server': review }, clock, env)
}
function fixture(storeId = 6) {
  const snapshot = { storeId, productId: 42, janCode: '0490123456789', capturedAt: now - 1000, complete: true,
    identity: { posProductId: 'fixture-pos-' + storeId, officeId: storeId === 6 ? '11054' : '11053', groupId: storeId === 6 ? '11099' : '11098', salesKind: 'retail', productCode: '', manufacturerCode: '0490123456789', exclusiveStore: true },
    fields: { name: '旧名', groupId: 'g' + storeId, price: '126', cost: '75', supplierId: null },
    settings: { nameKana: 'キュウメイ', abbreviation: '既存略称', taxId: '0', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'c'.repeat(64) } }
  const inspected = { snapshot, fingerprint: review.fingerprintProductEditSnapshot(snapshot, now),
    choices: { storeId, salesKind: 'retail', groupIds: ['g' + storeId], supplierIds: ['s' + storeId] }, groups: [{ id: 'g' + storeId, name: '店舗分類' }], suppliers: [{ id: 's' + storeId, name: '仕入先' }] }
  const command = validation.parsePosProductCommand({ kind: 'update', operationId, storeId, productId: 42, expectedFingerprint: inspected.fingerprint, fields: { ...snapshot.fields, name: '新名' } })
  const expected = review.buildProductEditReview(command, snapshot, inspected.choices, now)
  return plain(builder.buildProductEditDispatch({ operationId, actorId, storeId, payloadHash: hash(JSON.stringify(command)), status: 'prepared', version: 0, sendAttempts: 0, expectedResultFingerprint: expected.expectedResultFingerprint, verifiedFingerprint: null }, command, inspected, now))
}
function rebound(value) { value.dispatchText = canonical(value.command); value.dispatchHash = hash(value.dispatchText); return value }
function rawInspection(record, capturedAt = now + 1001) {
  const snapshot = record.review.expectedSnapshot
  const formInspection = { identity: snapshot.identity, fields: snapshot.fields, settings: snapshot.settings, groups: record.command.before.groups, suppliers: record.command.before.suppliers }
  return { storeId: record.command.storeId, janCode: record.command.janCode, capturedAt, searches: ['schGoodsId', 'schMakerCd'].map(field => ({ field, count: 1, inspected: true,
    internalId: snapshot.identity.posProductId, internalIdPresent: true, salesKind: '2', storeGroupId: snapshot.identity.groupId,
    productCodeMatches: snapshot.identity.productCode === record.command.janCode, manufacturerCodeMatches: snapshot.identity.manufacturerCode === record.command.janCode, formInspection: plain(formInspection) })) }
}
function envelope(record, changes = {}, result = { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_DISABLED', saveRequestStarted: false, responseReceived: false }) {
  return { version: 1, success: true, operationId: record.command.operationId, actorId: record.command.actorId, storeId: record.command.storeId, dispatchHash: record.dispatchHash, result, ...changes }
}
const rejectSafely = promise => assert.rejects(promise, error => error.message === failure)

test('両店舗の固定本文を署名POSTし、外側の期限とpayload hashも保存済み本文に束縛する', async () => {
  for (const storeId of [6, 7]) {
    const record = fixture(storeId), calls = []
    const dispatcher = load().createSignedPosProductDispatcher(config, async (destination, options) => {
      calls.push([destination, options])
      const signed = JSON.parse(options.body), verified = protocol.verifyPosProductRequest(options.body, secret, now + 1000)
      assert.equal(verified.action, 'dispatch'); assert.equal(verified.operationId, operationId); assert.equal(verified.actorId, actorId); assert.equal(verified.storeId, storeId)
      assert.equal(signed.issuedAt, now + 1000); assert.equal(signed.expiresAt, record.command.expiresAt)
      assert.equal(signed.payload, record.dispatchText); assert.equal(signed.payloadHash, record.dispatchHash)
      return Response.json(envelope(record))
    })
    assert.equal((await dispatcher.dispatch(record)).outcome, 'not_sent')
    assert.equal(calls.length, 1); assert.equal(calls[0][0], url); assert.equal(calls[0][1].redirect, 'manual'); assert.equal(calls[0][1].cache, 'no-store'); assert.ok(calls[0][1].signal)
    assert.equal(record.command.expiresAt, now + 120000)
  }
})

test('既知GAS結果転送へは本文・署名ヘッダーなしGETを一度だけ行う', async () => {
  const record = fixture(), calls = [], redirect = 'https://script.googleusercontent.com/macros/echo?user_content_key=fixture&lib=fixture'
  const dispatcher = load().createSignedPosProductDispatcher(config, async (destination, options) => {
    calls.push([destination, options]); return calls.length === 1 ? new Response(null, { status: 303, headers: { location: redirect } }) : Response.json(envelope(record))
  })
  await dispatcher.dispatch(record); assert.equal(calls.length, 2)
  assert.equal(calls[1][0], redirect); assert.equal(calls[1][1].method, 'GET'); assert.equal(calls[1][1].body, undefined); assert.equal(calls[1][1].headers, undefined); assert.equal(calls[0][1].signal, calls[1][1].signal)
})

test('OFF・不正URL/鍵・環境設定欠落を生成時に拒否する', () => {
  const api = load()
  for (const invalid of [{ ...config, enabled: false }, { ...config, enabled: 'true' }, { ...config, secret: '' }, { ...config, secret: 'A'.repeat(64) }, { ...config, url: url + '?private=secret' }, { ...config, url: url.replace('script.google.com', 'evil.test') }]) assert.throws(() => api.createSignedPosProductDispatcher(invalid), error => error.message === failure)
  assert.throws(() => api.configuredPosProductDispatcher(), error => error.message === failure)
  assert.throws(() => load(undefined, { POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'false', POS_PRODUCT_EDIT_GAS_URL: url, POS_PRODUCT_SIGNING_SECRET: secret }).configuredPosProductDispatcher())
  assert.equal(typeof load(undefined, { POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'true', POS_PRODUCT_EDIT_GAS_URL: url, POS_PRODUCT_SIGNING_SECRET: secret }).configuredPosProductDispatcher().dispatch, 'function')
})

test('期限切れ・期限延長・不正command・hash/canonical不一致は通信前に拒否する', async () => {
  let calls = 0
  const dispatcher = load().createSignedPosProductDispatcher(config, async () => { calls++; throw Error('private') })
  const changes = [r => { r.command.expiresAt = now + 1000; rebound(r) }, r => { r.command.expiresAt += 1; rebound(r) },
    r => { r.command.operationId = 'bad'; rebound(r) }, r => { r.command.actorId = 'bad'; rebound(r) }, r => { r.command.storeId = 8; rebound(r) },
    r => { r.command.janCode = 490123456789; rebound(r) }, r => { r.command.extra = 'private'; rebound(r) }, r => { r.command.before.extra = 'private'; rebound(r) },
    r => { r.command.patch.unknown = 'private'; rebound(r) }, r => { r.command.patch = {}; rebound(r) }, r => { r.command.patch.goodsName = 'x'.repeat(1001); rebound(r) },
    r => { r.command.before.identity.posProductId = 'different'; rebound(r) }, r => { r.command.before.groups[0].extra = 'private'; rebound(r) },
    r => { r.dispatchHash = '0'.repeat(64) }, r => { r.dispatchText = JSON.stringify(r.command); r.dispatchHash = hash(r.dispatchText) },
    r => { r.command.before.fields.name = 'changed' }, r => { r.review.expectedSnapshot.productId = 43 }, r => { r.review.expectedSnapshot.fields.name = 'changed' },
    r => { r.beforeFingerprintText = 'private' }, r => { r.review.reviewedAt++ }]
  for (const mutate of changes) { const record = fixture(); mutate(record); await rejectSafely(() => dispatcher.dispatch(record)) }
  assert.equal(calls, 0)
})

test('16KB上限は文字数ではなく署名payloadのUTF-8 bytesで判定する', async () => {
  let calls = 0
  const record = fixture(), dispatcher = load().createSignedPosProductDispatcher(config, async () => { calls++; throw Error('private') })
  record.command.before.groups.push(...Array.from({ length: 8 }, (_, i) => ({ id: 'extra' + i, name: '長'.repeat(700) })))
  rebound(record); assert.ok(record.dispatchText.length < 16384); assert.ok(Buffer.byteLength(record.dispatchText) > 16384)
  await rejectSafely(() => dispatcher.dispatch(record)); assert.equal(calls, 0)
})

test('署名payloadが16KBちょうどなら送信でき、1 byte超過は送信前に拒否する', async () => {
  const record = fixture()
  while (Buffer.byteLength(canonical(record.command)) < 16384) {
    record.command.before.groups.push({ id: 'boundary-' + record.command.before.groups.length, name: 'x'.repeat(1000) })
  }
  const last = record.command.before.groups.at(-1), overflow = Buffer.byteLength(canonical(record.command)) - 16384
  last.name = last.name.slice(0, last.name.length - overflow)
  rebound(record); assert.equal(Buffer.byteLength(record.dispatchText), 16384)
  let calls = 0
  const dispatcher = load().createSignedPosProductDispatcher(config, async () => { calls++; return Response.json(envelope(record)) })
  assert.equal((await dispatcher.dispatch(record)).outcome, 'not_sent'); assert.equal(calls, 1)
  last.name += 'x'; rebound(record); await rejectSafely(() => dispatcher.dispatch(record)); assert.equal(calls, 1)
})

test('通信中の呼出し側変更は送信本文や応答相関の固定値を変更しない', async () => {
  const record = fixture(), expected = plain(record)
  const dispatcher = load().createSignedPosProductDispatcher(config, async (_destination, options) => {
    record.command.actorId = operationId; record.command.storeId = 7; record.dispatchHash = '0'.repeat(64)
    assert.equal(JSON.parse(options.body).payload, expected.dispatchText)
    return Response.json(envelope(expected))
  })
  assert.equal((await dispatcher.dispatch(record)).outcome, 'not_sent')
})

test('executorに存在する結果コードと通信不確実性だけを受理する', async () => {
  const record = fixture()
  const results = [
    ...['DISABLED', 'CONSUMER_UNAVAILABLE', 'INVALID_REQUEST', 'PREPARE_REJECTED', 'EXECUTION_WINDOW_CLOSED'].map(code => ({ outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_' + code, saveRequestStarted: false, responseReceived: false })),
    ...['EXECUTION_RIGHT_UNAVAILABLE', 'EXECUTION_WINDOW_CLOSED'].map(code => ({ outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_' + code, saveRequestStarted: false, responseReceived: false })),
    ...[false, true].map(responseReceived => ({ outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_VERIFY_REQUIRED', saveRequestStarted: true, responseReceived })),
  ]
  for (const result of results) {
    const dispatcher = load().createSignedPosProductDispatcher(config, async () => Response.json(envelope(record, {}, result)))
    assert.deepEqual(plain(await dispatcher.dispatch(record)), result)
  }
})

test('values_verifiedは対象商品の新しい両検索DTOを厳格decodeして観測値だけ返す', async () => {
  for (const responseReceived of [false, true]) {
    const record = fixture(7), result = { outcome: 'values_verified', code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED', saveRequestStarted: true, responseReceived, inspection: rawInspection(record) }
    const dispatcher = load().createSignedPosProductDispatcher(config, async () => Response.json(envelope(record, {}, result)))
    const observed = await dispatcher.dispatch(record)
    assert.equal(observed.inspection.snapshot.productId, 42); assert.equal(observed.inspection.snapshot.identity.posProductId, 'fixture-pos-7')
    assert.equal(observed.inspection.fingerprint, record.review.expectedResultFingerprint)
    assert.equal(Object.hasOwn(observed, 'completed'), false); assert.equal(Object.hasOwn(observed, 'status'), false)
  }
})

test('別操作/actor/店舗/hash・未知結果/コード/鍵・壊れたflagsを応答後に拒否し再送しない', async () => {
  const record = fixture()
  const invalid = [
    ...[{ version: 2 }, { success: false }, { operationId: actorId }, { actorId: operationId }, { storeId: 7 }, { dispatchHash: '0'.repeat(64) }, { extra: 'private' }, { janCode: record.command.janCode }].map(change => envelope(record, change)),
    ...[{ outcome: 'completed' }, { code: 'private' }, { saveRequestStarted: true }, { responseReceived: true }, { responseReceived: 0 }, { inspection: rawInspection(record) }, { extra: 'private' }].map(change => envelope(record, {}, { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_DISABLED', saveRequestStarted: false, responseReceived: false, ...change })),
    envelope(record, {}, { outcome: 'values_verified', code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED', saveRequestStarted: true, responseReceived: true }),
    envelope(record, {}, { outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_VERIFY_REQUIRED', saveRequestStarted: false, responseReceived: false }),
    envelope(record, {}, { outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_DISABLED', saveRequestStarted: false, responseReceived: false }),
  ]
  for (const response of invalid) {
    let calls = 0; const dispatcher = load().createSignedPosProductDispatcher(config, async () => { calls++; return Response.json(response) })
    await rejectSafely(() => dispatcher.dispatch(record)); assert.equal(calls, 1)
  }
})

test('確認済みinspectionの他店舗/JAN/内部ID/値/余分な項目・古い時刻を拒否する', async () => {
  const record = fixture()
  for (const mutate of [value => { value.storeId = 7 }, value => { value.janCode = '9999999999999' }, value => { value.capturedAt = now + 1000 },
    value => { value.extra = 'private' }, value => { value.searches[0].formInspection.fields.name = 'different' }, value => { value.searches[0].formInspection.extra = 'private' },
    value => { for (const search of value.searches) { search.internalId = 'different'; search.formInspection.identity.posProductId = 'different' } }]) {
    const inspected = rawInspection(record); mutate(inspected)
    let calls = 0
    const dispatcher = load().createSignedPosProductDispatcher(config, async () => { calls++; return Response.json(envelope(record, {}, { outcome: 'values_verified', code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED', saveRequestStarted: true, responseReceived: true, inspection: inspected })) })
    await rejectSafely(() => dispatcher.dispatch(record)); assert.equal(calls, 1)
  }
})

test('HTTP失敗・timeout・HTML/巨大/不正JSON・未知転送で本文を再送しない', async () => {
  const record = fixture()
  const responses = [() => { throw Error('private-secret-cookie') }, () => { throw new DOMException('private', 'TimeoutError') },
    () => new Response('private', { status: 500 }), () => new Response('private', { headers: { 'content-type': 'text/html' } }),
    () => new Response('x'.repeat(524289), { headers: { 'content-type': 'application/json' } }),
    () => new Response('private', { headers: { 'content-type': 'application/json' } }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.test/macros/echo' } }),
    () => new Response(null, { status: 307, headers: { location: 'https://script.googleusercontent.com/macros/echo' } })]
  for (const response of responses) {
    let calls = 0; const dispatcher = load().createSignedPosProductDispatcher(config, async () => { calls++; return response() })
    await rejectSafely(() => dispatcher.dispatch(record)); assert.equal(calls, 1)
  }
  let calls = 0
  const twice = load().createSignedPosProductDispatcher(config, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?lib=fixture' } }) })
  await rejectSafely(() => twice.dispatch(record)); assert.equal(calls, 2)
})

test('送信モジュールは公開Action/claim/register/consume/DB完了処理を持たない', () => {
  assert.match(source, /import ['"]server-only['"]/)
  assert.doesNotMatch(source, /['"]use server['"]|claimProductOperation|registerProductEditDispatch|consumeProductEditDispatch|recordProductOperationResult|createClient|\.rpc\(/)
})

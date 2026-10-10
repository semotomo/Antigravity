import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'
import * as operations from '../next_app/lib/pos-products/operations.ts'

const require = createRequire(new URL('../next_app/package.json', import.meta.url)), ts = require('typescript')
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const source = read('next_app/lib/pos-products/edit-execution.server.ts')
const plain = value => JSON.parse(JSON.stringify(value)), hash = text => createHash('sha256').update(text).digest('hex')
const now = 1_800_000_000_000, operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const failure = '商品操作の保存結果を確認できません。再送せず、操作状態を確認してください。'
function compile(text, imports, env = {}, clock = { now: now + 1000 }) {
  const module = { exports: {} }
  class Clock extends Date { static now() { return clock.now } }
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Buffer, structuredClone, Date: Clock, process: { env }, require: name => {
      if (Object.hasOwn(imports, name)) return imports[name]; throw Error('Unexpected import ' + name)
    } })
  return module.exports
}
const reviewApi = compile(read('next_app/lib/pos-products/edit-review.server.ts'), { 'server-only': {}, 'node:crypto': { createHash }, './validation': validation, './identity': identity })
const inspectionApi = compile(read('next_app/lib/pos-products/inspection.server.ts'), { 'server-only': {}, './identity': identity, './edit-review.server': reviewApi })
const dispatchApi = compile(read('next_app/lib/pos-products/edit-dispatch.server.ts'), { 'server-only': {}, 'node:crypto': { createHash }, './validation': validation, './operations': operations, './edit-review.server': reviewApi })
const authApi = compile(read('next_app/lib/inventory/auth.ts'), {})
function fixed(storeId = 6) {
  const snapshot = { storeId, productId: 42, janCode: '0490123456789', capturedAt: now - 1000, complete: true,
    identity: { posProductId: 'private-pos-' + storeId, officeId: storeId === 6 ? '11054' : '11053', groupId: storeId === 6 ? '11099' : '11098', salesKind: 'retail', productCode: '', manufacturerCode: '0490123456789', exclusiveStore: true },
    fields: { name: '旧名', groupId: 'g' + storeId, price: '126', cost: '75', supplierId: null },
    settings: { nameKana: 'キュウメイ', abbreviation: '保持する略称', taxId: '0', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'c'.repeat(64) } }
  const inspection = { snapshot, fingerprint: reviewApi.fingerprintProductEditSnapshot(snapshot, now), choices: { storeId, salesKind: 'retail', groupIds: ['g' + storeId], supplierIds: ['s' + storeId] }, groups: [{ id: 'g' + storeId, name: '分類' }], suppliers: [{ id: 's' + storeId, name: '仕入先' }] }
  const command = validation.parsePosProductCommand({ kind: 'update', operationId, storeId, productId: 42, expectedFingerprint: inspection.fingerprint, fields: { ...snapshot.fields, name: '新名' } })
  const review = reviewApi.buildProductEditReview(command, snapshot, inspection.choices, now)
  const operation = { operationId, actorId, storeId, payloadHash: hash(JSON.stringify(command)), status: 'prepared', version: 0, sendAttempts: 0, expectedResultFingerprint: review.expectedResultFingerprint, verifiedFingerprint: null }
  return plain({ operation, dispatch: dispatchApi.buildProductEditDispatch(operation, command, inspection, now), receiptConsumedAt: null })
}
function dtoInspection(stored, capturedAt = now + 1001, mutate = () => {}) {
  const expected = plain(stored.dispatch.review.expectedSnapshot)
  mutate(expected)
  const formInspection = { identity: expected.identity, fields: expected.fields, settings: expected.settings, groups: stored.dispatch.command.before.groups, suppliers: stored.dispatch.command.before.suppliers }
  return { storeId: stored.operation.storeId, janCode: expected.janCode, capturedAt, searches: ['schGoodsId', 'schMakerCd'].map(field => ({ field, count: 1, inspected: true, internalId: expected.identity.posProductId,
    internalIdPresent: true, salesKind: '2', storeGroupId: expected.identity.groupId, productCodeMatches: expected.identity.productCode === expected.janCode, manufacturerCodeMatches: expected.identity.manufacturerCode === expected.janCode, formInspection: plain(formInspection) })) }
}
function harness(options = {}) {
  const calls = [], clock = { now: now + 1000 }, stored = fixed(options.storeId ?? 6)
  const auth = { actorId, manager: true, loggedIn: true, checks: 0 }, product = { id: 42, store_id: stored.operation.storeId, jan_code: '0490123456789' }
  const env = Object.fromEntries(['EDITOR', 'WRITES', 'DISPATCH', 'CONSUME', 'EDIT_GATEWAY', 'EDIT_EXECUTION', 'INSPECTION'].map(name => ['POS_PRODUCT_' + name + '_ENABLED', 'true']))
  const client = { auth: { getUser: async () => { calls.push('auth'); auth.checks++; options.onAuth?.({ auth, env, product, stored, calls }); return { data: { user: auth.loggedIn ? { id: auth.actorId } : null }, error: null } } }, from: table => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'user_store_access' ? auth.manager ? { role: 'manager' } : null : plain(product), error: null }) }; return query
  } }
  const authorize = async () => { const user = await authApi.requireInventoryManagerAccess(client, stored.operation.storeId); if (user.id !== stored.operation.actorId) throw Error('private-actor'); return user }
  const bound = op => { operations.assertSameProductOperation(op, stored.operation); assert.equal(op.version, stored.operation.version); assert.equal(op.expectedResultFingerprint, stored.operation.expectedResultFingerprint) }
  const advance = event => { stored.operation = plain(operations.advanceProductOperation(stored.operation, { ...event, expectedVersion: stored.operation.version })); return plain(stored.operation) }
  const ledger = {
    loadProductEditDispatchRecovery: async (storeId, id) => { calls.push('load'); await authorize(); assert.equal(storeId, stored.operation.storeId); assert.equal(id, operationId); options.onLoad?.(stored, calls); return plain(stored) },
    claimProductOperation: async op => { calls.push('claim'); await authorize(); bound(op); advance({ type: 'claim_dispatch' }); options.onClaim?.({ stored, auth, env, product, calls }); if (options.claimLost) throw Error('private-claim'); return { claimed: !options.claimFalse, operation: plain(stored.operation) } },
    recordProductOperationResult: async (op, event) => { calls.push('event:' + event.type); await authorize(); bound(op); if (env.POS_PRODUCT_WRITES_ENABLED !== 'true') throw Error('private-disabled'); const result = advance(event); if (options.eventLost === event.type) throw Error('private-event'); return result },
    recordProductEditVerification: async (op, review, actual, at) => { calls.push('verify'); await authorize(); bound(op); const fingerprint = reviewApi.verifyProductEditResult(review, actual, at); const result = advance({ type: 'pos_verified', fingerprint }); if (options.verificationLost) throw Error('private-verification'); return result },
    applyProductEditToDatabase: async op => { calls.push('apply'); await authorize(); bound(op); if (options.databaseFails) throw Error('private-database'); const result = advance({ type: 'db_completed' }); if (options.databaseLost) throw Error('private-database-response'); return result },
    resolveProductEditNotSent: async (op, dispatch, proof) => {
      calls.push('resolve-not-sent'); await authorize(); bound(op)
      assert.equal(dispatch.dispatchHash, stored.dispatch.dispatchHash); assert.equal(proof, 'synthetic-signed-proof')
      if (stored.receiptConsumedAt !== null || options.proofRejected) throw Error('private-proof-rejected')
      stored.operation = { ...stored.operation, status: 'not_sent', version: stored.operation.version + 1 }
      if (options.proofResponseLost) throw Error('private-response-lost')
      return plain(stored.operation)
    },
  }
  const dispatcher = { dispatch: async record => { calls.push('dispatch'); assert.equal(record.dispatchText, stored.dispatch.dispatchText); assert.equal(record.command.expiresAt, now + 120000); if (options.consume !== false) stored.receiptConsumedAt = clock.now;
    options.onDispatch?.({ stored, auth, env, product, calls }); if (options.dispatchFails) throw Error('private-cookie'); return options.observation ?? { outcome: 'values_verified', code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED', saveRequestStarted: true, responseReceived: true, inspection: { private: 'never-trust-this' } } } }
  const inspector = { inspect: async target => { calls.push('inspect'); assert.equal(target.actorId, actorId); assert.equal(target.storeId, stored.operation.storeId); assert.equal(target.janCode, product.jan_code); options.onInspect?.({ stored, auth, env, product, calls }); if (options.inspectFails) throw Error('private-inspection'); return dtoInspection(stored, options.capturedAt ?? clock.now + 1, options.changeActual) } }
  const api = compile(source, { 'server-only': {}, '@/lib/supabase/server': { createClient: async () => client }, '@/lib/inventory/auth': authApi,
    './ledger.server': ledger, './operations': operations, './edit-review.server': reviewApi, './inspection.server': inspectionApi,
    './dispatch-transport.server': { configuredPosProductDispatcher: () => { calls.push('dispatcher-config'); return dispatcher } },
    './inspection-transport.server': { configuredPosProductInspector: () => { calls.push('inspector-config'); return inspector } } }, env, clock)
  const request = { storeId: stored.operation.storeId, operationId }
  function status(value) { const verified = ['pos_confirmed', 'db_pending', 'completed'].includes(value); stored.operation = { ...stored.operation, status: value, version: value === 'prepared' ? 0 : 3, sendAttempts: ['prepared', 'rejected'].includes(value) ? 0 : 1, verifiedFingerprint: verified ? stored.operation.expectedResultFingerprint : null }; if (stored.operation.sendAttempts) stored.receiptConsumedAt = now + 500 }
  return { api, stored, calls, auth, env, product, clock, options, request, status, dispatcher, inspector }
}
const mutations = calls => calls.filter(call => ['claim', 'dispatch', 'verify', 'apply'].includes(call) || call.startsWith('event:'))
const safelyReject = promise => assert.rejects(promise, error => error.message === failure)

test('監査済み終端not_sentの再読込みは署名を断定せず、読取りだけで入力と同じ操作を保つ', async () => {
  const f = harness()
  f.status('not_sent'); f.stored.receiptConsumedAt = null
  const before = plain(f.stored), result = await f.api.loadProductEditExecution(f.request)
  assert.equal(result.status, 'not_sent'); assert.equal(result.operationId, operationId)
  assert.equal(result.sendAttempts, 1); assert.equal(result.nextAction, 'none')
  assert.match(result.message, /保存前に停止したことを確認済み/)
  assert.doesNotMatch(result.message, /署名/)
  assert.deepEqual(f.stored, before); assert.deepEqual(f.calls, ['load', 'auth'])
})

test('署名付き未送信の終了は入力/送信回数を維持し、保存/独立POS検査/DB反映を再実行しない', async () => {
  for (const proofResponseLost of [false, true]) {
    const f = harness({ consume: false, proofResponseLost, observation: { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_PREPARE_REJECTED',
      saveRequestStarted: false, responseReceived: false, proofText: 'synthetic-signed-proof' } })
    const dispatchText = f.stored.dispatch.dispatchText, result = await f.api.executePreparedProductEdit(f.request)
    assert.equal(result.status, 'not_sent'); assert.equal(result.stage, 'not_sent'); assert.equal(result.sendAttempts, 1)
    assert.equal(result.nextAction, 'none'); assert.equal(result.posValuesVerified, null)
    assert.equal(f.calls.filter(call => call === 'resolve-not-sent').length, 1)
    assert.equal(f.calls.includes('inspect'), false); assert.equal(f.calls.includes('apply'), false)
    assert.equal(f.stored.dispatch.dispatchText, dispatchText)
    assert.doesNotMatch(JSON.stringify(result), /synthetic-signed-proof|dispatchHash|requestSignature|private/)
    await f.api.executePreparedProductEdit(f.request); await f.api.loadProductEditExecution(f.request)
    assert.equal(f.calls.filter(call => call === 'dispatch').length, 1); assert.equal(f.calls.includes('inspect'), false)
  }
})

test('未送信証拠の拒否/consume競合ではuncertainと同じ操作IDを維持する', async () => {
  for (const options of [{ consume: true }, { consume: false, proofRejected: true }]) {
    const f = harness({ ...options, observation: { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_PREPARE_REJECTED',
      saveRequestStarted: false, responseReceived: false, proofText: 'synthetic-signed-proof' } })
    const result = await f.api.executePreparedProductEdit(f.request)
    assert.equal(result.status, 'uncertain'); assert.equal(result.sendAttempts, 1); assert.equal(result.operationId, operationId)
    assert.equal(f.calls.filter(call => call === 'dispatch').length, 1); assert.equal(f.calls.includes('inspect'), false)
    assert.equal(f.calls.includes('event:reject_before_dispatch'), false)
  }
})

test('両店舗で固定記録をclaim一度→送信一度→独立POS検査→台帳確認→DB反映する', async () => {
  for (const storeId of [6, 7]) {
    const f = harness({ storeId }), result = await f.api.executePreparedProductEdit(f.request)
    assert.equal(result.stage, 'completed'); assert.equal(result.posValuesVerified, true)
    assert.deepEqual(mutations(f.calls), ['claim', 'dispatch', 'event:dispatch_returned', 'verify', 'apply'])
    assert.equal(f.calls.filter(call => call === 'inspect').length, 1)
    assert.deepEqual(Object.keys(result).sort(), ['storeId', 'operationId', 'status', 'version', 'sendAttempts', 'stage', 'nextAction', 'posValuesVerified', 'expiresAt', 'message'].sort())
    assert.doesNotMatch(JSON.stringify(result), /private-pos|payloadHash|dispatchHash|before|actorId|never-trust/)
    const replay = await f.api.executePreparedProductEdit(f.request); assert.equal(replay.stage, 'completed'); assert.equal(f.calls.filter(call => call === 'dispatch').length, 1)
  }
})

test('公開入力はstoreId+operationIdだけで、商品・actor・review・modeを受け付けない', async () => {
  const f = harness()
  for (const input of [null, [], { ...f.request, productId: 42 }, { ...f.request, actorId }, { ...f.request, review: {} }, { ...f.request, mode: 'save' }, { ...f.request, storeId: 8 }, { ...f.request, operationId: 'bad' }]) {
    await safelyReject(() => f.api.executePreparedProductEdit(input)); await safelyReject(() => f.api.loadProductEditExecution(input))
  }
  assert.equal(f.calls.length, 0)
})

test('初回送信の各フラグOFF/未設定ではclaim/送信しない', async () => {
  for (const flag of ['EDITOR', 'WRITES', 'DISPATCH', 'CONSUME', 'EDIT_GATEWAY', 'EDIT_EXECUTION']) {
    for (const value of [undefined, 'false']) {
      const f = harness(); if (value === undefined) delete f.env['POS_PRODUCT_' + flag + '_ENABLED']; else f.env['POS_PRODUCT_' + flag + '_ENABLED'] = value
      await safelyReject(() => f.api.executePreparedProductEdit(f.request)); assert.deepEqual(mutations(f.calls), [])
    }
  }
})

test('manager/ログイン/本人・DB店舗/商品/JANが変わるとclaim前に停止する', async () => {
  for (const mutate of [f => { f.auth.manager = false }, f => { f.auth.loggedIn = false }, f => { f.auth.actorId = operationId }, f => { f.product.store_id = 7 }, f => { f.product.id = 43 }, f => { f.product.jan_code = '9999999999999' }]) {
    const f = harness(); mutate(f); await safelyReject(() => f.api.executePreparedProductEdit(f.request)); assert.deepEqual(mutations(f.calls), [])
  }
})

test('固定記録なし・期限切れ・review/operation不一致はclaim/再登録/再prepareしない', async () => {
  for (const mutate of [f => { f.stored.dispatch = null }, f => { f.clock.now = now + 120000 }, f => { f.stored.dispatch.review.operationId = actorId }, f => { f.stored.dispatch.review.expectedSnapshot.productId = 43 }, f => { f.stored.operation.expectedResultFingerprint = 'd'.repeat(64) }]) {
    const f = harness(); mutate(f); await safelyReject(() => f.api.executePreparedProductEdit(f.request)); assert.deepEqual(mutations(f.calls), [])
  }
})

test('claimfalse/claim応答消失は送信・独立検査・DB反映へ進まず状態だけ返す', async () => {
  for (const options of [{ claimFalse: true }, { claimLost: true }]) {
    const f = harness(options), result = await f.api.executePreparedProductEdit(f.request)
    assert.equal(result.sendAttempts, 1); assert.equal(result.stage, 'dispatching'); assert.deepEqual(mutations(f.calls), ['claim']); assert.equal(f.calls.includes('inspect'), false)
    await f.api.executePreparedProductEdit(f.request); assert.equal(f.calls.filter(call => call === 'claim').length, 1); assert.equal(f.calls.includes('dispatch'), false); assert.equal(f.calls.includes('apply'), false)
  }
})

test('claim後の権限・商品/JAN・フラグ変化でも保存POSTを開始しない', async () => {
  for (const onClaim of [({ auth }) => { auth.manager = false }, ({ product }) => { product.jan_code = '9999999999999' }, ({ env }) => { env.POS_PRODUCT_EDIT_EXECUTION_ENABLED = 'false' }]) {
    const f = harness({ onClaim }); await safelyReject(() => f.api.executePreparedProductEdit(f.request)); assert.equal(f.calls.filter(call => call === 'claim').length, 1); assert.equal(f.calls.includes('dispatch'), false); assert.equal(f.stored.operation.sendAttempts, 1)
  }
})

test('送信timeout/未知結果ではuncertainを残して自動照合/再送/予約解除しない', async () => {
  for (const options of [{ dispatchFails: true }, { observation: { outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_VERIFY_REQUIRED', saveRequestStarted: true, responseReceived: false } }, { observation: { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_DISABLED', saveRequestStarted: false, responseReceived: false }, consume: false }]) {
    const f = harness(options), result = await f.api.executePreparedProductEdit(f.request)
    assert.equal(result.stage, 'verification_required'); assert.equal(result.status, 'uncertain'); assert.deepEqual(mutations(f.calls), ['claim', 'dispatch', 'event:outcome_unknown']); assert.equal(f.calls.includes('inspect'), false)
    assert.equal(f.stored.operation.sendAttempts, 1); assert.equal(f.calls.includes('event:reject_before_dispatch'), false)
  }
})

test('応答不明後は読取り復旧だけでは台帳更新せず、明示verifyで独立値確認してDBへ進む', async () => {
  const f = harness({ dispatchFails: true }); await f.api.executePreparedProductEdit(f.request)
  const count = mutations(f.calls).length, read = await f.api.loadProductEditExecution(f.request)
  assert.equal(read.stage, 'verification_required'); assert.equal(read.posValuesVerified, true); assert.equal(mutations(f.calls).length, count)
  const verified = await f.api.executePreparedProductEdit(f.request)
  assert.equal(verified.stage, 'completed'); assert.equal(f.calls.filter(call => call === 'dispatch').length, 1); assert.equal(f.calls.filter(call => call === 'claim').length, 1)
})

test('dispatcherの成功/inspectionだけでは確定せず、独立POS不一致ではDBを書かない', async () => {
  const f = harness({ changeActual: snapshot => { snapshot.fields.cost = '74' } }), result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'verification_required'); assert.equal(result.posValuesVerified, false); assert.equal(f.calls.includes('verify'), false); assert.equal(f.calls.includes('apply'), false)
  assert.equal(f.stored.operation.status, 'verifying')
})

test('独立POS取得失敗・古い値・別内部IDをPOS確認済みとして記録しない', async () => {
  for (const options of [{ inspectFails: true }, { capturedAt: now - 1000 }, { changeActual: snapshot => { snapshot.identity.posProductId = 'other' } }]) {
    const f = harness(options), result = await f.api.executePreparedProductEdit(f.request)
    assert.equal(result.stage, 'verification_required'); assert.notEqual(result.posValuesVerified, true); assert.equal(f.calls.includes('verify'), false); assert.equal(f.calls.includes('apply'), false)
  }
})

test('実行権receiptがない既送信状態は値一致でもDB確定せず、保存を再送しない', async () => {
  const f = harness(); f.status('uncertain'); f.stored.receiptConsumedAt = null
  const result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'verification_required'); assert.equal(result.posValuesVerified, true); assert.deepEqual(mutations(f.calls), [])
})

test('POS確認記録の応答消失後は保存を再送せず、復旧してDB反映だけ再開する', async () => {
  const f = harness({ verificationLost: true }), result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'pos_confirmed'); assert.equal(f.calls.includes('apply'), false)
  f.options.verificationLost = false
  assert.equal((await f.api.executePreparedProductEdit(f.request)).stage, 'completed')
  assert.equal(f.calls.filter(call => call === 'verify').length, 1); assert.equal(f.calls.filter(call => call === 'dispatch').length, 1)
})

test('POS成功後のDB失敗をdb_pendingへ残し、gatewayOFFでも独立照合からDBだけ再試行する', async () => {
  const f = harness({ databaseFails: true }), result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'db_pending'); assert.equal(result.posValuesVerified, true)
  f.options.databaseFails = false; f.env.POS_PRODUCT_EDIT_GATEWAY_ENABLED = 'false'; f.env.POS_PRODUCT_CONSUME_ENABLED = 'false'
  assert.equal((await f.api.executePreparedProductEdit(f.request)).stage, 'completed')
  assert.equal(f.calls.filter(call => call === 'apply').length, 2); assert.equal(f.calls.filter(call => call === 'dispatch').length, 1); assert.equal(f.calls.filter(call => call === 'verify').length, 1)
})

test('DB完了応答消失時は保存済みcompletedを読み、DB更新を自動再試行しない', async () => {
  const f = harness({ databaseLost: true }), result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'completed'); assert.equal(f.calls.filter(call => call === 'apply').length, 1); assert.equal(f.calls.includes('event:db_failed'), false)
})

test('POS確認後も再開時のPOS値が変わった場合はDBの固定値を反映しない', async () => {
  const f = harness({ changeActual: snapshot => { snapshot.fields.price = '999' } }); f.status('db_pending')
  const result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'db_pending'); assert.equal(result.posValuesVerified, false); assert.equal(result.nextAction, 'none')
  assert.deepEqual(mutations(f.calls), [])
})

test('保存応答の状態記録が消失した場合も送信を再試行せず、別の明示操作で照合する', async () => {
  const f = harness({ eventLost: 'dispatch_returned' }), result = await f.api.executePreparedProductEdit(f.request)
  assert.equal(result.stage, 'verification_required'); assert.equal(f.calls.includes('inspect'), false)
  f.options.eventLost = undefined
  assert.equal((await f.api.executePreparedProductEdit(f.request)).stage, 'completed')
  assert.equal(f.calls.filter(call => call === 'claim').length, 1); assert.equal(f.calls.filter(call => call === 'dispatch').length, 1)
})

test('POS値確認中の権限剥奪/フラグOFF/DB対象変化で確認記録・DB反映を止める', async () => {
  for (const onInspect of [({ auth }) => { auth.manager = false }, ({ env }) => { env.POS_PRODUCT_WRITES_ENABLED = 'false' }, ({ product }) => { product.id = 43 }]) {
    const f = harness({ onInspect }); await safelyReject(() => f.api.executePreparedProductEdit(f.request)); assert.equal(f.calls.includes('verify'), false); assert.equal(f.calls.includes('apply'), false)
  }
})

test('書込みOFFの読取り復旧は全状態を表示し、prepared/completedにPOS取得を増やさない', async () => {
  for (const status of ['prepared', 'dispatching', 'verifying', 'uncertain', 'pos_confirmed', 'db_pending', 'completed', 'rejected']) {
    const f = harness(); f.status(status); f.env.POS_PRODUCT_WRITES_ENABLED = 'false'; f.env.POS_PRODUCT_EDIT_EXECUTION_ENABLED = 'false'
    const result = await f.api.loadProductEditExecution(f.request)
    assert.equal(result.status, status); assert.equal(result.nextAction, 'none'); assert.deepEqual(mutations(f.calls), [])
    if (['prepared', 'completed', 'rejected'].includes(status)) assert.equal(f.calls.includes('inspect'), false)
  }
})

test('復旧の未ログイン/manager剥奪も本人の固定記録・POS情報を返さない', async () => {
  for (const mutate of [f => { f.auth.loggedIn = false }, f => { f.auth.manager = false }, f => { f.auth.actorId = operationId }]) {
    const f = harness(); f.status('uncertain'); mutate(f); await safelyReject(() => f.api.loadProductEditExecution(f.request)); assert.equal(f.calls.includes('inspect'), false)
  }
})

test('server-only制御は再prepare/register・直接POSfetch・公開Actionを含まない', () => {
  assert.match(source, /import ['"]server-only['"]/)
  assert.doesNotMatch(source, /['"]use server['"]|prepareProductEditFromPos\(|registerProductEditDispatch\(|fetch\(|console\.(?:log|error)|createServiceClient/)
})

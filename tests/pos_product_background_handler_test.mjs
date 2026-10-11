import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../next_app/', import.meta.url))
const require = createRequire(new URL('../next_app/package.json', import.meta.url)), ts = require('typescript')
const opId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const leaseToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', workerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const now = 1800000000000, secret = '1'.repeat(64), clone = value => JSON.parse(JSON.stringify(value))
function fixture(options = {}) {
  const env = { POS_PRODUCT_BACKGROUND_EDIT_ENABLED: 'true', POS_PRODUCT_WRITES_ENABLED: 'true', POS_PRODUCT_DISPATCH_ENABLED: 'true',
    POS_PRODUCT_CONSUME_ENABLED: 'true', POS_PRODUCT_CONSUME_SECRET: secret, ...options.env }, calls = [], cache = new Map()
  let clock = now, operation = null, dispatch = null, receipt = null
  const intake = { operation_id: opId, actor_id: actorId, store_id: 6, product_id: 42, jan_code: '0490123456789',
    patch: { price: '200' }, baseline: { product_name: '旧名', category: '分類', product_group: '分類', selling_price: 126, cost_price: 75, supplier_name: '' },
    status: 'working', lease_token: leaseToken, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }
  const identity = { posProductId: 'fixture-pos-6', officeId: '11054', groupId: '11099', salesKind: 'retail',
    productCode: '', manufacturerCode: intake.jan_code, exclusiveStore: true }
  function inspection(price = '126', capturedAt = now) {
    const formInspection = { identity, fields: { name: '旧名', groupId: 'g6', price, cost: '75', supplierId: null },
      settings: { nameKana: 'キュウメイ', abbreviation: '既存略称', taxId: '0', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'c'.repeat(64) },
      groups: [{ id: 'g6', name: '分類' }], suppliers: [{ id: 's6', name: '仕入先' }] }
    return { storeId: 6, janCode: intake.jan_code, capturedAt, searches: ['schGoodsId', 'schMakerCd'].map(field => ({ field, count: 1, inspected: true,
      internalId: identity.posProductId, internalIdPresent: true, salesKind: '2', storeGroupId: identity.groupId,
      productCodeMatches: false, manufacturerCodeMatches: true, formInspection })) }
  }
  async function rpc(name, args) {
    calls.push({ name, args }); options.onRpc?.(name, env, args, {
      getTime: () => clock, setTime: value => { clock = value }, advanceTime: value => { clock += value },
    })
    if (options.failRpc === name) throw Error('synthetic-private-key')
    if (name === 'claim_pos_product_edit_intake') return { claimed: true, intake: clone(intake), operation: clone(operation) }
    if (name === 'get_pos_product_edit_intake_lease') {
      const saved = clone({ intake, operation, dispatch, receipt })
      options.mutateLeaseResponse?.(saved)
      return saved
    }
    if (name === 'prepare_pos_product_edit_intake') {
      const cmd = JSON.parse(args.p_command_text)
      operation = { id: opId, actor_id: actorId, store_id: 6, kind: 'update', status: 'dispatching', row_version: 1, send_attempts: 1,
        payload_hash: require('node:crypto').createHash('sha256').update(args.p_command_text).digest('hex'),
        command_text: args.p_command_text, product_id_snapshot: 42, jan_code: intake.jan_code, pos_product_id: args.p_pos_product_id,
        expected_result_fingerprint: args.p_expected_result_fingerprint, verified_fingerprint: null }
      assert.equal(cmd.fields.cost, '75'); assert.equal(cmd.fields.supplierId, null); assert.equal(cmd.fields.groupId, 'g6')
      dispatch = { operation_id: opId, store_id: 6, dispatch_text: args.p_dispatch_text, dispatch_hash: args.p_dispatch_hash,
        before_fingerprint_text: args.p_before_fingerprint_text, expected_fingerprint_text: args.p_expected_fingerprint_text, reviewed_at: args.p_reviewed_at }
      if (options.mutatePrepared) options.mutatePrepared(operation)
      return clone({ operation, dispatch, claimed: true })
    }
    if (name === 'record_pos_product_operation_result') {
      assert.equal(args.p_actor_id, actorId); assert.equal(args.p_expected_version, operation.row_version)
      operation.status = { dispatch_returned: 'verifying', outcome_unknown: 'uncertain', pos_verified: 'pos_confirmed', db_failed: 'db_pending' }[args.p_event]
      operation.row_version++
      if (args.p_event === 'pos_verified') operation.verified_fingerprint = args.p_verified_fingerprint
      return clone(operation)
    }
    if (name === 'apply_pos_product_edit') { operation.status = 'completed'; operation.row_version++; return clone(operation) }
    if (name === 'finish_pos_product_edit_intake') {
      if (intake.status === 'working') intake.status = operation?.status === 'completed' ? 'completed' : 'needs_review'
      return clone(intake)
    }
    throw Error('unexpected RPC')
  }
  function load(relative) {
    const path = resolve(root, relative)
    if (cache.has(path)) return cache.get(path)
    const exports = {}; cache.set(path, exports)
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const imports = name => {
      if (name === 'server-only') return {}
      if (name === './background-edit.server') return { backgroundEditEnabled: () => ['POS_PRODUCT_BACKGROUND_EDIT_ENABLED', 'POS_PRODUCT_WRITES_ENABLED', 'POS_PRODUCT_DISPATCH_ENABLED'].every(key => env[key] === 'true'), backgroundEditRpc: rpc }
      if (name.startsWith('node:')) return require(name)
      if (name.startsWith('.')) return load(resolve(dirname(path), name + '.ts'))
      throw Error('unexpected import ' + name)
    }
    new Function('exports', 'require', 'process', source)(exports, imports, { env })
    return exports
  }
  const protocol = load('lib/pos-products/background-worker-protocol.server.ts'), handler = load('lib/pos-products/background-worker-handler.server.ts')
  const send = async (action, payload, mutate) => {
    const signed = protocol.signBackgroundWorkerRequest({ action, payload, requestId: workerId, storeId: 6 }, secret, clock)
    mutate?.(signed)
    const response = await handler.handleBackgroundWorkerRequest(new Request('https://fixture.invalid/api/pos-products/background-worker',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed) }), () => clock)
    return { response, data: await response.json() }
  }
  const prepare = () => send('prepare', { operationId: opId, leaseToken, inspection: inspection() })
  const result = (outcome = 'values_verified', overrides = {}) => send('result', { operationId: opId, leaseToken,
    result: { outcome, code: outcome === 'values_verified' ? 'POS_PRODUCT_EDIT_VALUES_VERIFIED' : 'POS_PRODUCT_EDIT_VERIFY_REQUIRED',
      saveRequestStarted: true, responseReceived: true, ...(outcome === 'values_verified' ? { inspection: inspection('200', now + 2000) } : {}), ...overrides } })
  return { env, calls, intake, send, inspection, prepare, result, setTime: value => { clock = value },
    consume: () => { receipt = { operation_id: opId, store_id: 6, dispatch_hash: dispatch.dispatch_hash, consumed_at: new Date(now + 1000).toISOString() } } }
}

test('worker OFF・改変署名・未知payloadは特権DB処理を呼ばない', async () => {
  const f = fixture({ env: { POS_PRODUCT_BACKGROUND_EDIT_ENABLED: 'false' } })
  assert.equal((await f.send('claim', { workerId })).response.status, 503); assert.equal(f.calls.length, 0)
  const g = fixture()
  assert.equal((await g.send('claim', { workerId }, r => { r.storeId = 7 })).response.status, 403)
  assert.equal((await g.send('claim', { workerId, actorId })).response.status, 403); assert.equal(g.calls.length, 0)
})
test('claimは対象店舗だけを返し、DB由来actor・leaseを保つ', async () => {
  const f = fixture(), { data } = await f.send('claim', { workerId })
  assert.equal(data.success, true); assert.equal(data.data.intake.actor_id, actorId); assert.equal(data.data.intake.lease_token, leaseToken)
  assert.deepEqual(f.calls[0].args, { p_store_id: 6, p_worker_id: workerId })
})
test('prepareはfresh照合の後で短命dispatchを固定し、未変更分類/仕入先/原価/画像設定を保持する', async () => {
  const f = fixture(), { response, data } = await f.prepare()
  assert.equal(response.status, 200); assert.equal(data.data.nextAction, 'save')
  assert.deepEqual(data.data.dispatch.patch, { gddGoodsPrice: '200' })
  assert.equal(data.data.dispatch.expiresAt, now + 120000)
  assert.equal(data.data.dispatch.before.settings.abbreviation, '既存略称')
  assert.equal(f.calls.filter(c => c.name === 'prepare_pos_product_edit_intake').length, 1)
})
test('競合・別店舗POS・差替え台帳では保存命令を返さず、希望値を保持する', async () => {
  const f = fixture(), inspected = f.inspection('127')
  const response = await f.send('prepare', { operationId: opId, leaseToken, inspection: inspected })
  assert.equal(response.data.data.nextAction, 'review'); assert.equal(f.intake.status, 'needs_review')
  assert.deepEqual(f.intake.patch, { price: '200' }); assert.equal(f.calls.filter(c => c.name.startsWith('prepare_')).length, 0)
  const g = fixture(); inspected.storeId = 7
  assert.equal((await g.send('prepare', { operationId: opId, leaseToken, inspection: inspected })).response.status, 403)
  const h = fixture({ mutatePrepared: row => { row.actor_id = workerId } })
  assert.equal((await h.prepare()).response.status, 403)
})
test('消費証拠・新規POS値照合・既存台帳遷移・DB反映の全条件後だけcompleted', async () => {
  const f = fixture(); await f.prepare(); f.consume(); f.setTime(now + 3000)
  const { data } = await f.result()
  assert.equal(data.data.status, 'completed')
  assert.deepEqual(f.calls.slice(2).map(c => c.name), ['get_pos_product_edit_intake_lease', 'record_pos_product_operation_result',
    'record_pos_product_operation_result', 'apply_pos_product_edit', 'finish_pos_product_edit_intake'])
  const before = f.calls.length
  assert.equal((await f.result()).data.data.status, 'completed')
  assert.deepEqual(f.calls.slice(before).map(c => c.name), ['get_pos_product_edit_intake_lease'])
})
test('consume証拠なし・古い/違うPOS結果はDB反映0回', async () => {
  for (const kind of ['no-receipt', 'stale', 'wrong-price', 'no-save']) {
    const f = fixture(); await f.prepare(); if (kind !== 'no-receipt') f.consume(); f.setTime(now + 3000)
    const overrides = kind === 'stale' ? { inspection: f.inspection('200', now) }
      : kind === 'wrong-price' ? { inspection: f.inspection('201', now + 2000) } : kind === 'no-save' ? { saveRequestStarted: false } : {}
    assert.equal((await f.result('values_verified', overrides)).response.status, 403)
    assert.equal(f.calls.filter(c => c.name === 'apply_pos_product_edit').length, 0)
  }
})
test('結果不明/not_sentの申告を再送許可へ変換せず、同一受付を要確認で保全する', async () => {
  for (const outcome of ['not_sent', 'verification_required']) {
    const f = fixture(); await f.prepare(); f.setTime(now + 3000)
    await f.result(outcome, outcome === 'not_sent' ? { code: 'POS_PRODUCT_EDIT_PREPARE_REJECTED', saveRequestStarted: false, responseReceived: false } : {})
    assert.equal(f.intake.status, 'needs_review')
    assert.equal(f.calls.filter(c => c.name === 'apply_pos_product_edit').length, 0)
    assert.equal(f.calls.at(-1).args.p_code, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN')
  }
})
test('DB反映失敗はpos_confirmedの証拠を残しdb_pending、秘密例外は返さない', async () => {
  const f = fixture({ failRpc: 'apply_pos_product_edit' }); await f.prepare(); f.consume(); f.setTime(now + 3000)
  const { response, data } = await f.result()
  assert.equal(response.status, 403); assert.equal(f.calls.at(-1).args.p_event, 'db_failed')
  assert.ok(!JSON.stringify(data).includes('synthetic-private'))
})
test('DB待機中の停止・鍵更新でも保存命令を返さない', async () => {
  for (const key of ['POS_PRODUCT_BACKGROUND_EDIT_ENABLED', 'POS_PRODUCT_CONSUME_SECRET']) {
    const f = fixture({ onRpc: (name, env) => { if (name === 'get_pos_product_edit_intake_lease') env[key] = key.endsWith('SECRET') ? '2'.repeat(64) : 'false' } })
    assert.equal((await f.prepare()).response.status, 403)
    assert.equal(f.calls.filter(c => c.name.startsWith('prepare_')).length, 0)
  }
})

test('同じ操作の復旧は新規POS照合だけからDBへ反映し、prepare/再送を追加しない', async () => {
  const f = fixture(); await f.prepare(); f.consume(); f.setTime(now + 3000)
  const before = f.calls.length
  const { data } = await f.send('recover', { operationId: opId, leaseToken, inspection: f.inspection('200', now + 2000) })
  assert.equal(data.data.status, 'completed')
  assert.equal(f.calls.slice(before).filter(c => c.name.startsWith('prepare_')).length, 0)
  const g = fixture(); await g.prepare(); g.setTime(now + 3000)
  assert.equal((await g.send('recover', { operationId: opId, leaseToken, inspection: g.inspection('200', now + 2000) })).response.status, 403)
  assert.equal(g.calls.filter(c => c.name === 'apply_pos_product_edit').length, 0)
})

test('dispatch_returnedの記録待機中に停止・鍵更新するとpos_verified/DB反映/完了へ進まない', async () => {
  for (const key of ['POS_PRODUCT_BACKGROUND_EDIT_ENABLED', 'POS_PRODUCT_CONSUME_SECRET']) {
    const f = fixture({ onRpc: (name, env, args) => {
      if (name === 'record_pos_product_operation_result' && args.p_event === 'dispatch_returned') {
        env[key] = key.endsWith('SECRET') ? '2'.repeat(64) : 'false'
      }
    } })
    assert.equal((await f.prepare()).response.status, 200)
    f.consume(); f.setTime(now + 3000)
    const before = f.calls.length, { response, data } = await f.result()
    assert.equal(response.status, 403); assert.equal(data.success, false)
    assert.deepEqual(f.calls.slice(before).map(call => [call.name, call.args.p_event ?? null]), [
      ['get_pos_product_edit_intake_lease', null], ['record_pos_product_operation_result', 'dispatch_returned'],
    ])
    assert.equal(f.calls.filter(call => call.name === 'apply_pos_product_edit').length, 0)
    assert.equal(f.calls.filter(call => call.name === 'finish_pos_product_edit_intake').length, 0)
    assert.equal(f.intake.status, 'working'); assert.deepEqual(f.intake.patch, { price: '200' })
    assert.doesNotMatch(JSON.stringify(data), /completed|synthetic-private/)
  }
})

test('110秒前のsnapshotはlease待機20秒後の現在時刻で期限切れとして保存準備前に拒否する', async () => {
  const f = fixture({ onRpc: (name, _env, _args, clock) => {
    if (name === 'get_pos_product_edit_intake_lease') clock.advanceTime(20000)
  } })
  const { response, data } = await f.send('prepare', {
    operationId: opId, leaseToken, inspection: f.inspection('126', now - 110000),
  })
  assert.equal(response.status, 403); assert.equal(data.success, false)
  assert.deepEqual(f.calls.map(call => call.name), ['get_pos_product_edit_intake_lease'])
  assert.equal(f.calls.filter(call => call.name === 'prepare_pos_product_edit_intake').length, 0)
  assert.equal(f.intake.status, 'working'); assert.deepEqual(f.intake.patch, { price: '200' })
})

test('DB返却leaseが署名要求と異なる場合はprepare/result/failの後続処理を呼ばない', async () => {
  for (const action of ['prepare', 'result', 'fail']) {
    const f = fixture({ mutateLeaseResponse: saved => { saved.intake.lease_token = workerId } })
    const payload = { operationId: opId, leaseToken, ...(action === 'prepare' ? { inspection: f.inspection() }
      : action === 'result' ? { result: { outcome: 'not_sent', code: 'POS_PRODUCT_EDIT_PREPARE_REJECTED', saveRequestStarted: false, responseReceived: false } }
        : { code: 'POS_READ_FAILED' }) }
    const { response, data } = await f.send(action, payload)
    assert.equal(response.status, 403); assert.equal(data.success, false)
    assert.deepEqual(f.calls.map(call => call.name), ['get_pos_product_edit_intake_lease'])
    assert.equal(f.calls[0].args.p_lease_token, leaseToken)
    assert.equal(f.intake.lease_token, leaseToken); assert.equal(f.intake.status, 'working')
    assert.doesNotMatch(JSON.stringify(data), /completed|synthetic-private/)
  }
})

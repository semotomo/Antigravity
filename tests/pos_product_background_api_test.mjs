import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../next_app/package.json', import.meta.url))
const ts = require('typescript')
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const now = 1800000000000
const expectedValues = { price: '199', cost: '95' }
const raw = { operation_id: id, actor_id: actor, store_id: 7, product_id: 42, jan_code: '4582107173062',
  patch: { price: '200', cost: '100' }, baseline: { product_name: '商品', selling_price: 199, cost_price: 95 },
  status: 'queued', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), code: null }
function load(path, imports = {}, env = {}) {
  const exports = {}
  const source = readFileSync(new URL(`../next_app/${path}`, import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process: { env }, Buffer, URL, Request, Response, TextDecoder,
      require: name => name === 'server-only' ? {} : name.startsWith('node:') ? require(name) : imports[name] ?? (() => { throw Error(name) })() })
  return exports
}
function fixture({ enabled = true, denied = false, rpcFail = false, rpcData = null } = {}) {
  const calls = []
  const env = { POS_PRODUCT_BACKGROUND_EDIT_ENABLED: enabled ? 'true' : 'false', POS_PRODUCT_WRITES_ENABLED: 'true',
    POS_PRODUCT_DISPATCH_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' }
  const core = load('lib/pos-products/background-edit.ts')
  const dal = load('lib/pos-products/background-edit.server.ts', {
    './background-edit': core,
    '@/lib/supabase/server': { createClient: async () => ({}) },
    '@/lib/inventory/auth': { requireInventoryManagerAccess: async (_, store) => { calls.push(['auth', store]); if (denied) throw Error('private-token'); return { id: actor } } },
    '@supabase/supabase-js': { createClient: () => ({ rpc: async (name, args) => {
      calls.push(['rpc', name, args]); if (rpcFail) return { error: { message: 'private-key' }, data: null }
      return { error: null, data: rpcData ? rpcData(name, args) : name === 'get_pos_product_edit_intakes' ? [raw] : name === 'cancel_pos_product_edit_intake' ? { ...raw, status: 'cancelled' } : raw }
    } }) },
  }, env)
  return { core, dal, calls, env }
}

test('受付patchは明示3項目だけを許可し、整数円・対象を厳格に検証', () => {
  const { core } = fixture()
  assert.deepEqual(structuredClone(core.parseBackgroundEditRequest({ operationId: id, storeId: 7, productId: 42, patch: { price: '0' }, expectedValues: { price: '199' } })),
    { operationId: id, storeId: 7, productId: 42, patch: { price: '0' }, expectedValues: { price: '199' } })
  for (const patch of [{}, { price: '-1' }, { price: '01' }, { price: '1.5' }, { price: '1,600' }, { name: '' }, { name: 'a\n' },
    { supplierId: null }, { groupId: '' }, { price: '1000000000' }]) {
    assert.throws(() => core.parseBackgroundEditRequest({ operationId: id, storeId: 7, productId: 42, patch, expectedValues }))
  }
  assert.throws(() => core.parseBackgroundEditRequest({ operationId: id, storeId: 6, productId: 42, actorId: actor, patch: { price: '200' }, expectedValues: { price: '199' } }))
})

test('永続受付はmanager認可後にDBだけを呼びPOS通信は行わない', async () => {
  const f = fixture(), result = await f.dal.enqueueBackgroundProductEdit({ operationId: id, storeId: 7, productId: 42, patch: raw.patch, expectedValues })
  assert.equal(result.status, 'queued'); assert.equal(result.operationId, id)
  assert.deepEqual(f.calls.map(call => call[0]), ['auth', 'rpc'])
  assert.equal(f.calls[1][1], 'enqueue_pos_product_edit_intake')
  assert.equal(f.calls[1][2].p_actor_id, actor)
  assert.deepEqual(JSON.parse(f.calls[1][2].p_expected_values_text), expectedValues)
  assert.ok(!JSON.stringify(result).includes(actor)); assert.ok(!JSON.stringify(result).includes('baseline'))
})

test('OFF/権限不足/不正入力は受付書込み0回', async () => {
  for (const options of [{ enabled: false }, { denied: true }]) {
    const f = fixture(options)
    await assert.rejects(() => f.dal.enqueueBackgroundProductEdit({ operationId: id, storeId: 7, productId: 42, patch: raw.patch, expectedValues }))
    assert.equal(f.calls.filter(call => call[0] === 'rpc').length, 0)
  }
  const f = fixture()
  await assert.rejects(() => f.dal.enqueueBackgroundProductEdit({ operationId: id, storeId: 8, productId: 42, patch: raw.patch, expectedValues }))
  assert.equal(f.calls.length, 0)
})

test('受付応答消失の確認は同じ店舗/操作IDで読み、可視商品一覧も店舗認可する', async () => {
  const f = fixture()
  assert.equal((await f.dal.readBackgroundProductEdits({ storeId: 7, operationId: id })).operationId, id)
  assert.equal(f.calls[1][1], 'get_pos_product_edit_intake')
  assert.equal(f.calls[1][2].p_operation_id, id)
  const result = await f.dal.readBackgroundProductEdits({ storeId: 7, productIds: [42] })
  assert.equal(result.length, 1)
  assert.equal(f.calls.at(-1)[1], 'get_pos_product_edit_intakes')
  assert.deepEqual(structuredClone(f.calls.at(-1)[2].p_product_ids), [42])
})

test('DBの別店舗/対象差替えと内部例外を公開DTOへ通さない', async () => {
  const core = fixture().core
  assert.throws(() => core.decodeProductEditIntakeData({ ...raw, patch: { supplierId: null } }))
  assert.throws(() => core.decodeProductEditIntakeData({ ...raw, store_id: 8 }))
  const f = fixture({ rpcFail: true })
  await assert.rejects(() => f.dal.enqueueBackgroundProductEdit({ operationId: id, storeId: 7, productId: 42, patch: raw.patch, expectedValues }), error => !error.message.includes('private'))
})

test('worker署名は専用audience・TTL・exact keysを検証し改変を拒否', () => {
  const protocol = load('lib/pos-products/background-worker-protocol.server.ts')
  const secret = 'a'.repeat(64)
  const request = protocol.signBackgroundWorkerRequest({ action: 'claim', requestId: id, storeId: 7, payload: { workerId: actor } }, secret, now)
  assert.equal(protocol.verifyBackgroundWorkerRequest(JSON.stringify(request), secret, now).action, 'claim')
  for (const changed of [{ ...request, storeId: 6 }, { ...request, audience: 'kennel.pos-products.v1' },
    { ...request, payload: { workerId: id } }, { ...request, extra: true }]) {
    assert.throws(() => protocol.verifyBackgroundWorkerRequest(JSON.stringify(changed), secret, now))
  }
  assert.throws(() => protocol.verifyBackgroundWorkerRequest(JSON.stringify(request), secret, now + 60001))
  assert.throws(() => protocol.verifyBackgroundWorkerRequest(JSON.stringify(request), 'b'.repeat(64), now))
  const response = protocol.signBackgroundWorkerResponse(request, true, { claimed: false, intake: null, operation: null }, secret)
  assert.equal(response.audience, 'kennel.pos-product-background-worker-response.v1')
  assert.equal(response.requestId, id)
})

test('表示元基準を編集キーと同じ範囲に固定し、DB jsonbキー順差は拒否理由にしない', async () => {
  const f = fixture()
  for (const expected of [{}, { price: '199' }, { ...expectedValues, name: '商品' }, { price: '-1', cost: '95' }]) {
    assert.throws(() => f.core.parseBackgroundEditRequest({ operationId: id, storeId: 7, productId: 42, patch: raw.patch, expectedValues: expected }))
  }
  const dto = await f.dal.enqueueBackgroundProductEdit({ operationId: id, storeId: 7, productId: 42,
    patch: { cost: '100', price: '200' }, expectedValues: { cost: '95', price: '199' } })
  assert.equal(dto.status, 'queued')
})
test('取消/再確認依頼は同じIDの店舗管理者を再認可し、機能OFF中の再確認は拒否する', async () => {
  const f = fixture()
  assert.equal((await f.dal.controlBackgroundProductEdit({ storeId: 7, operationId: id, action: 'cancel' })).status, 'cancelled')
  assert.equal(f.calls.at(-1)[1], 'cancel_pos_product_edit_intake')
  const g = fixture({ enabled: false })
  await assert.rejects(() => g.dal.controlBackgroundProductEdit({ storeId: 7, operationId: id, action: 'resume' }))
  assert.equal(g.calls.length, 0)
  const h = fixture({ denied: true })
  await assert.rejects(() => h.dal.controlBackgroundProductEdit({ storeId: 7, operationId: id, action: 'cancel' }))
  assert.equal(h.calls.filter(c => c[0] === 'rpc').length, 0)
})

test('未受付取消は同じ店舗/商品/IDの恒久証跡だけを返し、OFFでも認可と応答照合を省略しない', async () => {
  const receipt = { operationId: id, storeId: 7, productId: 42, abandoned: true }
  const request = { storeId: 7, operationId: id, productId: 42, action: 'abandon' }
  const f = fixture({ enabled: false, rpcData: () => receipt })
  assert.deepEqual(structuredClone(await f.dal.controlBackgroundProductEdit(request)), receipt)
  assert.equal(f.calls.at(-1)[1], 'abandon_pos_product_edit_intake')
  assert.deepEqual(structuredClone(f.calls.at(-1)[2]), { p_actor_id: actor, p_store_id: 7, p_product_id: 42, p_operation_id: id })
  for (const response of [{ ...receipt, storeId: 6 }, { ...receipt, productId: 43 }, { ...receipt, abandoned: false },
    { ...receipt, operationId: actor }, { ...receipt, private: 'private-key' }]) {
    const g = fixture({ rpcData: () => response })
    await assert.rejects(() => g.dal.controlBackgroundProductEdit(request), error => !error.message.includes('private'))
  }
  const denied = fixture({ denied: true, rpcData: () => receipt })
  await assert.rejects(() => denied.dal.controlBackgroundProductEdit(request))
  assert.equal(denied.calls.filter(call => call[0] === 'rpc').length, 0)
  for (const changed of [{ ...request, actorId: actor }, { ...request, productId: 0 }, { ...request, action: 'delete' }]) {
    const h = fixture()
    await assert.rejects(() => h.dal.controlBackgroundProductEdit(changed))
    assert.equal(h.calls.filter(call => call[0] === 'rpc').length, 0)
  }
})
test('ブラウザAPIは同一origin・サイズ上限・限定queryを守り、受付だけを返す', async () => {
  const calls = [], dto = fixture().core.decodeProductEditIntakeData(raw)
  const http = load('lib/pos-products/background-http.server.ts')
  const route = load('app/api/pos-products/background-edit/route.ts', {
    '@/lib/pos-products/background-http.server': http,
    '@/lib/inventory/validation': { isSameOriginInventoryRequest: request => request.headers.get('origin') === new URL(request.url).origin },
    '@/lib/pos-products/background-edit.server': {
      enqueueBackgroundProductEdit: async body => { calls.push(['post', body]); return dto },
      readBackgroundProductEdits: async query => { calls.push(['get', query]); return [dto] },
    },
  })
  const url = 'https://fixture.invalid/api/pos-products/background-edit'
  for (const request of [new Request(url, { method: 'POST', headers: { Origin: 'https://evil.invalid' }, body: '{}' }),
    new Request(url, { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) })]) {
    assert.equal((await route.POST(request)).ok, false)
  }
  assert.equal(calls.length, 0)
  const response = await route.POST(new Request(url, { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: id, storeId: 7, productId: 42, patch: raw.patch, expectedValues }) }))
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).data.operationId, id)
  assert.equal(calls[0][1].expectedValues.price, '199')
  for (const query of ['store=7&store=6', 'store=7&products=0', `store=7&products=42&operationId=${id}`, 'store=all&products=42']) {
    assert.equal((await route.GET(new Request(url + '?' + query))).status, 400)
  }
  const result = await route.GET(new Request(url + '?store=6&products=42,43'))
  assert.equal(result.status, 200); assert.deepEqual(structuredClone(calls.at(-1)[1]), { storeId: 6, productIds: [42, 43] })
})

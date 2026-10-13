import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../next_app/package.json', import.meta.url))
const ts = require('typescript')
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const snapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', now = Date.now()
const target = { storeId: 7, productId: 42, janCode: '4582107173062' }
const cached = { snapshotId, ...target, capturedAt: now, expiresAt: now + 900000, currentGroupId: 'g1', currentSupplierId: 's1',
  groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '別分類' }], suppliers: [{ id: 's1', name: '仕入先' }, { id: 's2', name: '別仕入先' }] }
const request = { operationId, storeId: 7, productId: 42, patch: { groupId: 'g2', supplierId: null },
  expectedValues: { groupId: 'g1', supplierId: 's1' }, catalogSnapshotId: snapshotId }
function load(path, imports = {}, env = {}) {
  const exports = {}, source = readFileSync(new URL('../next_app/' + path, import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process: { env }, Buffer, URL, Request, Response, TextDecoder, Date, console: { warn: () => {} },
      require: name => name === 'server-only' ? {} : name.startsWith('node:') ? require(name)
        : name === './background-failure' || name === '@/lib/pos-products/background-failure' ? failure
          : imports[name] ?? (() => { throw Error('unmapped import ' + name) })() })
  return exports
}
const failure = load('lib/pos-products/background-failure.ts')
function fixture({ enabled = true, denied = false, cache = cached, editorChange = {}, rpcChange = null, clientFail = false, queryFail = false, queryRejected = false } = {}) {
  const calls = [], env = { POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED: enabled ? 'true' : 'false',
    POS_PRODUCT_BACKGROUND_EDIT_ENABLED: 'true', POS_PRODUCT_WRITES_ENABLED: 'true', POS_PRODUCT_DISPATCH_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' }
  const core = load('lib/pos-products/background-edit.ts'), classification = load('lib/pos-products/classification.ts', { './background-edit': core })
  const client = { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => {
    if (queryFail) throw Error('private target transport')
    return { error: queryRejected ? { message: 'private SQL response' } : null, data: { id: target.productId, store_id: target.storeId, jan_code: target.janCode } }
  } }) }
  const createClient = async () => { if (clientFail) throw Error('private client token'); return client }
  const auth = { requireInventoryManagerAccess: async (_, store) => { calls.push(['auth', store]); if (denied) throw Error('private auth'); return { id: actorId } } }
  const dal = load('lib/pos-products/background-edit.server.ts', { './background-edit': core,
    '@/lib/supabase/server': { createClient }, '@/lib/inventory/auth': auth,
    '@supabase/supabase-js': { createClient: () => ({ rpc: async (name, args) => {
      calls.push(['rpc', name, args])
      let data
      if (name === 'get_pos_product_classification_snapshot') data = cache
      else if (name === 'record_pos_product_classification_snapshot') data = { snapshotId: args.p_snapshot_id, ...JSON.parse(args.p_snapshot_text) }
      else {
        const patch = JSON.parse(args.p_patch_text), requested = {}
        if (Object.hasOwn(patch, 'groupId')) requested.groupId = cached.groups.find(g => g.id === patch.groupId)
        if (Object.hasOwn(patch, 'supplierId')) requested.supplierId = patch.supplierId === null ? null : cached.suppliers.find(s => s.id === patch.supplierId)
        data = { operation_id: args.p_operation_id, actor_id: args.p_actor_id, store_id: args.p_store_id, product_id: args.p_product_id,
          jan_code: target.janCode, patch, status: 'queued', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
          catalog_snapshot_id: args.p_catalog_snapshot_id ?? null,
          pos_choice_baseline: args.p_catalog_snapshot_id ? { groupId: 'g1', groupName: '分類', supplierId: 's1', supplierName: '仕入先', requested } : null }
      }
      return { error: null, data: rpcChange ? rpcChange(name, data) : data }
    } }) },
  }, env)
  const server = load('lib/pos-products/classification.server.ts', { './background-edit': core, './classification': classification,
    './background-edit.server': dal, '@/lib/supabase/server': { createClient }, '@/lib/inventory/auth': auth,
    './editor.server': { loadProductEditor: async input => {
      calls.push(['pos', input]); return { ...target, capturedAt: now, fingerprint: 'a'.repeat(64),
        fields: { name: '商品', price: '100', cost: '50', groupId: 'g1', supplierId: 's1' }, groups: cached.groups, suppliers: cached.suppliers, ...editorChange }
    } } }, env)
  return { core, classification, dal, server, calls, env }
}

test('分類requestはsnapshotIDを必須とし、旧3項目にはsnapshotを混入させない', () => {
  const { core } = fixture()
  assert.deepEqual(structuredClone(core.parseBackgroundEditRequest(request)), request)
  for (const invalid of [
    { ...request, catalogSnapshotId: undefined }, { ...request, patch: { groupId: '' } }, { ...request, patch: { supplierId: '' } },
    { ...request, expectedValues: { groupId: null, supplierId: 's1' } },
    { ...request, patch: { price: '200' }, expectedValues: { price: '100' } },
    { ...request, actorId }, { ...request, patch: { groupId: 'g2', csrf: 'opaque' } },
  ]) assert.throws(() => core.parseBackgroundEditRequest(invalid))
  const normal = { operationId, storeId: 7, productId: 42, patch: { price: '200' }, expectedValues: { price: '100' } }
  assert.deepEqual(structuredClone(core.parseBackgroundEditRequest(normal)), normal)
})

test('snapshot decoderは対象・15分期限・現選択・ID/表示名重複・未知属性を拒否する', () => {
  const { classification } = fixture()
  assert.deepEqual(structuredClone(classification.decodeBackgroundClassificationSnapshot(cached, target, now)), cached)
  for (const change of [
    { storeId: 6 }, { productId: 43 }, { janCode: '4582107173063' }, { currentGroupId: '' }, { currentSupplierId: '' },
    { expiresAt: now }, { expiresAt: now + 900001 }, { capturedAt: now + 30001 }, { csrf: 'opaque' },
    { groups: [{ id: 'g1', name: '分類' }, { id: 'g1', name: '別分類' }] },
    { groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '分類' }] },
    { suppliers: [{ id: 's2', name: '別仕入先' }] }, { groups: [{ id: 'g1', name: 'x\n' }] },
  ]) assert.throws(() => classification.decodeBackgroundClassificationSnapshot({ ...cached, ...change }, target, now))
  assert.equal(classification.decodeBackgroundClassificationSnapshot({ ...cached, currentSupplierId: null }, target, now).currentSupplierId, null)
})

test('追加flagのOFF/権限不足は分類候補のPOS読取りとRPCを開始しない', async () => {
  for (const settings of [{ enabled: false }, { denied: true }]) {
    const f = fixture(settings)
    await assert.rejects(f.server.readBackgroundClassification({ storeId: 7, productId: 42 }))
    await assert.rejects(f.server.refreshBackgroundClassification({ storeId: 7, productId: 42 }))
    await assert.rejects(f.dal.enqueueBackgroundProductEdit(request))
    assert.equal(f.calls.filter(call => ['pos', 'rpc'].includes(call[0])).length, 0)
  }
})

test('分類OFFでも通常3項目は旧6引数RPCへ独立して受付する', async () => {
  const f = fixture({ enabled: false })
  const dto = await f.dal.enqueueBackgroundProductEdit({ operationId, storeId: 7, productId: 42, patch: { price: '200' }, expectedValues: { price: '100' } })
  assert.equal(dto.status, 'queued'); assert.equal(dto.catalogSnapshotId, undefined)
  const call = f.calls.find(call => call[0] === 'rpc')
  assert.equal(call[1], 'enqueue_pos_product_edit_intake'); assert.equal(Object.keys(call[2]).length, 6)
})

test('キャッシュGETは認可済み店舗・商品・JANだけを返しPOSを読まない', async () => {
  const f = fixture()
  assert.deepEqual(structuredClone(await f.server.readBackgroundClassification({ storeId: 7, productId: 42 })), cached)
  assert.equal(f.calls.filter(call => call[0] === 'pos').length, 0)
  assert.equal(f.calls.find(call => call[0] === 'rpc')[2].p_actor_id, actorId)
  assert.equal(await fixture({ cache: null }).server.readBackgroundClassification({ storeId: 7, productId: 42 }), null)
  for (const changed of [{ ...cached, productId: 43 }, { ...cached, janCode: '4582107173063' }]) {
    await assert.rejects(fixture({ cache: changed }).server.readBackgroundClassification({ storeId: 7, productId: 42 }))
  }
  for (const malformed of [undefined, {}, [], '']) {
    await assert.rejects(fixture({ rpcChange: () => malformed }).server.readBackgroundClassification({ storeId: 7, productId: 42 }), error => error.code === 'BG_EDIT_RECEIPT')
  }
})

test('認証clientと商品queryの失敗は固定codeへ変換し、POS/RPCを開始しない', async () => {
  for (const [settings, code] of [[{ clientFail: true }, 'BG_EDIT_ACCESS'], [{ queryFail: true }, 'BG_EDIT_DB_TRANSPORT'], [{ queryRejected: true }, 'BG_EDIT_DB_REJECTED']]) {
    const f = fixture(settings)
    await assert.rejects(f.server.readBackgroundClassification({ storeId: 7, productId: 42 }), error => error.code === code && !error.message.includes('private'))
    await assert.rejects(f.server.refreshBackgroundClassification({ storeId: 7, productId: 42 }), error => error.code === code && !error.message.includes('private'))
    assert.equal(f.calls.filter(call => ['rpc', 'pos'].includes(call[0])).length, 0)
  }
})

test('明示refreshは検証済みPOS業務DTOだけを記録し、別target/候補差替えは拒否する', async () => {
  const f = fixture(), result = await f.server.refreshBackgroundClassification({ storeId: 7, productId: 42 })
  assert.equal(result.productId, 42); assert.equal(result.expiresAt - result.capturedAt, 900000)
  assert.equal(f.calls.filter(call => call[0] === 'pos').length, 1)
  const call = f.calls.find(call => call[0] === 'rpc'), value = JSON.parse(call[2].p_snapshot_text)
  assert.equal(call[1], 'record_pos_product_classification_snapshot'); assert.equal(call[2].p_actor_id, actorId)
  assert.deepEqual(Object.keys(value).sort(), ['storeId', 'productId', 'janCode', 'capturedAt', 'expiresAt', 'currentGroupId', 'currentSupplierId', 'groups', 'suppliers'].sort())
  for (const change of [{ productId: 43 }, { janCode: '4582107173063' }, { groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '分類' }] }]) {
    const invalid = fixture({ editorChange: change })
    await assert.rejects(invalid.server.refreshBackgroundClassification({ storeId: 7, productId: 42 }))
    assert.equal(invalid.calls.filter(call => call[0] === 'rpc').length, 0)
  }
  await assert.rejects(fixture({ rpcChange: (_, data) => ({ ...data, snapshotId }) }).server.refreshBackgroundClassification({ storeId: 7, productId: 42 }))
})

test('分類受付はv2を使い、希望ID/名称とsnapshotIDをreceiptへ固定する', async () => {
  const f = fixture(), dto = await f.dal.enqueueBackgroundProductEdit(request)
  assert.equal(dto.catalogSnapshotId, snapshotId)
  assert.deepEqual(structuredClone(dto.posChoiceBaseline.requested), { groupId: { id: 'g2', name: '別分類' }, supplierId: null })
  const call = f.calls.find(call => call[0] === 'rpc')
  assert.equal(call[1], 'enqueue_pos_product_edit_intake_v2'); assert.equal(call[2].p_catalog_snapshot_id, snapshotId)
  assert.equal(f.calls.filter(call => call[0] === 'pos').length, 0)
  for (const change of [data => ({ ...data, actor_id: operationId }), data => ({ ...data, catalog_snapshot_id: operationId }),
    data => ({ ...data, pos_choice_baseline: { ...data.pos_choice_baseline, requested: { groupId: { id: 'g1', name: '分類' }, supplierId: null } } })]) {
    await assert.rejects(fixture({ rpcChange: (_, data) => change(data) }).dal.enqueueBackgroundProductEdit(request), error => error.code === 'BG_EDIT_RECEIPT')
  }
})

function routeFixture() {
  const calls = [], f = fixture(), http = load('lib/pos-products/background-http.server.ts')
  const route = load('app/api/pos-products/background-classification/route.ts', {
    '@/lib/pos-products/classification.server': {
      readBackgroundClassification: async body => { calls.push(['get', body]); return cached },
      refreshBackgroundClassification: async body => { calls.push(['refresh', body]); return cached },
    }, '@/lib/pos-products/background-http.server': http,
    '@/lib/inventory/validation': { isSameOriginInventoryRequest: req => req.headers.get('origin') === new URL(req.url).origin },
    '@/lib/pos-products/classification': f.classification,
  })
  return { route, calls }
}
test('候補APIは限定query/POST本文・同一origin・no-storeを守る', async () => {
  const { route, calls } = routeFixture()
  const get = await route.GET(new Request('https://kennel.invalid/api/pos-products/background-classification?storeId=7&productId=42'))
  assert.equal(get.status, 200); assert.equal(get.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await get.json(), { success: true, data: cached })
  const post = body => new Request('https://kennel.invalid/api/pos-products/background-classification', { method: 'POST',
    headers: { origin: 'https://kennel.invalid', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await route.POST(post({ storeId: 7, productId: 42 }))).status, 200)
  const count = calls.length
  for (const query of ['storeId=7&productId=42&productId=43', 'storeId=7&productId=42&csrf=x', 'storeId=07&productId=42', 'storeId=7&productId=1.2']) {
    assert.equal((await route.GET(new Request('https://kennel.invalid/api/pos-products/background-classification?' + query))).status, 400)
  }
  assert.equal((await route.POST(post({ storeId: 7, productId: 42, actorId }))).status, 400)
  assert.equal((await route.POST(post({ storeId: 7, productId: 42, value: 'x'.repeat(4097) }))).status, 400)
  const cross = post({ storeId: 7, productId: 42 }); cross.headers.set('origin', 'https://other.invalid')
  assert.equal((await route.POST(cross)).status, 403); assert.equal(calls.length, count)
})

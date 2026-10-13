import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../next_app/node_modules/typescript')
const source = readFileSync(new URL('../next_app/components/products/BackgroundProductEditModal.tsx', import.meta.url), 'utf8')
const failures = {}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../next_app/lib/pos-products/background-failure.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: failures })
const posModules = new Map([['background-failure', failures]])
function posModule(name) {
  if (posModules.has(name)) return posModules.get(name)
  const api = {}
  posModules.set(name, api)
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../next_app/lib/pos-products/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: api, require: imported => {
    if (imported.startsWith('./')) return posModule(imported.slice(2))
    if (imported.startsWith('@/lib/pos-products/')) return posModule(imported.slice('@/lib/pos-products/'.length))
    throw Error(`Unexpected shared import ${imported}`)
  } })
  return api
}
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports, URLSearchParams, AbortController, setTimeout, clearTimeout, require: name => {
    if (name === 'react') return require('../next_app/node_modules/react')
    if (name === 'react/jsx-runtime') return require('../next_app/node_modules/react/jsx-runtime')
    if (name === '@/lib/productStores') return { getProductStoreName: store => store === 7 ? '本店' : 'わんわん' }
    if (name === '@/components/ui/StatusBadge') return { cn: (...values) => values.join(' ') }
    if (name === '@/lib/pos-products/background-failure') return failures
    if (name.startsWith('@/lib/pos-products/')) return posModule(name.slice('@/lib/pos-products/'.length))
    throw Error(`Unexpected import ${name}`)
  },
})
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const target = { productId: 42, storeId: 7, janCode: '0490123456789' }
const intake = { operationId, ...target, status: 'queued', patch: { name: '変更名' }, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', message: '反映待ち' }
function fixture(overrides = {}) {
  const values = new Map(), calls = [], events = [], lock = { current: false }
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    assert.ok(values.size > 0, 'POSTより先に入力と操作IDを保存する')
    return { ok: true, json: async () => ({ success: true, data: intake }) }
  }
  const options = { target, patch: { name: '変更名' }, expectedValues: { name: '旧名' }, storage, fetcher, createId: () => operationId, lock,
    onAccepted: data => events.push(['accepted', data.operationId]), onClose: () => events.push(['closed']), ...overrides }
  return { values, calls, events, lock, options }
}

test('編集した名称/売価/原価だけをpatchし、仮の分類や仕入先を送らない', () => {
  const draft = { name: '新名', price: '1200', cost: '0' }
  assert.deepEqual(structuredClone(exports.backgroundProductEditPatch(draft, { name: true, cost: true })), { name: '新名', cost: '0' })
  assert.throws(() => exports.backgroundProductEditPatch({ ...draft, price: '-1' }, { price: true }))
  assert.throws(() => exports.backgroundProductEditPatch({ ...draft, name: ' ' }, { name: true }))
  assert.throws(() => exports.backgroundProductEditPatch({ ...draft, name: '名称\n改行' }, { name: true }))
  assert.deepEqual(structuredClone(exports.backgroundProductEditExpectedValues({ product_name: '旧名', selling_price: 100, cost_price: null }, { name: '新名', cost: '0' })), { name: '旧名', cost: null })
})

test('POS読取りなしで短い受付POSTを送り、親へ受付を渡してから閉じる', async () => {
  const f = fixture()
  await exports.acceptBackgroundProductEdit(f.options)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, '/api/pos-products/background-edit')
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { operationId, storeId: 7, productId: 42, patch: { name: '変更名' }, expectedValues: { name: '旧名' } })
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
  assert.equal(f.lock.current, false)
})

test('未受付の入力は恒久取消証跡を確認してからだけ端末から解除し、受付済みなら保持する', async () => {
  const f = fixture()
  f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
  const controls = []
  const options = { target, storage: f.options.storage, lock: f.lock, onAbandoned: () => f.events.push(['abandoned']), onClose: f.options.onClose,
    fetcher: async (_, request) => { controls.push(JSON.parse(request.body)); return { ok: true, json: async () => ({ success: true, data: { operationId, storeId: 7, productId: 42, abandoned: true } }) } } }
  await exports.abandonBackgroundEditIntent(options)
  assert.deepEqual(controls, [{ operationId, storeId: 7, productId: 42, action: 'abandon' }])
  assert.equal(f.values.size, 0); assert.deepEqual(f.events, [['abandoned'], ['closed']])
  for (const response of [{ ok: false, json: async () => ({ success: false }) },
    { ok: true, json: async () => ({ success: true, data: { operationId, storeId: 6, productId: 42, abandoned: true } }) }]) {
    const g = fixture()
    g.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
    await assert.rejects(exports.abandonBackgroundEditIntent({ ...options, storage: g.options.storage, lock: g.lock,
      onAbandoned: () => { throw Error('must not clear') }, onClose: () => { throw Error('must not close') }, fetcher: async () => response }))
    assert.equal(g.values.size, 1)
  }
})

test('ACK消失後は保存した同一IDをGET照会し、新しいIDや再POSTを作らない', async () => {
  const f = fixture(), failing = async (url, options) => { f.calls.push({ url, options }); throw Error('lost ack') }
  await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, fetcher: failing }))
  assert.equal(f.events.length, 0)
  assert.equal(f.values.size, 1)
  await exports.acceptBackgroundProductEdit({ ...f.options, patch: { price: '300' }, createId: () => { throw Error('new id forbidden') } })
  assert.equal(f.calls.length, 2)
  assert.match(f.calls[1].url, new RegExp(`operationId=${operationId}`))
  assert.equal(f.calls[1].options.method, 'GET')
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
})

test('受付状態の確認はGETだけで保全し、受付なし確認後の明示操作だけ元patch/基準値/IDで再受付する', async () => {
  const f = fixture()
  await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, fetcher: async () => { throw Error('offline') } }))
  const preserved = [...f.values.values()][0]
  const options = { ...f.options, patch: { price: '300' }, expectedValues: { price: '250' }, createId: () => { throw Error('new id forbidden') }, fetcher: async (url, options) => {
    f.calls.push({ url, options }); if (options.method === 'GET') return { ok: true, json: async () => ({ success: true, data: null }) }
    return { ok: true, json: async () => ({ success: true, data: intake }) }
  } }
  await assert.rejects(exports.acceptBackgroundProductEdit(options), error => error.code === 'BG_EDIT_NO_INTAKE')
  assert.deepEqual(f.calls.map(call => call.options.method), ['GET'])
  assert.equal([...f.values.values()][0], preserved)
  assert.equal(f.events.length, 0)
  await exports.acceptBackgroundProductEdit({ ...options, retryUnaccepted: true })
  assert.deepEqual(f.calls.map(call => call.options.method), ['GET', 'GET', 'POST'])
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).patch, { name: '変更名' })
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).expectedValues, { name: '旧名' })
  assert.equal(JSON.parse(f.calls.at(-1).options.body).operationId, operationId)
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
  assert.equal(f.values.size, 0)
})

test('明示再受付もGETで既存受付を確認した場合はPOSTを追加せず同じ操作を返す', async () => {
  const f = fixture()
  f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
  await exports.acceptBackgroundProductEdit({ ...f.options, retryUnaccepted: true, createId: () => { throw Error('new id forbidden') } })
  assert.deepEqual(f.calls.map(call => call.options.method), ['GET'])
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
  assert.equal(f.values.size, 0)
})

test('工程別の固定診断コードで元例外/応答本文/未知コードを遮断し、受付確認失敗はPOSTしない', async () => {
  const secret = 'private raw response or key'
  for (const method of ['GET', 'POST']) {
    const requestCode = method === 'GET' ? 'BG_EDIT_CHECK_REQUEST' : 'BG_EDIT_ACCEPT_REQUEST'
    const responseCode = method === 'GET' ? 'BG_EDIT_CHECK_RESPONSE' : 'BG_EDIT_ACCEPT_RESPONSE'
    const cases = [
      { code: requestCode, fetcher: async () => { throw Error(secret) } },
      { code: responseCode, response: { ok: true, json: async () => { throw Error(secret) } } },
      { code: responseCode, response: { ok: true, json: async () => null } },
      { code: responseCode, response: { ok: false, json: async () => ({ success: false, diagnosticCode: secret, error: secret }) } },
      { code: 'BG_EDIT_DB_REJECTED', response: { ok: false, json: async () => ({ success: false, diagnosticCode: 'BG_EDIT_DB_REJECTED', error: secret }) } },
      { code: responseCode, response: { ok: true, json: async () => ({ success: true, data: { ...intake, productId: 99 } }) } },
    ]
    for (const scenario of cases) {
      const f = fixture()
      if (method === 'GET') f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
      await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, retryUnaccepted: method === 'GET', fetcher: async (url, options) => {
        f.calls.push({ url, options }); return scenario.fetcher ? scenario.fetcher() : scenario.response
      } }), error => {
        assert.equal(error.code, scenario.code)
        assert.ok(!error.message.includes(secret))
        return true
      })
      assert.deepEqual(f.calls.map(call => call.options.method), [method])
      assert.equal(f.values.size, 1)
      assert.equal(f.events.length, 0)
      assert.equal(f.lock.current, false)
    }
  }
})

test('入力/保全工程の失敗を固定コードにし、壊れたversion1情報を上書きせず通信しない', async () => {
  const invalidInput = fixture({ expectedValues: undefined })
  await assert.rejects(exports.acceptBackgroundProductEdit(invalidInput.options), error => error.code === 'BG_EDIT_INPUT')
  assert.equal(invalidInput.calls.length, 0)
  for (const kind of ['read', 'write', 'json']) {
    const f = fixture()
    if (kind === 'read') f.options.storage.getItem = () => { throw Error('private storage exception') }
    if (kind === 'write') f.options.storage.setItem = () => { throw Error('private quota exception') }
    if (kind === 'json') f.values.set(exports.backgroundEditStorageKey(target), '{private corrupt json')
    await assert.rejects(exports.acceptBackgroundProductEdit(f.options), error => error.code === 'BG_EDIT_STORAGE' && !error.message.includes('private'))
    assert.equal(f.calls.length, 0)
    assert.equal(f.events.length, 0)
    if (kind === 'json') assert.equal([...f.values.values()][0], '{private corrupt json')
  }
  const f = fixture()
  await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, retryUnaccepted: true }), error => error.code === 'BG_EDIT_INPUT')
  assert.equal(f.calls.length, 0)
  assert.equal(f.values.size, 0)
})

test('receipt deadlineは終わらないfetch/JSONを工程codeで止めてlockを解除し、同一IDを保全する', { timeout: 500 }, async () => {
  for (const method of ['GET', 'POST']) for (const stage of ['fetch', 'json']) {
    const f = fixture()
    if (method === 'GET') f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
    let signal
    await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, requestTimeoutMs: 5, fetcher: async (url, options) => {
      f.calls.push({ url, options }); signal = options.signal
      if (stage === 'fetch') return new Promise(() => {})
      return { ok: true, json: () => new Promise(() => {}) }
    } }), error => error.code === `BG_EDIT_${method === 'GET' ? 'CHECK' : 'ACCEPT'}_${stage === 'fetch' ? 'REQUEST' : 'RESPONSE'}`)
    assert.equal(signal.aborted, true)
    assert.equal(f.lock.current, false)
    assert.equal(f.values.size, 1)
    assert.equal(f.events.length, 0)
    assert.deepEqual(f.calls.map(call => call.options.method), [method])
  }
})

test('取消/再確認も終わらないfetch/JSONをdeadlineで止め、希望値/同じIDを保全しlockを解除する', { timeout: 500 }, async () => {
  for (const action of ['cancel', 'resume', 'abandon']) for (const stage of ['fetch', 'json']) {
    const f = fixture()
    f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
    const preserved = [...f.values.values()][0]
    let signal
    const options = { target, storage: f.options.storage, operation: { ...intake, status: 'needs_review' }, action, requestTimeoutMs: 5, lock: f.lock,
      onAccepted: f.options.onAccepted, onAbandoned: () => f.events.push(['abandoned']), onClose: f.options.onClose,
      fetcher: async (url, request) => { f.calls.push({ url, options: request }); signal = request.signal
        return stage === 'fetch' ? new Promise(() => {}) : { ok: true, json: () => new Promise(() => {}) }
      } }
    await assert.rejects(action === 'abandon' ? exports.abandonBackgroundEditIntent(options) : exports.controlBackgroundProductEdit(options),
      error => error.code === `BG_EDIT_ACCEPT_${stage === 'fetch' ? 'REQUEST' : 'RESPONSE'}`)
    assert.equal(signal.aborted, true)
    assert.equal(f.lock.current, false)
    assert.equal([...f.values.values()][0], preserved)
    assert.equal(f.events.length, 0)
    assert.equal(f.calls.length, 1)
    assert.equal(JSON.parse(f.calls[0].options.body).operationId, operationId)
  }
})

test('表示元の基準値が不正/編集キーと不一致ならPOSTせず、新しい基準を推測しない', async () => {
  for (const expectedValues of [undefined, { price: '100' }, { name: '旧名', price: '100' }, { name: 100 }]) {
    const f = fixture({ expectedValues })
    await assert.rejects(exports.acceptBackgroundProductEdit(f.options))
    assert.equal(f.calls.length, 0)
    assert.equal(f.values.size, 0)
  }
})

test('要確認/待機の復旧操作は同じ操作IDへcontrolだけを送り、成功後だけ閉じる', async () => {
  for (const action of ['resume', 'cancel']) {
    const f = fixture(), data = { ...intake, status: action === 'resume' ? 'queued' : 'cancelled' }
    await exports.controlBackgroundProductEdit({ target, operation: { ...intake, status: 'needs_review' }, action, lock: f.lock,
      fetcher: async (url, options) => { f.calls.push({ url, options }); return { ok: true, json: async () => ({ success: true, data }) } },
      onAccepted: f.options.onAccepted, onClose: f.options.onClose })
    assert.equal(f.calls[0].url, '/api/pos-products/background-edit/control')
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { storeId: 7, operationId, action })
    assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
  }
  const f = fixture()
  await assert.rejects(exports.controlBackgroundProductEdit({ target, operation: { ...intake, status: 'needs_review' }, action: 'resume', lock: f.lock,
    fetcher: async () => ({ ok: false, json: async () => ({ success: false, error: 'private raw failure' }) }),
    onAccepted: f.options.onAccepted, onClose: f.options.onClose }))
  assert.equal(f.events.length, 0)
  assert.equal(f.lock.current, false)
})

test('保存不可/照会失敗/別対象の応答では入力を保全して閉じず送信を増やさない', async () => {
  for (const failure of ['storage', 'lookup', 'identity', 'patch']) {
    const f = fixture()
    if (failure === 'storage') f.options.storage.setItem = () => { throw Error('quota') }
    if (failure === 'lookup') {
      await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, fetcher: async () => { throw Error('lost') } }))
      f.options.fetcher = async (url, options) => { f.calls.push({ url, options }); throw Error('lookup failed') }
    }
    if (failure === 'identity') f.options.fetcher = async () => ({ ok: true, json: async () => ({ success: true, data: { ...intake, storeId: 6 } }) })
    if (failure === 'patch') f.options.fetcher = async () => ({ ok: true, json: async () => ({ success: true, data: { ...intake, patch: { price: '100' } } }) })
    await assert.rejects(exports.acceptBackgroundProductEdit(f.options))
    assert.equal(f.events.length, 0)
    if (failure === 'storage') assert.equal(f.calls.length, 0)
    if (failure === 'lookup') assert.deepEqual(f.calls.map(call => call.options.method), ['GET'])
  }
})

function elements(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(elements)
  const children = node.props?.children
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(elements)]
}

function modalRenderer(fetcher = async () => { throw Error('Unexpected fetch') }, { storage, runEffects = false, receiptDeadlineMs = 20_000 } = {}) {
  const states = [], effects = []; let index = 0
  const hooks = { useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
    return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }] },
    useEffect(effect, deps) { const slot = index++; if (!runEffects) return
      if (!states[slot] || deps.some((value, at) => value !== states[slot][at])) { states[slot] = deps; effects.push(effect) } },
    useRef(value) { const slot = index++; if (!(slot in states)) states[slot] = { current: value }; return states[slot] }, useId: () => 'id' }
  const api = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: api, URLSearchParams, AbortController, clearTimeout,
    setTimeout: (callback, delay) => setTimeout(callback, delay === 20_000 ? receiptDeadlineMs : delay),
    fetch: fetcher, window: { sessionStorage: storage, crypto: { randomUUID: () => operationId } },
    require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? require('../next_app/node_modules/react/jsx-runtime') :
      name === '@/lib/productStores' ? { getProductStoreName: () => '本店' } : name === '@/components/ui/StatusBadge' ? { cn: (...values) => values.join(' ') } :
        name === '@/lib/pos-products/background-failure' ? failures : name.startsWith('@/lib/pos-products/') ? posModule(name.slice('@/lib/pos-products/'.length)) : (() => { throw Error(name) })(),
  })
  return props => { index = 0; const result = api.BackgroundProductEditModal(props); while (effects.length) effects.shift()(); return result }
}

test('受付状態を確認のpendingはdeadline後に解除され、保全情報復元不能は理由を表示して送信を止める', async () => {
  const f = fixture()
  f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
  const render = modalRenderer(async () => new Promise(() => {}), { storage: f.options.storage, runEffects: true, receiptDeadlineMs: 5 })
  const props = { product: { id: 42, jan_code: target.janCode, product_name: '旧名', selling_price: 100, cost_price: 50 }, storeId: 7,
    onAccepted: f.options.onAccepted, onClose: f.options.onClose }
  render(props)
  elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setTimeout(resolve, 20))
  let nodes = elements(render(props))
  assert.equal(nodes.find(node => node.type === 'button' && node.props.children === '受付状態を確認').props.disabled, false)
  assert.match(nodes.find(node => node.props?.role === 'alert').props.children, /BG_EDIT_CHECK_REQUEST/)
  assert.equal(f.values.size, 1)
  const g = fixture()
  g.options.storage.getItem = () => { throw Error('private storage failure') }
  const blocked = modalRenderer(g.options.fetcher, { storage: g.options.storage, runEffects: true })
  blocked(props)
  nodes = elements(blocked(props))
  assert.match(nodes.find(node => node.props?.role === 'alert').props.children, /BG_EDIT_STORAGE.*操作を停止/)
  assert.ok(nodes.filter(node => node.type === 'input').every(node => node.props.disabled))
  assert.equal(g.calls.length, 0)
})

test('通常保存の失敗を診断コードだけで示し、GETなし確認で希望値/同じIDを保持して明示再受付へ進む', async () => {
  const f = fixture(), secret = 'private response body and key'
  let mode = 'failed'
  const render = modalRenderer(async (url, options) => {
    f.calls.push({ url, options })
    if (mode === 'failed') return { ok: false, json: async () => ({ success: false, diagnosticCode: 'BG_EDIT_DB_REJECTED', error: secret }) }
    if (options.method === 'GET') return { ok: true, json: async () => ({ success: true, data: null }) }
    return { ok: true, json: async () => ({ success: true, data: intake }) }
  }, { storage: f.options.storage, runEffects: true })
  const props = { product: { id: 42, jan_code: target.janCode, product_name: '旧名', selling_price: 100, cost_price: 50 }, storeId: 7,
    onAccepted: f.options.onAccepted, onClose: f.options.onClose }
  render(props)
  let nodes = elements(render(props))
  assert.ok(!nodes.some(node => node.props?.role === 'alert'))
  assert.ok(!nodes.some(node => node.props?.children === operationId))
  nodes.find(node => node.type === 'input').props.onChange({ target: { value: '変更名' } })
  elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  nodes = elements(render(props))
  assert.match(nodes.find(node => node.props?.role === 'alert').props.children, /BG_EDIT_DB_REJECTED/)
  assert.ok(!JSON.stringify(nodes).includes(secret))
  assert.ok(nodes.some(node => node.props?.children === operationId))
  assert.ok(!nodes.some(node => node.type === 'button' && node.props.children === '同じ内容で再受付'))
  const preserved = [...f.values.values()][0]
  mode = 'missing'
  nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  nodes = elements(render(props))
  assert.deepEqual(f.calls.map(call => call.options.method), ['POST', 'GET'])
  assert.equal([...f.values.values()][0], preserved)
  assert.equal(nodes.find(node => node.type === 'input').props.value, '変更名')
  assert.ok(nodes.filter(node => node.type === 'input').every(node => node.props.disabled))
  assert.match(nodes.find(node => node.props?.role === 'alert').props.children, /BG_EDIT_NO_INTAKE/)
  assert.equal(f.events.length, 0)
  nodes.find(node => node.type === 'button' && node.props.children === '同じ内容で再受付').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.calls.map(call => call.options.method), ['POST', 'GET', 'GET', 'POST'])
  assert.equal(JSON.parse(f.calls.at(-1).options.body).operationId, operationId)
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).expectedValues, { name: '旧名' })
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
})

test('受付なし確認後もGET失敗なら再受付ボタンを解除し、未知コード/JSON破損/通信例外を表示しない', async () => {
  for (const kind of ['unknown', 'json', 'network', 'noIntakeCode']) {
    const f = fixture(), secret = 'private response or exception'
    f.values.set(exports.backgroundEditStorageKey(target), JSON.stringify({ version: 1, ...target, operationId, patch: { name: '変更名' }, expectedValues: { name: '旧名' } }))
    let missing = true
    const render = modalRenderer(async (url, options) => {
      f.calls.push({ url, options })
      if (missing) return { ok: true, json: async () => ({ success: true, data: null }) }
      if (kind === 'network') throw Error(secret)
      if (kind === 'json') return { ok: true, json: async () => { throw Error(secret) } }
      if (kind === 'noIntakeCode') return { ok: false, json: async () => ({ success: false, diagnosticCode: 'BG_EDIT_NO_INTAKE', error: secret }) }
      return { ok: false, json: async () => ({ success: false, diagnosticCode: secret, error: secret }) }
    }, { storage: f.options.storage, runEffects: true })
    const props = { product: { id: 42, jan_code: target.janCode, product_name: '旧名', selling_price: 100, cost_price: 50 }, storeId: 7,
      onAccepted: f.options.onAccepted, onClose: f.options.onClose }
    render(props)
    elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(elements(render(props)).some(node => node.type === 'button' && node.props.children === '同じ内容で再受付'))
    missing = false
    elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise(resolve => setImmediate(resolve))
    const nodes = elements(render(props))
    assert.ok(!nodes.some(node => node.type === 'button' && node.props.children === '同じ内容で再受付'))
    assert.match(nodes.find(node => node.props?.role === 'alert').props.children,
      kind === 'network' ? /BG_EDIT_CHECK_REQUEST/ : kind === 'noIntakeCode' ? /BG_EDIT_NO_INTAKE/ : /BG_EDIT_CHECK_RESPONSE/)
    if (kind === 'noIntakeCode') assert.doesNotMatch(nodes.find(node => node.props?.role === 'alert').props.children, /まだ受付されていません/)
    assert.ok(!JSON.stringify(nodes).includes(secret))
    assert.deepEqual(f.calls.map(call => call.options.method), ['GET', 'GET'])
    assert.equal(f.values.size, 1)
    assert.equal(f.events.length, 0)
  }
})

test('遅れて取得した希望値をreadonly表示し、要確認は同じIDの再確認/未送信取消へ案内する', () => {
  const render = modalRenderer()
  const product = { id: 42, jan_code: target.janCode, product_name: '旧名', selling_price: 100, cost_price: 50 }
  const props = { product, storeId: 7, onAccepted() {}, onClose() {}, onAdvanced() {} }
  render(props)
  const nodes = elements(render({ ...props, existingOperation: { ...intake, status: 'needs_review', patch: { name: '保持した名前', price: '300' } } }))
  const inputs = nodes.filter(node => node.type === 'input')
  assert.deepEqual(inputs.map(node => node.props.value), ['保持した名前', '300', '50'])
  assert.ok(inputs.every(node => node.props.disabled))
  const buttons = nodes.filter(node => node.type === 'button').map(node => node.props.children)
  assert.ok(buttons.includes('再確認を依頼'))
  assert.ok(buttons.includes('未送信の変更を取り消す'))
  assert.ok(!buttons.includes('保存'))
  assert.ok(!buttons.includes('分類・仕入先を編集'))
  assert.ok(nodes.some(node => node.props?.children === operationId))
})

test('control失敗は固定エラーだけを表示し、readonly希望値と同一IDを保持して閉じない', async () => {
  let accepted = 0, closed = 0; const calls = []
  const render = modalRenderer(async (url, options) => { calls.push({ url, options }); return { ok: false, json: async () => ({ success: false, error: 'private failure detail' }) } })
  const props = { product: { id: 42, jan_code: target.janCode, product_name: '旧名', selling_price: 100, cost_price: 50 }, storeId: 7,
    existingOperation: { ...intake, status: 'needs_review' }, onAccepted() { accepted++ }, onClose() { closed++ } }
  elements(render(props)).find(node => node.type === 'button' && node.props.children === '再確認を依頼').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const nodes = elements(render(props))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/pos-products/background-edit/control')
  assert.equal(JSON.parse(calls[0].options.body).operationId, operationId)
  assert.equal(accepted, 0); assert.equal(closed, 0)
  const alert = nodes.find(node => node.props?.role === 'alert')
  assert.equal(alert.props.children, '操作を受け付けられませんでした。希望値と同じ操作IDを保持しています。再保存せず、状態を確認してください。')
  assert.ok(nodes.filter(node => node.type === 'input').every(node => node.props.disabled))
  assert.equal(nodes.find(node => node.type === 'input').props.value, '変更名')
  assert.ok(nodes.some(node => node.props?.children === operationId))
})

test('両店舗を別対象にし、旧保全情報は旧モーダルへ導き、確定価格を予定値で置換しない', () => {
  const boardSource = readFileSync(new URL('../next_app/components/products/ProductsBoard.tsx', import.meta.url), 'utf8')
  const Background = () => null, Legacy = () => null, Table = () => null, blank = () => null
  for (const storeId of [6, 7]) for (const oldPointer of [false, true]) for (const classificationEnabled of [false, true]) {
    const product = { id: 42, store_id: storeId, jan_code: target.janCode, product_name: '現名称', selling_price: 200, cost_price: 100 }
    const selection = exports.backgroundProductClassificationPatch(classificationSnapshot({ storeId }), { groupId: 'g2', supplierId: null },
      { groupId: true, supplierId: true }, { ...target, storeId })
    const data = { ...intake, storeId, patch: { price: '400', ...(classificationEnabled ? selection.patch : {}) },
      ...(classificationEnabled ? { catalogSnapshotId: selection.catalogSnapshotId, posChoiceBaseline: selection.posChoiceBaseline } : {}) }
    const values = ['商品', [product], false, { product, nonce: 1 }, false, 0, { [`${storeId}:42`]: data }, 0]
    const writes = []; let index = 0, refreshes = 0
    const mocks = {
      react: { useState: () => [values[index++], value => writes.push(value)], useEffect() {}, useRef: value => ({ current: value }) },
      'react/jsx-runtime': require('../next_app/node_modules/react/jsx-runtime'),
      'next/navigation': { useRouter: () => ({ refresh() { refreshes++ } }) },
      'lucide-react': { Search: blank, SquarePen: blank, Loader2: blank },
      '@/components/orders/JanCodeScannerField': { JanCodeScannerField: blank },
      '@/components/products/ProductFormModal': { ProductFormModal: blank },
      '@/components/products/PosProductEditModal': { PosProductEditModal: Legacy },
      '@/components/products/BackgroundProductEditModal': { BackgroundProductEditModal: Background, isBackgroundEditIntake: exports.isBackgroundEditIntake },
      '@/components/products/ProductsSubnav': { ProductsSubnav: blank },
      '@/components/ui/DataTable': { DataTable: Table },
      '@/components/ui/BarcodeToggle': { BarcodeToggle: blank },
      '@/components/ui/StatusBadge': { StatusBadge: blank },
      '@/lib/products': { formatYen: value => String(value), calculateTaxIncludedPrice: value => value * 1.1 },
      '@/lib/productStores': { getProductStoreName: value => value === 7 ? '本店' : 'わんわん' },
    }
    const api = {}
    vm.runInNewContext(ts.transpileModule(boardSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports: api, window: { sessionStorage: { getItem: () => oldPointer ? 'preserved legacy pointer' : null } },
      require: name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name] },
    })
    const tree = api.ProductsBoard({ products: [], backgroundEditEnabled: true, backgroundClassificationEnabled: classificationEnabled, selectedStoreId: storeId })
    const table = elements(tree).find(node => node.type === Table)
    const action = table.props.columns.find(column => column.key === 'actions').render(product)
    action.props.onClick()
    assert.equal(writes[0].legacy, oldPointer)
    const modal = elements(tree).find(node => node.type === Background)
    assert.equal(modal.props.storeId, storeId)
    assert.equal(modal.props.existingOperation.operationId, operationId)
    assert.equal(modal.props.backgroundClassificationEnabled, classificationEnabled)
    assert.equal(typeof modal.props.onAdvanced, classificationEnabled ? 'undefined' : 'function')
    if (classificationEnabled) {
      const information = elements(table.props.columns.find(column => column.key === 'product_name').render(product))
      assert.ok(information.some(node => node.props?.children?.some?.(child => typeof child === 'string' && child.includes('希望の分類'))))
      assert.ok(!JSON.stringify(information).includes('商品グループ g2'))
    }
    modal.props.onAccepted({ ...data, status: 'completed' })
    modal.props.onAccepted({ ...data, status: 'completed' })
    assert.equal(refreshes, 1)
    const pricing = elements(table.props.columns.find(column => column.key === 'pricing').render(product))
    assert.ok(pricing.some(node => node.props?.children?.includes?.('200')))
    assert.equal(product.selling_price, 200)
    const otherStoreButton = table.props.columns.find(column => column.key === 'actions').render({ ...product, store_id: storeId === 7 ? 6 : 7 })
    assert.equal(otherStoreButton.props.disabled, true)
  }
})

test('同時クリックはawait前のref lockで一回の受付に限定する', async () => {
  const f = fixture(); let release
  const wait = new Promise(resolve => { release = resolve })
  const options = { ...f.options, fetcher: async (url, request) => { f.calls.push({ url, options: request }); await wait; return { ok: true, json: async () => ({ success: true, data: intake }) } } }
  const first = exports.acceptBackgroundProductEdit(options)
  await exports.acceptBackgroundProductEdit(options)
  assert.equal(f.calls.length, 1); release(); await first
  assert.equal(f.events.length, 2)
})

test('server flag OFFは旧モーダルで、店舗別行の予定値と有界ポーリングを分離する', () => {
  const page = readFileSync(new URL('../next_app/app/(dashboard)/products/page.tsx', import.meta.url), 'utf8')
  const board = readFileSync(new URL('../next_app/components/products/ProductsBoard.tsx', import.meta.url), 'utf8')
  assert.match(page, /process\.env\.POS_PRODUCT_BACKGROUND_EDIT_ENABLED === 'true'/)
  assert.match(board, /backgroundEditEnabled = false/)
  assert.match(board, /BackgroundProductEditModal/)
  assert.match(board, /PosProductEditModal/)
  assert.match(board, /kennel-pos-edit-execution:v1/)
  assert.match(board, /30_000/)
  assert.match(board, /AbortController/)
  assert.match(board, /slice\([^)]*100/)
  assert.match(board, /反映予定/)
  assert.doesNotMatch(source, /loadPosProductEditor|reviewPosProductEditor/)
})

const snapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
function classificationSnapshot(overrides = {}) {
  return { snapshotId, ...target, capturedAt: Date.now() - 1_000, expiresAt: Date.now() + 300_000,
    currentGroupId: 'g1', currentSupplierId: 's1', groups: [{ id: 'g1', name: '元の分類' }, { id: 'g2', name: '希望の分類' }, { id: 'g3', name: '新しい分類' }],
    suppliers: [{ id: 's1', name: '元の仕入先' }, { id: 's2', name: '新しい仕入先' }], ...overrides }
}
function classificationProps(f) {
  return { product: { id: target.productId, jan_code: target.janCode, product_name: '旧名', selling_price: 100, cost_price: 50 }, storeId: target.storeId,
    backgroundClassificationEnabled: true, onAccepted: f.options.onAccepted, onClose: f.options.onClose }
}
function byLabel(nodes, text) { return nodes.find(node => node.type === 'label' && elements(node).some(child => child.props?.children === text)) }
function choose(render, props, label, value) {
  elements(byLabel(elements(render(props)), label)).find(node => node.type === 'select').props.onChange({ target: { value } })
}
async function settle() { await new Promise(resolve => setImmediate(resolve)) }

test('分類patchは検証済みsnapshotの編集差分だけを含め、仮値/未編集の基準を送らない', () => {
  const snapshot = classificationSnapshot()
  assert.deepEqual(structuredClone(exports.backgroundProductClassificationPatch(snapshot, { groupId: 'g1', supplierId: 's1' }, {}, target)), { patch: {}, expectedValues: {} })
  assert.deepEqual(structuredClone(exports.backgroundProductClassificationPatch(snapshot, { groupId: 'g1', supplierId: 's1' }, { groupId: true, supplierId: true }, target)), { patch: {}, expectedValues: {} })
  const value = structuredClone(exports.backgroundProductClassificationPatch(snapshot, { groupId: 'g2', supplierId: null }, { groupId: true, supplierId: true }, target))
  assert.deepEqual(value.patch, { groupId: 'g2', supplierId: null })
  assert.deepEqual(value.expectedValues, { groupId: 'g1', supplierId: 's1' })
  assert.equal(value.catalogSnapshotId, snapshotId)
  assert.equal(value.posChoiceBaseline.requested.groupId.name, '希望の分類')
  assert.equal(value.posChoiceBaseline.requested.supplierId, null)
  assert.throws(() => exports.backgroundProductClassificationPatch(null, { groupId: 'g2', supplierId: null }, { groupId: true }, target))
  assert.throws(() => exports.backgroundProductClassificationPatch({ ...snapshot, expiresAt: Date.now() - 1 }, { groupId: 'g2', supplierId: 's1' }, { groupId: true }, target))
  assert.throws(() => exports.backgroundProductClassificationPatch(snapshot, { groupId: 'other-store', supplierId: 's1' }, { groupId: true }, target))
})

test('分類初回はcache GET→不存在のときだけ一度refreshし、通常3項目に分類の仮値を混ぜない', async () => {
  const f = fixture()
  const render = modalRenderer(async (url, options) => {
    f.calls.push({ url, options })
    if (url.startsWith('/api/pos-products/background-classification')) return { ok: true, json: async () => ({ success: true, data: options.method === 'GET' ? null : classificationSnapshot() }) }
    return { ok: true, json: async () => ({ success: true, data: intake }) }
  }, { storage: f.options.storage, runEffects: true })
  const props = classificationProps(f)
  props.onAdvanced = () => { throw Error('legacy transition forbidden') }
  render(props)
  elements(render(props)).find(node => node.type === 'button' && node.props.children === '分類・仕入先を編集').props.onClick()
  await settle()
  let nodes = elements(render(props))
  assert.deepEqual(f.calls.map(call => call.options.method), ['GET', 'POST'])
  assert.match(f.calls[0].url, /storeId=7&productId=42/)
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { storeId: 7, productId: 42 })
  assert.deepEqual(nodes.filter(node => node.type === 'select').map(node => node.props.value), ['g1', 's1'])
  assert.ok(nodes.filter(node => node.type === 'input').every(node => !node.props.disabled))
  nodes.find(node => node.type === 'input').props.onChange({ target: { value: '変更名' } })
  elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await settle()
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { operationId, storeId: 7, productId: 42, patch: { name: '変更名' }, expectedValues: { name: '旧名' } })
})

test('分類取得を待つ間でも通常項目を編集/受付でき、分類通信で通常保存をロックしない', async () => {
  const f = fixture(); let finish
  const lookup = new Promise(resolve => { finish = resolve })
  const render = modalRenderer(async (url, options) => {
    f.calls.push({ url, options })
    if (url.startsWith('/api/pos-products/background-classification')) return lookup
    return { ok: true, json: async () => ({ success: true, data: intake }) }
  }, { storage: f.options.storage, runEffects: true })
  const props = classificationProps(f)
  render(props)
  elements(render(props)).find(node => node.type === 'button' && node.props.children === '分類・仕入先を編集').props.onClick()
  const nodes = elements(render(props))
  assert.ok(nodes.filter(node => node.type === 'input').every(node => !node.props.disabled))
  nodes.find(node => node.type === 'input').props.onChange({ target: { value: '変更名' } })
  elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await settle()
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
  assert.equal(f.calls[1].url, '/api/pos-products/background-edit')
  finish({ ok: true, json: async () => ({ success: true, data: classificationSnapshot() }) })
  await settle()
})

test('分類の不正/期限切れ/取得失敗は固定表示だけにして通常入力と保存を妨げず、欠落dataをnull扱いしない', async () => {
  for (const kind of ['store', 'expired', 'missing', 'network']) {
    const f = fixture(), secret = 'private classification failure'
    const render = modalRenderer(async (url, options) => {
      f.calls.push({ url, options })
      if (!url.startsWith('/api/pos-products/background-classification')) return { ok: true, json: async () => ({ success: true, data: intake }) }
      if (kind === 'network') throw Error(secret)
      return { ok: true, json: async () => kind === 'missing' ? { success: true, private: secret }
        : { success: true, data: classificationSnapshot(kind === 'store' ? { storeId: 6 } : { expiresAt: Date.now() - 1 }) } }
    }, { storage: f.options.storage, runEffects: true })
    const props = classificationProps(f)
    render(props)
    elements(render(props)).find(node => node.type === 'button' && node.props.children === '分類・仕入先を編集').props.onClick()
    await settle()
    const nodes = elements(render(props))
    assert.ok(nodes.some(node => node.props?.role === 'alert'))
    assert.ok(!JSON.stringify(nodes).includes(secret))
    assert.equal(f.calls.length, 1)
    assert.ok(nodes.filter(node => node.type === 'input').every(node => !node.props.disabled))
    nodes.find(node => node.type === 'input').props.onChange({ target: { value: '変更名' } })
    elements(render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await settle()
    assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
  }
})

test('明示snapshot更新は編集中の分類/仕入先/通常入力を保持し、最新検証済み基準で変更項目だけ受付する', async () => {
  const f = fixture(), nextSnapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let release
  const refresh = new Promise(resolve => { release = resolve })
  const refreshedSnapshot = classificationSnapshot({ snapshotId: nextSnapshotId, currentGroupId: 'g3', currentSupplierId: 's2' })
  const baseline = exports.backgroundProductClassificationPatch(refreshedSnapshot, { groupId: 'g2', supplierId: null }, { groupId: true, supplierId: true }, target)
  const receipt = { ...intake, catalogSnapshotId: nextSnapshotId, patch: { name: '変更名', groupId: 'g2', supplierId: null }, posChoiceBaseline: baseline.posChoiceBaseline }
  const render = modalRenderer(async (url, options) => {
    f.calls.push({ url, options })
    if (url.startsWith('/api/pos-products/background-classification')) return options.method === 'GET'
      ? { ok: true, json: async () => ({ success: true, data: classificationSnapshot() }) } : refresh
    return { ok: true, json: async () => ({ success: true, data: receipt }) }
  }, { storage: f.options.storage, runEffects: true })
  const props = classificationProps(f)
  render(props)
  elements(render(props)).find(node => node.type === 'button' && node.props.children === '分類・仕入先を編集').props.onClick()
  await settle()
  choose(render, props, '商品グループ', 'g2'); choose(render, props, '仕入先', '')
  elements(render(props)).find(node => node.type === 'input').props.onChange({ target: { value: '変更名' } })
  elements(render(props)).find(node => node.type === 'button' && node.props.children === '候補を再取得').props.onClick()
  release({ ok: true, json: async () => ({ success: true, data: refreshedSnapshot }) })
  await settle()
  const nodes = elements(render(props))
  assert.equal(nodes.find(node => node.type === 'input').props.value, '変更名')
  assert.deepEqual(nodes.filter(node => node.type === 'select').map(node => node.props.value), ['g2', ''])
  nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await settle()
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { operationId, storeId: 7, productId: 42, patch: receipt.patch,
    expectedValues: { name: '旧名', groupId: 'g3', supplierId: 's2' }, catalogSnapshotId: nextSnapshotId })
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
})

test('分類v1保全はsnapshot ID/希望名称/元patch/基準を復元し、GET-only確認と明示再受付で変更しない', async () => {
  const f = fixture()
  const selection = exports.backgroundProductClassificationPatch(classificationSnapshot(), { groupId: 'g2', supplierId: null }, { groupId: true, supplierId: true }, target)
  await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, patch: { ...f.options.patch, ...selection.patch },
    expectedValues: { ...f.options.expectedValues, ...selection.expectedValues }, catalogSnapshotId: selection.catalogSnapshotId,
    posChoiceBaseline: selection.posChoiceBaseline, fetcher: async () => { throw Error('lost ack') } }))
  const saved = structuredClone(exports.readBackgroundEditIntent(f.options.storage, target))
  assert.equal(saved.version, 1); assert.equal(saved.catalogSnapshotId, snapshotId)
  assert.equal(saved.posChoiceBaseline.requested.groupId.name, '希望の分類')
  const options = { ...f.options, patch: { price: '300' }, expectedValues: { price: '250' }, catalogSnapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    createId: () => { throw Error('new id forbidden') }, fetcher: async (url, options) => {
      f.calls.push({ url, options })
      return { ok: true, json: async () => ({ success: true, data: options.method === 'GET' ? null : { ...intake, patch: saved.patch, catalogSnapshotId: snapshotId, posChoiceBaseline: saved.posChoiceBaseline } }) }
    } }
  await assert.rejects(exports.acceptBackgroundProductEdit(options), error => error.code === 'BG_EDIT_NO_INTAKE')
  assert.deepEqual(f.calls.map(call => call.options.method), ['GET'])
  await exports.acceptBackgroundProductEdit({ ...options, retryUnaccepted: true })
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { operationId, storeId: 7, productId: 42,
    patch: { name: '変更名', groupId: 'g2', supplierId: null }, expectedValues: { name: '旧名', groupId: 'g1', supplierId: 's1' }, catalogSnapshotId: snapshotId })
  assert.deepEqual(f.events, [['accepted', operationId], ['closed']])
})

test('classified受付の希望名称をreadonly表示し、未知候補や旧receiptは通常復旧を維持する', () => {
  const f = fixture(), snapshot = classificationSnapshot()
  const selection = exports.backgroundProductClassificationPatch(snapshot, { groupId: 'g2', supplierId: null }, { groupId: true, supplierId: true }, target)
  const operation = { ...intake, patch: { ...intake.patch, ...selection.patch }, catalogSnapshotId: snapshotId, posChoiceBaseline: selection.posChoiceBaseline }
  assert.equal(exports.isBackgroundEditIntake(operation, target, operationId), true)
  assert.equal(exports.isBackgroundEditIntake(intake, target, operationId), true)
  const nodes = elements(modalRenderer()( { ...classificationProps(f), existingOperation: operation } ))
  assert.ok(nodes.some(node => node.props?.children === '希望の分類'))
  assert.ok(nodes.filter(node => node.type === 'input' || node.type === 'select').every(node => node.props.disabled))
  assert.ok(!nodes.some(node => node.type === 'button' && node.props.children === '分類・仕入先を編集'))
})

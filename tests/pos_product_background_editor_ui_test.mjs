import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../next_app/node_modules/typescript')
const source = readFileSync(new URL('../next_app/components/products/BackgroundProductEditModal.tsx', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports, URLSearchParams, require: name => {
    if (name === 'react') return require('../next_app/node_modules/react')
    if (name === 'react/jsx-runtime') return require('../next_app/node_modules/react/jsx-runtime')
    if (name === '@/lib/productStores') return { getProductStoreName: store => store === 7 ? '本店' : 'わんわん' }
    if (name === '@/components/ui/StatusBadge') return { cn: (...values) => values.join(' ') }
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

test('同一ID照会で受付なしを確認した場合も元patchとIDで一度だけ再受付する', async () => {
  const f = fixture()
  await assert.rejects(exports.acceptBackgroundProductEdit({ ...f.options, fetcher: async () => { throw Error('offline') } }))
  let lookups = 0
  await exports.acceptBackgroundProductEdit({ ...f.options, patch: { price: '300' }, expectedValues: { price: '250' }, fetcher: async (url, options) => {
    f.calls.push({ url, options }); if (options.method === 'GET') { lookups++; return { ok: true, json: async () => ({ success: true, data: null }) } }
    return { ok: true, json: async () => ({ success: true, data: intake }) }
  } })
  assert.equal(lookups, 1)
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).patch, { name: '変更名' })
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).expectedValues, { name: '旧名' })
  assert.equal(JSON.parse(f.calls.at(-1).options.body).operationId, operationId)
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

function modalRenderer(fetcher = async () => { throw Error('Unexpected fetch') }) {
  const states = []; let index = 0
  const hooks = { useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
    return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }] },
    useEffect() {}, useRef: value => ({ current: value }), useId: () => 'id' }
  const api = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: api, URLSearchParams, fetch: fetcher, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? require('../next_app/node_modules/react/jsx-runtime') :
      name === '@/lib/productStores' ? { getProductStoreName: () => '本店' } : name === '@/components/ui/StatusBadge' ? { cn: (...values) => values.join(' ') } : (() => { throw Error(name) })(),
  })
  return props => { index = 0; return api.BackgroundProductEditModal(props) }
}

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
  for (const storeId of [6, 7]) for (const oldPointer of [false, true]) {
    const product = { id: 42, store_id: storeId, jan_code: target.janCode, product_name: '現名称', selling_price: 200, cost_price: 100 }
    const data = { ...intake, storeId, patch: { price: '400' } }
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
    const tree = api.ProductsBoard({ products: [], backgroundEditEnabled: true, selectedStoreId: storeId })
    const table = elements(tree).find(node => node.type === Table)
    const action = table.props.columns.find(column => column.key === 'actions').render(product)
    action.props.onClick()
    assert.equal(writes[0].legacy, oldPointer)
    const modal = elements(tree).find(node => node.type === Background)
    assert.equal(modal.props.storeId, storeId)
    assert.equal(modal.props.existingOperation.operationId, operationId)
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
  assert.doesNotMatch(source, /loadPosProductEditor|reviewPosProductEditor|groupId|supplierId/)
})

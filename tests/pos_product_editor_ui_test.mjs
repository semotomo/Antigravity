import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../next_app/node_modules/typescript')
const jsx = require('../next_app/node_modules/react/jsx-runtime')
const { renderToStaticMarkup } = require('../next_app/node_modules/react-dom/server')
const modalPath = 'next_app/components/products/PosProductEditModal.tsx'
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const product = { id: 42, store_id: 7, jan_code: '0490123456789', product_name: 'DBの商品名', is_active: true }
const stores = { getProductStoreName: id => id === 7 ? '本店' : 'わんわん', getProductStoreId: view => view === 'main' ? 7 : view === 'wanwan' ? 6 : null }
const blankComponent = () => null

function compile(path, overrides = {}) {
  const exports = {}
  const mocks = {
    'react': require('../next_app/node_modules/react'),
    'react/jsx-runtime': jsx,
    'lucide-react': { X: blankComponent, Search: blankComponent, SquarePen: blankComponent, Loader2: blankComponent },
    '@/lib/productStores': stores,
    '@/components/products/ProductSyncNotifications': { ProductSyncNotifications: blankComponent },
    '@/components/ui/StatusBadge': { cn: (...values) => values.join(' '), StatusBadge: blankComponent },
    '@/app/actions/posProducts': {
      loadPosProductEditorAction: () => { throw new Error('Unexpected server call') },
      reviewPosProductEditorAction: () => { throw new Error('Unexpected server call') },
    },
    ...overrides,
  }
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, process: { env: overrides.env ?? {} }, require: name => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected module: ${name}`)
    return mocks[name]
  } }, { filename: path })
  return exports
}

const api = compile(modalPath)
const initial = () => api.initialProductEditorState()
const reduce = (state, event) => api.productEditorReducer(state, event)
const fixture = changes => ({ storeId: 7, productId: 42, janCode: product.jan_code, capturedAt: 1800000000000,
  fingerprint: 'a'.repeat(64), fields: { name: 'POSの商品名', groupId: 'group7', price: '126', cost: '75', supplierId: 'supplier7' },
  groups: [{ id: 'group7', name: '本店の商品グループ' }], suppliers: [{ id: 'supplier7', name: '本店の仕入先' }], ...changes })
const loaded = () => reduce(initial(), { type: 'loaded', data: fixture() })
const edited = () => reduce(loaded(), { type: 'changed', field: 'name', value: '変更後の商品名' })
const review = () => ({ operationId, reviewedAt: 1800000000001000, changes: [{ field: 'name', label: '商品名', before: 'POSの商品名', after: '変更後の商品名' }] })

test('POS読込は現在値をそのまま使い、原価50パーセントやDB値へ置換しない', () => {
  const data = fixture()
  const state = reduce(initial(), { type: 'loaded', data })
  assert.deepEqual(structuredClone(state.draft), data.fields)
  assert.notEqual(state.draft, data.fields)
  assert.equal(api.hasProductEditorChanges(state), false)
  const priceChanged = reduce(state, { type: 'changed', field: 'price', value: '300' })
  assert.equal(priceChanged.draft.cost, '75')
  assert.equal(api.hasProductEditorChanges(priceChanged), true)
})

test('読込・確認エラーでは入力と編集開始時の基準を保持する', () => {
  const before = reduce(edited(), { type: 'reviewed', data: review() })
  const after = reduce(before, { type: 'failed', error: 'POSを確認できません' })
  assert.equal(after.draft, before.draft)
  assert.equal(after.baseline, before.baseline)
  assert.equal(after.review, null)
  assert.equal(after.error, 'POSを確認できません')
})

test('再取得値を別保持し、明示選択まで入力と旧指紋を変更しない', () => {
  const before = edited()
  const latest = fixture({ fingerprint: 'b'.repeat(64), fields: { ...fixture().fields, price: '200', cost: '90' } })
  const refreshed = reduce(before, { type: 'loaded', data: latest })
  assert.equal(refreshed.draft, before.draft)
  assert.equal(refreshed.baseline, before.baseline)
  assert.equal(refreshed.refreshed, latest)
  const kept = reduce(refreshed, { type: 'keep-input' })
  assert.equal(kept.draft, before.draft)
  assert.equal(kept.baseline, latest)
  assert.equal(kept.refreshed, null)
  assert.equal(kept.review, null)
})

test('明示した置換だけが再取得したPOS値を入力へ反映する', () => {
  const latest = fixture({ fingerprint: 'b'.repeat(64), fields: { ...fixture().fields, name: '再取得した名前', cost: '90' } })
  const after = reduce(reduce(edited(), { type: 'loaded', data: latest }), { type: 'replace-input' })
  assert.deepEqual(structuredClone(after.draft), latest.fields)
  assert.equal(after.baseline, latest)
  assert.equal(api.hasProductEditorChanges(after), false)
})

test('確認後の入力変更はレビューを無効化し、仕入先未設定はnullにする', () => {
  const before = reduce(edited(), { type: 'reviewed', data: review() })
  const after = reduce(before, { type: 'changed', field: 'supplierId', value: '' })
  assert.equal(after.review, null)
  assert.equal(after.draft.supplierId, null)
  assert.equal(after.draft.cost, before.draft.cost)
})

function hooks(state, { pending = null, busy = false, updates = [] } = {}) {
  let refs = 0
  let states = 0
  return { useReducer: () => [state, event => updates.push(event)], useEffect: () => {}, useId: () => 'dialog-id',
    useRef: value => ({ current: refs++ === 1 ? busy : value }),
    useState: value => [states++ === 0 ? pending : value, value => updates.push(value)] }
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(elements)
  return tree.props ? [tree, ...elements(tree.props.children)] : []
}

test('準備専用画面は店舗とJANを固定表示し、5項目と未保存レビューを表示する', () => {
  const state = reduce(edited(), { type: 'reviewed', data: review() })
  const ui = compile(modalPath, { react: hooks(state) })
  const tree = ui.PosProductEditModal({ product, storeId: 7, onClose: () => {} })
  const markup = renderToStaticMarkup(tree)
  assert.match(markup, /POS保存はまだ有効になっていません/)
  assert.match(markup, /確認した変更内容（未保存）/)
  assert.match(markup, /変更後の商品名/)
  assert.match(markup, /本店.*0490123456789/)
  const controls = elements(tree).filter(element => ['input', 'select'].includes(element.type))
  assert.equal(controls.length, 5)
  assert.equal(controls.some(element => element.props.value === product.jan_code), false)
  const buttons = elements(tree).filter(element => element.type === 'button')
  assert.equal(buttons.some(element => typeof element.props.children === 'string' && /保存|更新する/.test(element.props.children)), false)
})

test('通信中は閉じる・Escapeを拒否し、変更入力があれば破棄確認へ進む', () => {
  let closes = 0
  const updates = []
  const busyUi = compile(modalPath, { react: hooks(edited(), { pending: 'review', busy: true, updates }) })
  const busyTree = busyUi.PosProductEditModal({ product, storeId: 7, onClose: () => closes++ })
  const closeButton = elements(busyTree).find(element => element.type === 'button' && element.props['aria-label'] === '閉じる')
  assert.equal(closeButton.props.disabled, true)
  closeButton.props.onClick()
  let prevented = false
  busyTree.props.onCancel({ preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(closes, 0)
  const idleUi = compile(modalPath, { react: hooks(edited(), { updates }) })
  idleUi.PosProductEditModal({ product, storeId: 7, onClose: () => closes++ }).props.onCancel({ preventDefault() {} })
  assert.equal(updates.at(-1), 'close')
  assert.equal(closes, 0)
})

test('フラグONの全店・他店行は編集拒否し、OFFでは既存モーダル契約を維持する', () => {
  const Legacy = () => null
  const Pos = () => null
  const Table = () => null
  function board(flag, storeId, dialog = null) {
    let index = 0
    const writes = []
    const values = ['検索語', [product], false, dialog, false]
    const ui = compile('next_app/components/products/ProductsBoard.tsx', {
      react: { useEffect: () => {}, useState: () => [values[index++], value => writes.push(value)] },
      '@/components/orders/JanCodeScannerField': { JanCodeScannerField: blankComponent },
      '@/components/products/ProductFormModal': { ProductFormModal: Legacy },
      '@/components/products/PosProductEditModal': { PosProductEditModal: Pos },
      '@/components/products/ProductsSubnav': { ProductsSubnav: blankComponent },
      '@/components/ui/DataTable': { DataTable: Table },
      '@/components/ui/BarcodeToggle': { BarcodeToggle: blankComponent },
      '@/lib/products': {},
    })
    const tree = ui.ProductsBoard({ products: [], posEditorEnabled: flag, selectedStoreId: storeId })
    const table = elements(tree).find(element => element.type === Table)
    const button = table.props.columns.find(column => column.key === 'actions').render(product)
    return { tree, button, writes }
  }
  for (const storeId of [null, 6]) {
    const blocked = board(true, storeId)
    assert.equal(blocked.button.props.disabled, true)
    blocked.button.props.onClick()
    assert.equal(blocked.writes.length, 0)
  }
  const allowed = board(true, 7)
  assert.equal(allowed.button.props.disabled, false)
  allowed.button.props.onClick()
  assert.equal(allowed.writes[0].product, product)
  const dialog = { product, nonce: 123 }
  const legacy = elements(board(false, null, dialog).tree).find(element => element.type === Legacy)
  assert.equal(legacy.props.open, true)
  assert.equal(legacy.props.product, product)
  const posTree = elements(board(true, 7, dialog).tree)
  assert.ok(posTree.find(element => element.type === Pos))
  assert.equal(posTree.some(element => element.type === Legacy), false)
})

test('ページはサーバーフラグのtrueだけで有効化し、全店舗をnullとして渡す', async () => {
  const Board = () => null
  for (const [flag, view, expectedStore] of [['true', 'all', null], ['false', 'main', 7], ['TRUE', 'wanwan', 6]]) {
    const page = compile('next_app/app/(dashboard)/products/page.tsx', {
      env: { POS_PRODUCT_EDITOR_ENABLED: flag },
      '@/components/products/ProductsBoard': { ProductsBoard: Board },
      '@/lib/storeAuth': { getStoreContext: async () => ({ currentView: view }) },
    })
    const element = elements(await page.default()).find(item => item.type === Board)
    assert.equal(element.props.posEditorEnabled, flag === 'true')
    assert.equal(element.props.selectedStoreId, expectedStore)
  }
})

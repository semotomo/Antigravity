import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../next_app/node_modules/typescript')
const jsx = require('../next_app/node_modules/react/jsx-runtime')
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const product = { id: 42, store_id: 7, jan_code: '0490123456789', product_name: 'DBの商品名', is_active: true }
const pointer = { storeId: 7, productId: 42, operationId }
const fixture = { storeId: 7, productId: 42, janCode: product.jan_code, capturedAt: 1800000000000,
  fingerprint: 'a'.repeat(64), fields: { name: 'POS商品', groupId: 'g', price: '126', cost: '75', supplierId: null },
  groups: [{ id: 'g', name: '分類' }], suppliers: [] }
const review = { operationId, reviewedAt: 1800000000000, changes: [{ field: 'name', label: '商品名', before: 'POS商品', after: '変更後' }] }
const execution = (patch = {}) => ({ storeId: 7, operationId, status: 'prepared', version: 0, sendAttempts: 0,
  stage: 'prepared', nextAction: 'save', posValuesVerified: null, expiresAt: 1800000060000, message: '準備済み', ...patch })
const recoveryState = (patch = {}) => ({ ...pointer, state: 'prepared', canCancel: true, releaseAllowed: false, message: '未送信', ...patch })

function compile(path, overrides = {}, globals = {}) {
  const exports = {}
  const mocks = {
    react: require('../next_app/node_modules/react'), 'react/jsx-runtime': jsx,
    'lucide-react': { X: () => null, Search: () => null, SquarePen: () => null, Loader2: () => null },
    '@/lib/productStores': { getProductStoreName: () => '本店', getProductStoreId: view => view === 'main' ? 7 : view === 'wanwan' ? 6 : null },
    '@/components/ui/StatusBadge': { cn: (...values) => values.join(' '), StatusBadge: () => null },
    '@/app/actions/posProducts': {}, '@/app/actions/posProductExecution': {}, ...overrides,
    '@/components/products/ProductSyncNotifications': { ProductSyncNotifications: () => null },
    '@/lib/pos-products/validation': { parsePosProductCommand: value => validation.parsePosProductCommand(JSON.parse(JSON.stringify(value))) },
  }
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, process: { env: overrides.env ?? {} }, require: name => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected module: ${name}`)
    return mocks[name]
  }, ...globals }, { filename: path })
  return exports
}
const modalPath = 'next_app/components/products/PosProductEditModal.tsx'
const validation = compile('next_app/lib/pos-products/validation.ts', {}, { Object })
const api = compile(modalPath)
const reduce = api.productEditorReducer
function reviewedState() {
  let state = reduce(api.initialProductEditorState(), { type: 'storage-ready' })
  state = reduce(state, { type: 'loaded', data: fixture })
  state = reduce(state, { type: 'changed', field: 'name', value: '変更後' })
  return reduce(state, { type: 'reviewed', data: review })
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(elements)
  return tree.props ? [tree, ...elements(tree.props.children)] : []
}

const settle = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function harness({ actions = {}, stored = null, storedIntent = null, storedPhase = null, savingEnabled = true, storageError = false } = {}) {
  let state = api.initialProductEditorState()
  let refsIndex = 0, statesIndex = 0, effectsIndex = 0, closes = 0, saved = 0
  const refs = [], states = [], effects = [], calls = [], storageWrites = []
  const storage = new Map(stored === null ? [] : [['kennel-pos-edit-execution:v1:7:42', stored]])
  if (storedIntent !== null) storage.set('kennel-pos-edit-intent:v1:7:42', storedIntent)
  if (storedPhase !== null) storage.set('kennel-pos-edit-phase:v1:7:42', storedPhase)
  const window = { sessionStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { if (storageError) throw new Error('blocked'); storageWrites.push(value); storage.set(key, value) },
    removeItem: key => storage.delete(key),
  }, addEventListener() {}, removeEventListener() {} }
  const mockActions = {
    loadPosProductEditorAction: async input => { calls.push(['load', structuredClone(input)]); return { success: true, data: fixture } },
    reviewPosProductEditorAction: async input => { calls.push(['review', structuredClone(input)]); return { success: true, data: review } },
    preparePosProductEditorAction: async input => { calls.push(['prepare', structuredClone(input)]); return { success: true, data: execution() } },
    savePosProductEditorAction: async input => { calls.push(['save', structuredClone(input)]); return { success: true, data: execution({ status: 'completed', stage: 'completed', nextAction: 'none', sendAttempts: 1, posValuesVerified: true, version: 4 }) } },
    recoverPosProductEditorAction: async input => { calls.push(['recover', structuredClone(input)]); return { success: true, data: execution() } },
    inspectPosProductEditorRecoveryAction: async input => { calls.push(['inspect', structuredClone(input)]); return { success: true, data: recoveryState() } },
    cancelPosProductEditorAction: async input => { calls.push(['cancel', structuredClone(input)]); return { success: true, data: recoveryState({ state: 'cancelled', canCancel: false, releaseAllowed: true }) } },
    ...actions,
  }
  const react = {
    useReducer: () => [state, event => { state = reduce(state, event) }],
    useState: initial => { const index = statesIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
    useRef: initial => { const index = refsIndex++; refs[index] ??= { current: initial }; return refs[index] },
    useEffect: fn => { const index = effectsIndex++; effects[index] ??= fn }, useId: () => 'dialog-id',
  }
  const ui = compile(modalPath, { react, '@/app/actions/posProducts': mockActions, '@/app/actions/posProductExecution': mockActions },
    { window, queueMicrotask, crypto: { randomUUID: () => operationId } })
  function render() {
    refsIndex = 0; statesIndex = 0; effectsIndex = 0
    return ui.PosProductEditModal({ product, storeId: 7, savingEnabled, onClose: () => closes++, onSaved: () => saved++ })
  }
  function button(label) { const result = elements(render()).find(element => element.type === 'button' && element.props.children === label); assert.ok(result, `Button missing: ${label}`); return result }
  async function mount() { render(); effects.forEach(effect => effect()); await settle() }
  async function readAndReview() {
    await button('POSから読み込む').props.onClick()
    elements(render()).find(element => element.type === 'input' && element.props.value === 'POS商品').props.onChange({ target: { value: '変更後' } })
    elements(render()).find(element => element.type === 'form').props.onSubmit({ preventDefault() {} })
    await settle()
  }
  function confirmSave() { button('POSへ保存...').props.onClick(); const confirm = button('確認した内容をPOSへ保存する'); confirm.props.onClick(); return confirm }
  return { render, button, mount, readAndReview, confirmSave, calls, storage, storageWrites,
    get state() { return state }, get closes() { return closes }, get saved() { return saved } }
}

test('破損intentでも元pointerを保持し、明示サーバー照合→取消確認→closeだけで解除する', async () => {
  const ui = harness({ stored: JSON.stringify(pointer), storedIntent: '{broken', storedPhase: 'prepare' })
  await ui.mount()
  assert.equal(ui.state.storageBlocked, true); assert.deepEqual(JSON.parse(JSON.stringify(ui.state.recovery)), pointer)
  ui.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  assert.deepEqual(ui.calls, [['inspect', pointer]])
  ui.button('未送信の操作を取り消す...').props.onClick()
  assert.equal(ui.calls.length, 1)
  ui.button('この操作の未送信取消を実行').props.onClick(); await settle()
  assert.deepEqual(ui.calls, [['inspect', pointer], ['cancel', pointer]])
  assert.equal(ui.state.recoveryCheck.state, 'cancelled'); assert.ok(ui.storage.size > 0)
  ui.button('閉じる').props.onClick(); ui.button('確認済みの復旧情報を解除して閉じる').props.onClick()
  assert.equal(ui.closes, 1); assert.equal(ui.storage.size, 0)
})

test('途中書込みのintentだけから同じIDを救済し、notfoundは解除せず取消応答後も自動保存しない', async () => {
  const command = { kind: 'update', ...pointer, expectedFingerprint: fixture.fingerprint, fields: fixture.fields }
  const ui = harness({ storedIntent: JSON.stringify(command), storedPhase: 'prepare', actions: {
    inspectPosProductEditorRecoveryAction: async input => { assert.deepEqual(JSON.parse(JSON.stringify(input)), pointer); return { success: true, data: recoveryState({ state: 'not_created' }) } },
  } })
  await ui.mount(); assert.equal(ui.state.storageBlocked, true); assert.equal(ui.state.recovery.operationId, operationId)
  ui.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  assert.equal(ui.state.recoveryCheck.releaseAllowed, false)
  ui.button('未送信の操作を取り消す...').props.onClick(); ui.button('この操作の未送信取消を実行').props.onClick(); await settle()
  assert.equal(ui.state.recoveryCheck.state, 'cancelled')
  assert.deepEqual(ui.calls.map(call => call[0]), ['cancel']); assert.equal(ui.closes, 0)
})

test('取消失敗/送信後の状態では入力とstorageを保持し、明示確認なしの取消/解除をしない', async () => {
  const ui = harness({ stored: JSON.stringify(pointer), actions: { cancelPosProductEditorAction: async () => ({ success: false, error: '結果未確認' }) } })
  await ui.mount(); ui.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  ui.button('未送信の操作を取り消す...').props.onClick(); ui.button('この操作の未送信取消を実行').props.onClick(); await settle()
  assert.equal(ui.state.recoveryCheck, null); assert.equal(ui.state.executionNeedsRecovery, true)
  ui.button('閉じる').props.onClick(); ui.button('保存状況を保持して閉じる').props.onClick(); assert.ok(ui.storage.size > 0)
  const sent = harness({ stored: JSON.stringify(pointer), actions: { inspectPosProductEditorRecoveryAction: async () => ({ success: true, data: recoveryState({ state: 'in_progress', canCancel: false }) }) } })
  await sent.mount(); sent.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  assert.throws(() => sent.button('未送信の操作を取り消す...'))
})

test('元IDを回収できない全破損storageは救済UUIDで読取りだけ行い、terminal応答でも解除不可', async () => {
  const ui = harness({ stored: '{broken', actions: { inspectPosProductEditorRecoveryAction: async () => ({ success: true, data: recoveryState({ state: 'completed', canCancel: false, releaseAllowed: true }) }) } })
  await ui.mount()
  elements(ui.render()).find(element => element.type === 'input' && element.props['aria-label'] === '救済確認の操作ID').props.onChange({ target: { value: operationId } })
  ui.button('操作IDで状態だけ確認').props.onClick(); await settle()
  assert.equal(ui.state.recoveryCheck.state, 'completed'); assert.equal(ui.state.storageIdentityAmbiguous, true)
  assert.throws(() => ui.button('未送信の操作を取り消す...'))
  ui.button('閉じる').props.onClick(); ui.button('保存状況を保持して閉じる').props.onClick()
  assert.equal(ui.storage.get('kennel-pos-edit-execution:v1:7:42'), '{broken')
})

test('storageの複数UUID混在や別対象の解除DTOでは一括削除せず、安全停止を維持する', async () => {
  const command = { kind: 'update', ...pointer, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expectedFingerprint: fixture.fingerprint, fields: fixture.fields }
  const ui = harness({ stored: JSON.stringify(pointer), storedIntent: JSON.stringify(command), storedPhase: 'prepare', actions: {
    inspectPosProductEditorRecoveryAction: async () => ({ success: true, data: recoveryState({ state: 'cancelled', canCancel: false, releaseAllowed: true }) }),
  } })
  await ui.mount(); assert.equal(ui.state.storageIdentityAmbiguous, true)
  ui.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  ui.button('閉じる').props.onClick(); ui.button('保存状況を保持して閉じる').props.onClick()
  assert.equal(ui.storage.size, 3)
  const other = harness({ stored: JSON.stringify(pointer), actions: {
    inspectPosProductEditorRecoveryAction: async () => ({ success: true, data: recoveryState({ productId: 43, state: 'cancelled', canCancel: false, releaseAllowed: true }) }),
  } })
  await other.mount(); other.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  assert.equal(other.state.recoveryCheck, null); assert.equal(other.state.executionNeedsRecovery, true)
  assert.equal(other.storage.size, 1)
})

test('実行開始後は入力・基準・レビューと同じ操作IDを固定し、失敗でも保持する', () => {
  const before = reviewedState()
  const locked = reduce(before, { type: 'execution-started', pointer })
  const failed = reduce(locked, { type: 'execution-failed', error: '応答不明' })
  assert.equal(failed.recovery.operationId, operationId)
  assert.equal(failed.draft, before.draft)
  assert.equal(failed.review, before.review)
  for (const event of [{ type: 'changed', field: 'name', value: '再変更' }, { type: 'loaded', data: fixture },
    { type: 'replace-input' }, { type: 'keep-input' }, { type: 'reviewed', data: { ...review, operationId: 'other' } }]) {
    assert.equal(reduce(failed, event), failed)
  }
})

test('復旧pointerは店舗・商品・UUIDだけを受け入れ、他店舗や余分な値は拒否する', () => {
  assert.deepEqual(structuredClone(api.parseProductEditorRecovery(JSON.stringify(pointer), 7, 42)), pointer)
  assert.equal(api.parseProductEditorRecovery(null, 7, 42), null)
  for (const value of ['bad-json', 'null', '[]', JSON.stringify({ ...pointer, storeId: 6 }),
    JSON.stringify({ ...pointer, productId: 43 }), JSON.stringify({ ...pointer, operationId: 'invalid' }),
    JSON.stringify({ ...pointer, fields: fixture.fields })]) {
    assert.throws(() => api.parseProductEditorRecovery(value, 7, 42))
  }
})

test('復旧した操作は新入力・新操作に戻れず、結果表示がcompletedでも値を保持する', () => {
  const locked = reduce(reviewedState(), { type: 'execution-started', pointer })
  const completed = execution({ status: 'completed', stage: 'completed', nextAction: 'none', sendAttempts: 1, posValuesVerified: true, version: 4 })
  const after = reduce(locked, { type: 'execution-result', data: completed })
  assert.equal(after.execution, completed)
  assert.equal(after.draft, locked.draft)
  assert.equal(after.review, locked.review)
  assert.equal(after.recovery, locked.recovery)
  assert.equal(reduce(after, { type: 'changed', field: 'cost', value: '1' }), after)
})

test('明示保存はawait前に入力を固定し、prepare全体→saveの店舗/操作IDだけを一度呼ぶ', async () => {
  const pending = deferred()
  let command
  const ui = harness({ actions: { preparePosProductEditorAction: async input => { command = structuredClone(input); return pending.promise } } })
  await ui.mount(); await ui.readAndReview()
  const confirm = ui.confirmSave()
  assert.equal(ui.state.recovery.operationId, operationId)
  assert.equal(ui.state.draft.name, '変更後')
  confirm.props.onClick()
  ui.render().props.onCancel({ preventDefault() {} })
  assert.equal(ui.closes, 0)
  elements(ui.render()).find(element => element.type === 'input' && element.props.value === '変更後').props.onChange({ target: { value: '危険な再変更' } })
  assert.equal(ui.state.draft.name, '変更後')
  await settle()
  assert.deepEqual(JSON.parse(ui.storage.get('kennel-pos-edit-execution:v1:7:42')), pointer)
  assert.deepEqual(JSON.parse(ui.storage.get('kennel-pos-edit-intent:v1:7:42')), command)
  assert.equal(ui.storage.get('kennel-pos-edit-phase:v1:7:42'), 'prepare')
  assert.deepEqual(command, { kind: 'update', ...pointer, expectedFingerprint: fixture.fingerprint, fields: { ...fixture.fields, name: '変更後' } })
  pending.resolve({ success: true, data: execution() }); await settle()
  assert.deepEqual(ui.calls.filter(call => call[0] === 'save'), [['save', { storeId: 7, operationId }]])
  assert.equal(ui.state.execution.stage, 'completed')
  assert.equal(ui.state.draft.name, '変更後')
  assert.equal(ui.saved, 1)
  assert.equal(ui.storage.get('kennel-pos-edit-phase:v1:7:42'), 'execute')
  ui.button('閉じる').props.onClick()
  ui.button('完了して閉じる').props.onClick()
  assert.equal(ui.closes, 1)
  assert.equal(ui.storage.size, 0)
})

test('保存応答の消失はレビューと入力を保持し、自動再送・自動recover・古いprepared継続をしない', async () => {
  const ui = harness({ actions: { savePosProductEditorAction: async () => { throw new Error('response lost') } } })
  await ui.mount(); await ui.readAndReview(); const before = ui.state.review
  ui.confirmSave(); await settle()
  assert.equal(ui.state.review, before)
  assert.equal(ui.state.draft.name, '変更後')
  assert.equal(ui.state.executionNeedsRecovery, true)
  assert.equal(ui.calls.some(call => call[0] === 'recover'), false)
  assert.equal(elements(ui.render()).some(element => element.props.children === '同じ操作で保存を続ける'), false)
  ui.button('閉じる').props.onClick()
  const text = elements(ui.render()).flatMap(element => typeof element.props.children === 'string' ? [element.props.children] : []).join(' ')
  assert.doesNotMatch(text, /POSには保存されていません/)
  ui.button('保存状況を保持して閉じる').props.onClick()
  assert.equal(ui.closes, 1)
  assert.equal(ui.storage.size, 3)
})

test('prepare失敗でも同じ操作を保持し、保存は呼ばず明示読取り復旧を許可する', async () => {
  const ui = harness({ actions: { preparePosProductEditorAction: async () => ({ success: false, error: '準備応答不明' }) } })
  await ui.mount(); await ui.readAndReview(); ui.confirmSave(); await settle()
  assert.equal(ui.state.error, '準備応答不明')
  assert.equal(ui.calls.some(call => call[0] === 'save'), false)
  assert.equal(ui.state.recovery.operationId, operationId)
  await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
  assert.deepEqual(ui.calls.filter(call => call[0] === 'recover'), [['recover', { storeId: 7, operationId }]])
  assert.equal(ui.calls.some(call => call[0] === 'save'), false)
  assert.equal(ui.state.execution.nextAction, 'save')
})

test('RPC前の準備失敗は同じ固定入力でprepareだけを明示再試行し、自動saveしない', async () => {
  const commands = []
  const ui = harness({ actions: { preparePosProductEditorAction: async input => {
    commands.push(structuredClone(input))
    return commands.length === 1 ? { success: false, error: 'RPC前に失敗' } : { success: true, data: execution() }
  } } })
  await ui.mount(); await ui.readAndReview(); ui.confirmSave(); await settle()
  ui.button('同じ入力で保存準備だけ再試行').props.onClick(); await settle()
  assert.equal(commands.length, 2)
  assert.deepEqual(commands[1], commands[0])
  assert.equal(ui.calls.some(call => call[0] === 'save'), false)
  assert.equal(ui.state.execution.nextAction, 'save')
  assert.ok(ui.button('同じ操作で保存を続ける'))
})

test('dispatch未登録preparedはrecover後にprepareだけ再試行し、reloadでも同じID/入力を使う', async () => {
  const command = { kind: 'update', ...pointer, expectedFingerprint: fixture.fingerprint, fields: { ...fixture.fields, name: '固定した入力' } }
  let retried
  const ui = harness({ stored: JSON.stringify(pointer), storedIntent: JSON.stringify(command), storedPhase: 'execute',
    actions: { recoverPosProductEditorAction: async () => ({ success: true, data: execution({ nextAction: 'none' }) }),
      preparePosProductEditorAction: async input => { retried = structuredClone(input); return { success: true, data: execution() } } } })
  await ui.mount()
  assert.equal(ui.calls.length, 0)
  assert.equal(elements(ui.render()).some(element => element.props.children === '同じ入力で保存準備だけ再試行'), false)
  await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
  ui.button('同じ入力で保存準備だけ再試行').props.onClick(); await settle()
  assert.deepEqual(retried, command)
  assert.equal(ui.state.draft.name, '固定した入力')
  assert.equal(ui.calls.some(call => call[0] === 'save'), false)
})

test('reloadのprepare段階は手動再準備を許すが、execute/uncertain/dispatchingは許さない', async () => {
  const command = { kind: 'update', ...pointer, expectedFingerprint: fixture.fingerprint, fields: { ...fixture.fields, name: '固定した入力' } }
  const preparing = harness({ stored: JSON.stringify(pointer), storedIntent: JSON.stringify(command), storedPhase: 'prepare' })
  await preparing.mount()
  assert.equal(preparing.calls.length, 0)
  preparing.button('同じ入力で保存準備だけ再試行').props.onClick(); await settle()
  assert.deepEqual(preparing.calls, [['prepare', command]])
  for (const stage of ['verification_required', 'dispatching']) {
    const ui = harness({ stored: JSON.stringify(pointer), storedIntent: JSON.stringify(command), storedPhase: 'execute',
      actions: { recoverPosProductEditorAction: async () => ({ success: true, data: execution({ stage, status: stage === 'dispatching' ? 'dispatching' : 'uncertain', sendAttempts: 1, nextAction: 'verify' }) }) } })
    await ui.mount(); await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
    assert.equal(elements(ui.render()).some(element => element.props.children === '同じ入力で保存準備だけ再試行'), false)
  }
})

test('保存された固定入力の対象・全業務キー・秘密混入・phase不正は安全停止する', async () => {
  const command = { kind: 'update', ...pointer, expectedFingerprint: fixture.fingerprint, fields: { ...fixture.fields, name: '固定した入力' } }
  for (const intent of [{ ...command, storeId: 6 }, { ...command, productId: 99 }, { ...command, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { ...command, actorId: 'secret' }, { ...command, expectedResultFingerprint: 'secret' },
    { ...command, fields: { ...command.fields, posProductId: 'private' } }, { ...command, fields: { name: '欠落' } }]) {
    const ui = harness({ stored: JSON.stringify(pointer), storedIntent: JSON.stringify(intent), storedPhase: 'prepare' })
    await ui.mount()
    assert.equal(ui.state.storageBlocked, true)
    assert.equal(ui.calls.length, 0)
    assert.equal(elements(ui.render()).some(element => element.props.children === '同じ入力で保存準備だけ再試行'), false)
  }
  const invalid = harness({ stored: JSON.stringify(pointer), storedIntent: JSON.stringify(command), storedPhase: 'arbitrary' })
  await invalid.mount()
  assert.equal(invalid.state.storageBlocked, true)
})

test('reload後はpointerだけを復元し、明示recover前に新読込/新操作/自動通信をしない', async () => {
  const ui = harness({ stored: JSON.stringify(pointer), savingEnabled: false })
  await ui.mount()
  assert.deepEqual(structuredClone(ui.state.recovery), pointer)
  assert.equal(ui.state.draft, null)
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.button('POSから読み込む').props.disabled, true)
  await ui.button('POSから読み込む').props.onClick()
  assert.equal(ui.calls.length, 0)
  await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
  assert.deepEqual(ui.calls, [['recover', { storeId: 7, operationId }]])
  assert.equal(elements(ui.render()).some(element => element.props.children === '同じ操作で保存を続ける'), false)
})

test('復旧nextAction verify/apply_db/saveは明示確認後に同じtargetだけを送る', async () => {
  for (const [nextAction, stage, label] of [['verify', 'verification_required', 'POSの結果を照合する'], ['apply_db', 'db_pending', '確認済みPOS値をDBへ反映'], ['save', 'prepared', '同じ操作で保存を続ける']]) {
    const ui = harness({ stored: JSON.stringify(pointer), actions: { recoverPosProductEditorAction: async () => ({ success: true, data: execution({ nextAction, stage }) }) } })
    await ui.mount(); await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
    ui.button(label).props.onClick()
    assert.equal(ui.calls.length, 0)
    ui.button('同じ操作で処理を続ける').props.onClick(); await settle()
    assert.deepEqual(ui.calls, [['save', { storeId: 7, operationId }]])
    assert.equal(ui.saved, 1)
    await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
    assert.equal(ui.saved, 1)
  }
})

test('新規POS送信がOFFでも認可済みDTOのverify/apply_dbだけ継続し、saveは隠す', async () => {
  for (const [nextAction, stage, label] of [['verify', 'verification_required', 'POSの結果を照合する'], ['apply_db', 'db_pending', '確認済みPOS値をDBへ反映'], ['save', 'prepared', '同じ操作で保存を続ける']]) {
    const ui = harness({ stored: JSON.stringify(pointer), savingEnabled: false,
      actions: { recoverPosProductEditorAction: async () => ({ success: true, data: execution({ nextAction, stage }) }) } })
    await ui.mount(); await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
    if (nextAction === 'save') {
      assert.equal(elements(ui.render()).some(element => element.props.children === label), false)
      assert.equal(ui.calls.length, 0)
    } else {
      ui.button(label).props.onClick()
      ui.button('同じ操作で処理を続ける').props.onClick(); await settle()
      assert.deepEqual(ui.calls, [['save', { storeId: 7, operationId }]])
      assert.equal(ui.saved, 1)
    }
    assert.equal(elements(ui.render()).some(element => element.props.children === 'POSへ保存...'), false)
  }
})

test('pointerだけの確定rejectedは対象3項目の読取り確認後のcloseだけで解除する', async () => {
  const rejected = execution({ status: 'rejected', stage: 'rejected', nextAction: 'none', sendAttempts: 0, expiresAt: null })
  const ui = harness({ stored: JSON.stringify(pointer), actions: { recoverPosProductEditorAction: async () => ({ success: true, data: rejected }),
    inspectPosProductEditorRecoveryAction: async () => ({ success: true, data: recoveryState({ state: 'rejected', canCancel: false, releaseAllowed: true }) }) } })
  await ui.mount(); await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
  assert.equal(ui.state.execution.stage, 'rejected')
  assert.equal(ui.storage.size, 1)
  assert.equal(ui.button('POSから読み込む').props.disabled, true)
  assert.equal(ui.saved, 0)
  ui.button('取消・解除条件を確認（読取りのみ）').props.onClick(); await settle()
  ui.button('閉じる').props.onClick()
  assert.equal(ui.storage.size, 1)
  ui.button('確認済みの復旧情報を解除して閉じる').props.onClick()
  assert.equal(ui.storage.size, 0)
  assert.equal(ui.closes, 1)
  const reopened = harness({ stored: ui.storage.get('kennel-pos-edit-execution:v1:7:42') ?? null })
  await reopened.mount(); await reopened.button('POSから読み込む').props.onClick()
  assert.equal(reopened.state.recovery, null)
  assert.equal(reopened.state.draft.name, 'POS商品')
})

test('不正rejected・uncertain・dispatching・復旧失敗はcloseでもpointerを絶対解除しない', async () => {
  for (const data of [execution({ stage: 'rejected', status: 'prepared', nextAction: 'none' }),
    execution({ stage: 'rejected', status: 'rejected', nextAction: 'verify' }),
    execution({ stage: 'rejected', status: 'rejected', nextAction: 'none', sendAttempts: 1 }),
    execution({ stage: 'verification_required', status: 'uncertain', nextAction: 'verify', sendAttempts: 1 }),
    execution({ stage: 'dispatching', status: 'dispatching', nextAction: 'none', sendAttempts: 1 }), null]) {
    const ui = harness({ stored: JSON.stringify(pointer), actions: { recoverPosProductEditorAction: async () => data ? { success: true, data } : { success: false, error: '復旧応答不明' } } })
    await ui.mount(); await ui.button('保存状態を確認（読取りのみ）').props.onClick(); await settle()
    ui.button('閉じる').props.onClick()
    ui.button('保存状況を保持して閉じる').props.onClick()
    assert.equal(ui.storage.size, 1)
    assert.equal(ui.closes, 1)
    assert.equal(ui.saved, 0)
  }
})

test('不正pointer・storage保存失敗・別対象の応答は外部保存せず凍結する', async () => {
  const bad = harness({ stored: JSON.stringify({ ...pointer, productId: 1 }) })
  await bad.mount()
  assert.equal(bad.state.storageBlocked, true)
  await bad.button('POSから読み込む').props.onClick()
  assert.equal(bad.calls.length, 0)
  const blocked = harness({ storageError: true })
  await blocked.mount(); await blocked.readAndReview(); blocked.confirmSave(); await settle()
  assert.equal(blocked.calls.some(call => ['prepare', 'save'].includes(call[0])), false)
  assert.equal(blocked.state.recovery.operationId, operationId)
  const other = harness({ actions: { preparePosProductEditorAction: async () => ({ success: true, data: execution({ storeId: 6 }) }) } })
  await other.mount(); await other.readAndReview(); other.confirmSave(); await settle()
  assert.equal(other.calls.some(call => call[0] === 'save'), false)
  assert.equal(other.state.executionNeedsRecovery, true)
})

test('別対象の読込/レビュー・不正完了DTOは成功と扱わず、完了通知を出さない', async () => {
  const loadMismatch = harness({ actions: { loadPosProductEditorAction: async () => ({ success: true, data: { ...fixture, storeId: 6 } }) } })
  await loadMismatch.mount(); await loadMismatch.button('POSから読み込む').props.onClick()
  assert.equal(loadMismatch.state.draft, null)
  const reviewMismatch = harness({ actions: { reviewPosProductEditorAction: async () => ({ success: true, data: { ...review, operationId: 'different' } }) } })
  await reviewMismatch.mount(); await reviewMismatch.readAndReview()
  assert.equal(reviewMismatch.state.review, null)
  const invalidDone = harness({ actions: { savePosProductEditorAction: async () => ({ success: true, data: execution({ status: 'completed', stage: 'completed', nextAction: 'none', posValuesVerified: null }) }) } })
  await invalidDone.mount(); await invalidDone.readAndReview(); invalidDone.confirmSave(); await settle()
  assert.equal(invalidDone.saved, 0)
  assert.equal(invalidDone.state.executionNeedsRecovery, true)
})

test('合成previewの保存シナリオも公開DTOだけで復旧し、5項目外やtarget追加値を拒否する', async () => {
  const mock = compile('tests/pos-products-ui/mock-actions.ts', {}, { setTimeout: fn => fn() })
  const allowedKeys = ['storeId', 'operationId', 'status', 'version', 'sendAttempts', 'stage', 'nextAction', 'posValuesVerified', 'expiresAt', 'message'].sort()
  for (const [index, scenario] of ['save-normal', 'prepare-response-lost', 'save-response-lost', 'db-pending'].entries()) {
    mock.configurePreviewScenario(scenario)
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`
    const target = { storeId: 7, operationId: id }
    const loaded = await mock.loadPosProductEditorAction({ ...target, productId: 90001 })
    const command = { kind: 'update', ...target, productId: 90001, expectedFingerprint: loaded.data.fingerprint,
      fields: { ...loaded.data.fields, name: '安全な合成変更' } }
    const prepared = await mock.preparePosProductEditorAction(command)
    if (scenario === 'prepare-response-lost') assert.equal(prepared.success, false)
    const recovered = await mock.recoverPosProductEditorAction(target)
    assert.equal(recovered.success, true)
    assert.deepEqual(Object.keys(recovered.data).sort(), allowedKeys)
    let result = await mock.savePosProductEditorAction(target)
    if (scenario === 'save-response-lost') {
      assert.equal(result.success, false)
      assert.equal((await mock.recoverPosProductEditorAction(target)).data.nextAction, 'verify')
      result = await mock.savePosProductEditorAction(target)
    } else if (scenario === 'db-pending') {
      assert.equal(result.data.nextAction, 'apply_db')
      result = await mock.savePosProductEditorAction(target)
    }
    assert.equal(result.data.stage, 'completed')
    assert.deepEqual(Object.keys(result.data).sort(), allowedKeys)
    assert.equal((await mock.savePosProductEditorAction({ ...target, fields: command.fields })).success, false)
    assert.equal((await mock.preparePosProductEditorAction({ ...command, fields: { ...command.fields, thumbnail: 'bad' } })).success, false)
  }
})

test('合成previewはRPC前失敗・dispatch未登録の同じprepare再試行と確定拒否を再現する', async () => {
  const mock = compile('tests/pos-products-ui/mock-actions.ts', {}, { setTimeout: fn => fn() })
  for (const [index, scenario] of ['prepare-before-ledger', 'prepare-unregistered', 'save-rejected'].entries()) {
    mock.configurePreviewScenario(scenario)
    const target = { storeId: 7, operationId: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${index}` }
    const current = await mock.loadPosProductEditorAction({ ...target, productId: 90001 })
    const command = { kind: 'update', ...target, productId: 90001, expectedFingerprint: current.data.fingerprint,
      fields: { ...current.data.fields, name: '合成の固定入力' } }
    const first = await mock.preparePosProductEditorAction(command)
    if (scenario === 'prepare-before-ledger') {
      assert.equal(first.success, false)
      assert.equal((await mock.recoverPosProductEditorAction(target)).success, false)
      assert.equal((await mock.preparePosProductEditorAction(command)).data.nextAction, 'save')
    } else if (scenario === 'prepare-unregistered') {
      assert.equal(first.data.nextAction, 'none')
      assert.equal((await mock.recoverPosProductEditorAction(target)).data.stage, 'prepared')
      assert.equal((await mock.preparePosProductEditorAction(command)).data.nextAction, 'save')
    } else {
      const rejected = await mock.savePosProductEditorAction(target)
      assert.equal(rejected.data.stage, 'rejected')
      assert.equal(rejected.data.status, 'rejected')
      assert.equal(rejected.data.sendAttempts, 0)
      assert.equal((await mock.recoverPosProductEditorAction(target)).data.nextAction, 'none')
    }
  }
})

test('合成previewの未作成/期限切れ取消・応答消失は同IDの遅延準備を拒否し、送信後は取消不可', async () => {
  const mock = compile('tests/pos-products-ui/mock-actions.ts', {}, { setTimeout: fn => fn() })
  for (const [index, scenario] of ['prepare-before-ledger', 'prepared-expired', 'cancel-response-lost', 'save-response-lost'].entries()) {
    mock.configurePreviewScenario(scenario)
    const target = { storeId: 7, productId: 90001, operationId: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${index}` }
    const loaded = await mock.loadPosProductEditorAction(target)
    const command = { kind: 'update', ...target, expectedFingerprint: loaded.data.fingerprint, fields: { ...loaded.data.fields, name: '合成取消検証' } }
    await mock.preparePosProductEditorAction(command)
    if (scenario === 'save-response-lost') await mock.savePosProductEditorAction({ storeId: 7, operationId: target.operationId })
    const status = await mock.inspectPosProductEditorRecoveryAction(target)
    if (scenario === 'save-response-lost') {
      assert.equal(status.data.canCancel, false); assert.equal((await mock.cancelPosProductEditorAction(target)).success, false)
      continue
    }
    assert.equal(status.data.canCancel, true); assert.equal(status.data.releaseAllowed, false)
    const cancelled = await mock.cancelPosProductEditorAction(target)
    assert.equal(cancelled.success, scenario !== 'cancel-response-lost')
    assert.equal((await mock.inspectPosProductEditorRecoveryAction(target)).data.state, 'cancelled')
    assert.equal((await mock.preparePosProductEditorAction(command)).success, false)
    assert.equal((await mock.inspectPosProductEditorRecoveryAction({ ...target, actorId: 'extra' })).success, false)
  }
})

test('ページは6フラグ全てexact trueのときだけ保存を公開し、Board完了通知は検索を再取得する', async () => {
  const flags = ['POS_PRODUCT_EDITOR_ENABLED', 'POS_PRODUCT_WRITES_ENABLED', 'POS_PRODUCT_DISPATCH_ENABLED', 'POS_PRODUCT_EDIT_GATEWAY_ENABLED', 'POS_PRODUCT_CONSUME_ENABLED', 'POS_PRODUCT_EDIT_EXECUTION_ENABLED']
  for (const absent of [null, ...flags]) {
    const env = Object.fromEntries(flags.map(flag => [flag, 'true']))
    if (absent) env[absent] = 'TRUE'
    const page = compile('next_app/app/(dashboard)/products/page.tsx', { env,
      '@/components/products/ProductsBoard': { ProductsBoard: () => null },
      '@/lib/storeAuth': { getStoreContext: async () => ({ currentView: 'main' }) } })
    const rendered = elements(await page.default()).find(element => Object.hasOwn(element.props, 'posSaveEnabled'))
    assert.equal(rendered.props.posSaveEnabled, absent === null)
  }
  let index = 0
  const values = ['商品', [product], false, { product, nonce: 1 }, false, 0], writes = [], dependencies = []
  const Pos = () => null
  const blank = () => null
  const board = compile('next_app/components/products/ProductsBoard.tsx', {
    react: { useState: () => { const current = index++; return [values[current], value => writes.push([current, typeof value === 'function' ? value(values[current]) : value])] }, useEffect: (_fn, deps) => dependencies.push(deps) },
    '@/components/orders/JanCodeScannerField': { JanCodeScannerField: blank },
    '@/components/products/ProductFormModal': { ProductFormModal: blank }, '@/components/products/PosProductEditModal': { PosProductEditModal: Pos },
    '@/components/products/ProductsSubnav': { ProductsSubnav: blank }, '@/components/ui/DataTable': { DataTable: blank },
    '@/components/ui/BarcodeToggle': { BarcodeToggle: blank }, '@/lib/products': {},
  })
  const tree = board.ProductsBoard({ products: [], posEditorEnabled: true, posSaveEnabled: true, selectedStoreId: 7 })
  const modal = elements(tree).find(element => element.type === Pos)
  assert.equal(modal.props.savingEnabled, true)
  modal.props.onSaved()
  assert.deepEqual(writes, [[5, 1]])
  assert.equal(dependencies[0][2], 0)
})

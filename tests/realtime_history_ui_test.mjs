import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../next_app/node_modules/typescript')
const jsx = require('../next_app/node_modules/react/jsx-runtime')
const source = readFileSync(new URL('../next_app/components/sales/SalesHistoryModal.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(elements)
  return tree.props ? [tree, ...elements(tree.props.children)] : []
}
const settle = () => new Promise(resolve => setImmediate(resolve))
function harness() {
  let now = '2026-10-10T14:59:00Z', index = 0, refIndex = 0, effectIndex = 0
  const states = [], refs = [], effects = [], requests = [], timers = []
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } }
  const react = {
    useState: value => { const i = index++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
    useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial } },
    useEffect: (fn, deps) => { const i = effectIndex++; const previous = effects[i]; if (!previous || deps.some((d, k) => d !== previous.deps[k])) effects[i] = { fn, deps, changed: true, cleanup: previous?.cleanup } },
  }
  const exports = {}
  vm.runInNewContext(code, { exports, Date: TestDate, Intl, URL, console,
    window: { location: { origin: 'http://localhost' }, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    setInterval: fn => { timers.push(fn); return timers.length }, clearInterval() {},
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? jsx : name === 'lucide-react' ? new Proxy({}, { get: () => () => null }) : assert.fail(`Unexpected module ${name}`),
  })
  function render() { index = 0; refIndex = 0; effectIndex = 0; return exports.SalesHistoryModal() }
  function commit() { render(); for (const effect of effects) if (effect.changed) { effect.cleanup?.(); effect.changed = false; effect.cleanup = effect.fn() } }
  function button(label) { const node = elements(render()).find(e => e.type === 'button' && elements(e).some(c => c.props?.children === label)); return node ?? elements(render()).find(e => e.type === 'button' && String(e.props.children).includes(label)) }
  function open() { elements(render()).find(e => e.type === 'button').props.onClick(); commit() }
  function close() { elements(render()).filter(e => e.type === 'button')[1].props.onClick(); commit() }
  function inputs() { return elements(render()).filter(e => e.type === 'input') }
  async function resolve(i, startDate = '2026/10/09', endDate = startDate) { requests[i].resolve({ ok: true, json: async () => ({ success: true, data: [], hasCache: true, fetchedAt: '2026-10-09T08:00:00Z', startDate, endDate }) }); await settle(); commit() }
  return { open, close, inputs, render, commit, requests, resolve, button, advance: value => { now = value; timers.forEach(fn => fn()); commit() } }
}

test('保存期間は今日の入力を上書きせず、手動入力と保存期間表示を分離する', async () => {
  const h = harness(); h.open()
  assert.deepEqual(h.inputs().map(i => i.props.value), ['2026/10/10', '2026/10/10'])
  h.inputs()[0].props.onChange({ target: { value: '2026/10/01' } })
  await h.resolve(0)
  assert.deepEqual(h.inputs().map(i => i.props.value), ['2026/10/01', '2026/10/10'])
  const text = JSON.stringify(h.render())
  assert.match(text, /保存履歴:.*2026\/10\/09 〜 2026\/10\/09/)
  assert.doesNotMatch(text, /保存履歴:.*2026\/10\/01 〜 2026\/10\/10/)
})

test('日跨ぎと再表示はJST今日に戻し、閉じる前の遅延応答を採用しない', async () => {
  const h = harness(); h.open()
  h.advance('2026-10-10T15:01:00Z')
  assert.deepEqual(h.inputs().map(i => i.props.value), ['2026/10/11', '2026/10/11'])
  h.inputs()[0].props.onChange({ target: { value: '2026/10/01' } })
  h.advance('2026-10-11T15:01:00Z')
  assert.equal(h.inputs()[0].props.value, '2026/10/01')
  h.close(); h.open()
  assert.deepEqual(h.inputs().map(i => i.props.value), ['2026/10/12', '2026/10/12'])
  assert.equal(h.requests.length, 2)
  await h.resolve(1, '2026/10/12')
  await h.resolve(0, '2026/10/09')
  assert.match(JSON.stringify(h.render()), /保存履歴:.*2026\/10\/12 〜 2026\/10\/12/)
  assert.equal(new URL(h.requests[0].url).searchParams.get('refresh'), null)
})

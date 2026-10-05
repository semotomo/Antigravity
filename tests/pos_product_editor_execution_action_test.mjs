import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const ts = createRequire(new URL('../next_app/package.json', import.meta.url))('typescript')
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const target = { storeId: 7, operationId }
const privateOperation = { ...target, actorId: 'private-actor', payloadHash: 'private-hash' }
const publicState = { ...target, status: 'prepared', version: 0, sendAttempts: 0, stage: 'prepared', nextAction: 'save',
  posValuesVerified: null, expiresAt: 1800000120000, message: '保存前です。' }
const flags = ['POS_PRODUCT_EDITOR_ENABLED', 'POS_PRODUCT_WRITES_ENABLED', 'POS_PRODUCT_DISPATCH_ENABLED',
  'POS_PRODUCT_EDIT_GATEWAY_ENABLED', 'POS_PRODUCT_CONSUME_ENABLED', 'POS_PRODUCT_EDIT_EXECUTION_ENABLED']
function fixture({ enabled = true, fail = null } = {}) {
  const env = Object.fromEntries(flags.map(flag => [flag, enabled ? 'true' : 'false']))
  const calls = []
  const exports = {}
  const imports = {
    '@/lib/pos-products/edit-preparation.server': { prepareProductEditFromPos: async input => {
      calls.push(['prepare', input]); if (fail === 'prepare') throw Error('private-cookie-html');
      if (fail === 'stop') env.POS_PRODUCT_WRITES_ENABLED = 'false'
      return { operation: privateOperation, review: { before: 'private-before' }, dispatch: { command: 'private-body' } }
    } },
    '@/lib/pos-products/edit-execution.server': {
      executePreparedProductEdit: async input => { calls.push(['save', input]); if (fail === 'save') throw Error('private-cookie-html'); return publicState },
      loadProductEditExecution: async input => { calls.push(['recover', input]); if (fail === 'recover') throw Error('private-cookie-html'); return publicState },
    },
  }
  const source = readFileSync(new URL('../next_app/app/actions/posProductExecution.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process: { env }, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] } })
  return { api: exports, calls, env }
}
test('保存準備Actionは既定OFFで受付/通信しない', async () => {
  const f = fixture({ enabled: false })
  assert.equal((await f.api.preparePosProductEditorAction({})).success, false)
  assert.deepEqual(f.calls, [])
})
test('準備Actionは固定記録を公開せず状態のみ返し、POS保存をまだ行わない', async () => {
  const f = fixture(), input = { kind: 'update', ...target, productId: 42 }
  const result = await f.api.preparePosProductEditorAction(input)
  assert.equal(result.success, true)
  assert.deepEqual(structuredClone(f.calls), [['prepare', input], ['recover', target]])
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), publicState)
  assert.ok(!JSON.stringify(result).includes('private'))
})
test('prepare通信待機中の停止では実行を進めない', async () => {
  const f = fixture({ fail: 'stop' })
  assert.equal((await f.api.preparePosProductEditorAction({})).success, false)
  assert.deepEqual(f.calls.map(call => call[0]), ['prepare'])
})
test('公開の保存/復旧Actionはmanager制御DALだけを呼ぶ', async () => {
  const f = fixture()
  assert.equal((await f.api.savePosProductEditorAction(target)).success, true)
  assert.equal((await f.api.recoverPosProductEditorAction(target)).success, true)
  assert.deepEqual(f.calls, [['save', target], ['recover', target]])
})
test('全Actionの未知の通信例外は原文を返さず、書込みOFFでも復旧DALへ到達する', async () => {
  for (const [action, fail] of [['preparePosProductEditorAction', 'prepare'], ['savePosProductEditorAction', 'save'], ['recoverPosProductEditorAction', 'recover']]) {
    const result = await fixture({ fail }).api[action](target)
    assert.equal(result.success, false)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
  const f = fixture({ enabled: false })
  assert.equal((await f.api.recoverPosProductEditorAction(target)).success, true)
  assert.deepEqual(f.calls, [['recover', target]])
})

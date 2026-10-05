import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import * as operations from '../next_app/lib/pos-products/operations.ts'
import * as validation from '../next_app/lib/pos-products/validation.ts'

const ts = createRequire(new URL('../next_app/package.json', import.meta.url))('typescript')
const read = path => readFileSync(new URL('../next_app/' + path, import.meta.url), 'utf8')
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const target = { storeId: 6, productId: 42, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
function compile(path, imports, env) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Buffer, JSON, structuredClone, process: { env }, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] } })
  return exports
}
function fixture() {
  const env = { POS_PRODUCT_EDITOR_ENABLED: 'true', POS_PRODUCT_WRITES_ENABLED: 'true', POS_PRODUCT_EDIT_EXECUTION_ENABLED: 'true',
    POS_PRODUCT_DISPATCH_ENABLED: 'false', POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'false', POS_PRODUCT_CONSUME_ENABLED: 'false',
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key' }
  const auth = { loggedIn: true, role: 'manager', onAuth: null }, calls = []
  const marker = { operation_id: target.operationId, store_id: 6, product_id_snapshot: 42, actor_id: actor,
    reason: 'cancel_before_preparation', cancelled_at: '2026-10-05T00:00:00Z' }
  let answer = null, rpcError = false
  const authApi = compile('lib/inventory/auth.ts', {}, env)
  const client = { auth: { getUser: async () => { auth.onAuth?.(); return { data: { user: auth.loggedIn ? { id: actor, user_metadata: { role: 'manager' } } : null }, error: null } } },
    from: table => { assert.equal(table, 'user_store_access'); let requiredRole = null; const q = { select: () => q,
      eq: (key, value) => { if (key === 'role') requiredRole = value; return q },
      maybeSingle: async () => ({ data: auth.role && auth.role === requiredRole ? { role: auth.role } : null, error: null }) }; return q } }
  const ledger = compile('lib/pos-products/ledger.server.ts', { 'server-only': {}, 'node:crypto': { createHash },
    '@supabase/supabase-js': { createClient: () => ({ rpc: async (name, args) => { calls.push([name, structuredClone(args)]);
      return rpcError ? { data: null, error: { message: 'private-cookie-html' } } : { data: answer ?? { operation: null, cancellation: name === 'cancel_pos_product_edit' ? marker : null }, error: null } } }) },
    '@/lib/supabase/server': { createClient: async () => client }, '@/lib/inventory/auth': authApi, './validation': validation,
    './operations': operations, './edit-review.server': {}, './edit-dispatch.server': {} }, env)
  const controller = compile('lib/pos-products/edit-execution.server.ts', { 'server-only': {}, '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/inventory/auth': authApi, './ledger.server': ledger, './operations': operations, './edit-review.server': {}, './inspection.server': {},
    './dispatch-transport.server': {}, './inspection-transport.server': {} }, env)
  const actions = compile('app/actions/posProductExecution.ts', { '@/lib/pos-products/edit-execution.server': controller,
    '@/lib/pos-products/edit-preparation.server': {} }, env)
  return { actions, calls, auth, env, marker, setAnswer: value => { answer = value }, failRpc: () => { rpcError = true } }
}

test('取消/救済Actionは対象3項目のみ受け入れ、store/product/op/本人は安全DTOへ束縛する', async () => {
  const f = fixture()
  for (const input of [{ ...target, actorId: actor }, { ...target, productId: '42' }, { ...target, storeId: '6' },
    { ...target, operationId: 'not-uuid' }, { ...target, productId: 2147483648 }, null]) {
    assert.equal((await f.actions.cancelPosProductEditorAction(input)).success, false)
    assert.equal((await f.actions.inspectPosProductEditorRecoveryAction(input)).success, false)
  }
  assert.equal(f.calls.length, 0)
  const read = await f.actions.inspectPosProductEditorRecoveryAction(target)
  assert.equal(read.data.state, 'not_created'); assert.equal(read.data.releaseAllowed, false)
  assert.equal(f.calls[0][0], 'get_pos_product_edit_recovery_state')
  const done = await f.actions.cancelPosProductEditorAction(target)
  assert.equal(done.data.state, 'cancelled'); assert.equal(done.data.releaseAllowed, true)
  assert.deepEqual(Object.keys(done.data).sort(), ['storeId', 'productId', 'operationId', 'state', 'canCancel', 'releaseAllowed', 'message'].sort())
  assert.deepEqual(f.calls[1][1], { p_actor_id: actor, p_store_id: 6, p_product_id: 42, p_operation_id: target.operationId })
  assert.doesNotMatch(JSON.stringify(done), /private|actor_id|cancelled_at|reason|fingerprint|payload|html/)
})
test('取消は3mutationフラグexact trueのみ、gateway OFFでも許可し、停止中は読取りだけ可能', async () => {
  for (const flag of ['POS_PRODUCT_EDITOR_ENABLED', 'POS_PRODUCT_WRITES_ENABLED', 'POS_PRODUCT_EDIT_EXECUTION_ENABLED']) {
    for (const value of [undefined, 'false', 'TRUE']) {
      const f = fixture(); f.env[flag] = value
      assert.equal((await f.actions.cancelPosProductEditorAction(target)).success, false); assert.equal(f.calls.length, 0)
      const status = await f.actions.inspectPosProductEditorRecoveryAction(target)
      assert.equal(status.success, true); assert.equal(status.data.canCancel, false); assert.equal(status.data.releaseAllowed, false)
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'get_pos_product_edit_recovery_state')
    }
  }
})
test('manager/本人を再認可し、metadata managerだけ/認可待機中の停止では取消RPCに到達しない', async () => {
  for (const patch of [{ loggedIn: false }, { role: 'staff' }, { role: null }]) {
    const f = fixture(); Object.assign(f.auth, patch)
    assert.equal((await f.actions.cancelPosProductEditorAction(target)).success, false)
    assert.equal((await f.actions.inspectPosProductEditorRecoveryAction(target)).success, false); assert.equal(f.calls.length, 0)
  }
  const f = fixture(); f.auth.onAuth = () => { f.env.POS_PRODUCT_WRITES_ENABLED = 'false' }
  assert.equal((await f.actions.cancelPosProductEditorAction(target)).success, false); assert.equal(f.calls.length, 0)
})
test('照合不能/別actor/store/product/opの取消応答やRPC秘密を公開せず解除判断を拒否する', async () => {
  for (const patch of [{ actor_id: target.operationId }, { store_id: 7 }, { product_id_snapshot: 43 },
    { operation_id: actor }, { reason: 'cancel_prepared' }, { cancelled_at: 'invalid' }, { html: 'private-html' }]) {
    const f = fixture(); f.setAnswer({ operation: null, cancellation: { ...f.marker, ...patch } })
    const result = await f.actions.cancelPosProductEditorAction(target)
    assert.equal(result.success, false); assert.doesNotMatch(JSON.stringify(result), /private|actor_id|cancelled_at/)
  }
  const f = fixture(); f.failRpc()
  assert.doesNotMatch(JSON.stringify(await f.actions.cancelPosProductEditorAction(target)), /private|cookie|html/)
})

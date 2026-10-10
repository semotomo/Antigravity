import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as operations from '../next_app/lib/pos-products/operations.ts'
import * as protocol from '../next_app/lib/pos-products/protocol.ts'

const ts = createRequire(new URL('../next_app/package.json', import.meta.url))('typescript')
const source = readFileSync(new URL('../next_app/lib/pos-products/ledger.server.ts', import.meta.url), 'utf8')
const secret = 'a'.repeat(64), actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const clone = value => JSON.parse(JSON.stringify(value))
const operation = storeId => ({ operationId, actorId, storeId, status: 'dispatching', version: 1, sendAttempts: 1,
  payloadHash: 'c'.repeat(64), expectedResultFingerprint: 'd'.repeat(64), verifiedFingerprint: null })
const row = op => ({ id: op.operationId, actor_id: op.actorId, store_id: op.storeId, status: op.status,
  row_version: op.version, send_attempts: op.sendAttempts, payload_hash: op.payloadHash,
  expected_result_fingerprint: op.expectedResultFingerprint, verified_fingerprint: op.verifiedFingerprint })
function fixture(storeId = 6) {
  const op = operation(storeId), calls = [], env = { POS_PRODUCT_WRITES_ENABLED: 'true', POS_PRODUCT_EDITOR_ENABLED: 'true',
    POS_PRODUCT_EDIT_EXECUTION_ENABLED: 'true', POS_PRODUCT_SIGNING_SECRET: secret,
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }
  const dispatch = { command: { operationId, actorId, storeId }, dispatchHash: 'e'.repeat(64), reviewedAt: Date.now() - 1000 }
  const auth = { manager: true, actorId, checks: 0, onCheck: null }
  let respond = async () => ({ data: { operation: row({ ...op, status: 'not_sent', version: 2 }), recovered: true }, error: null })
  const imports = { 'server-only': {}, 'node:crypto': { createHash }, './operations': operations, './protocol': protocol,
    './validation': {}, './edit-review.server': {}, './edit-dispatch.server': {},
    '@/lib/supabase/server': { createClient: async () => ({}) },
    '@/lib/inventory/auth': { InventoryAccessError: class extends Error {}, requireInventoryManagerAccess: async () => {
      auth.checks++; auth.onCheck?.(); if (!auth.manager) throw Error('synthetic-private-denied'); return { id: auth.actorId }
    } }, '@supabase/supabase-js': { createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args: clone(args) }); return respond(name, args) } }) } }
  const module = { exports: {} }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Buffer, process: { env }, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] } })
  function proof(changes = {}) {
    const p = { version: 1, audience: 'kennel.pos-product-not-sent.v1', operationId, actorId, storeId,
      dispatchHash: dispatch.dispatchHash, requestSignature: 'f'.repeat(64), stopCode: 'POS_PRODUCT_EDIT_PREPARE_REJECTED', occurredAt: Date.now(), ...changes }
    p.signature = createHmac('sha256', secret).update(JSON.stringify([p.version, p.audience, p.operationId, p.actorId, p.storeId,
      p.dispatchHash, p.requestSignature, p.stopCode, p.occurredAt])).digest('hex')
    return p
  }
  return { api: module.exports, op, dispatch, env, calls, auth, proof, respond: fn => { respond = fn } }
}
const safeReject = promise => assert.rejects(promise, error => !/synthetic-private|service-key|signature/.test(error.message))

test('両店舗の未送信証拠を再HMAC検証し、本人managerと固定操作だけで専用RPCへ渡す', async () => {
  for (const store of [6, 7]) {
    const f = fixture(store), proofText = JSON.stringify(f.proof()), result = await f.api.resolveProductEditNotSent(f.op, f.dispatch, proofText)
    assert.equal(result.status, 'not_sent'); assert.equal(result.sendAttempts, 1); assert.equal(result.version, 2)
    assert.equal(operations.productOperationNextStep(result), 'none')
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'resolve_pos_product_edit_not_sent')
    assert.deepEqual(Object.keys(f.calls[0].args).sort(), ['p_actor_id', 'p_store_id', 'p_operation_id', 'p_payload_hash', 'p_expected_version', 'p_dispatch_hash', 'p_proof_text'].sort())
    assert.equal(f.calls[0].args.p_actor_id, actorId); assert.equal(f.calls[0].args.p_store_id, store)
    const expected = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(proofText)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))
    assert.equal(f.calls[0].args.p_proof_text, expected); assert.equal(f.auth.checks, 1)
  }
})

test('署名改竄・別対象・未来/古い時刻・余剰項目・未知codeでは特権RPCを呼ばない', async () => {
  for (const change of [{ actorId: operationId }, { operationId: actorId }, { storeId: 7 }, { dispatchHash: 'f'.repeat(64) },
    { occurredAt: Date.now() + 60000 }, { occurredAt: 1 }, { stopCode: 'POS_PRODUCT_EDIT_VERIFY_REQUIRED' }, { private: 'synthetic-private' }]) {
    const f = fixture(), proof = f.proof(change)
    await safeReject(f.api.resolveProductEditNotSent(f.op, f.dispatch, JSON.stringify(proof))); assert.equal(f.calls.length, 0)
  }
  const f = fixture(), proof = f.proof(); proof.signature = '0'.repeat(64)
  await safeReject(f.api.resolveProductEditNotSent(f.op, f.dispatch, JSON.stringify(proof))); assert.equal(f.calls.length, 0)
})

test('認可/運用フラグ/鍵が変われば解除せず、応答不明でもRPCを自動再送しない', async () => {
  for (const mutate of [f => { f.auth.manager = false }, f => { f.auth.actorId = operationId },
    f => { f.env.POS_PRODUCT_WRITES_ENABLED = 'false' }, f => { f.env.POS_PRODUCT_EDITOR_ENABLED = 'false' },
    f => { f.env.POS_PRODUCT_EDIT_EXECUTION_ENABLED = 'false' }, f => { f.auth.onCheck = () => { f.env.POS_PRODUCT_SIGNING_SECRET = 'b'.repeat(64) } }]) {
    const f = fixture(), proofText = JSON.stringify(f.proof()); mutate(f)
    await safeReject(f.api.resolveProductEditNotSent(f.op, f.dispatch, proofText)); assert.equal(f.calls.length, 0)
  }
  const f = fixture(); f.respond(async () => { throw Error('synthetic-private-rpc') })
  await safeReject(f.api.resolveProductEditNotSent(f.op, f.dispatch, JSON.stringify(f.proof()))); assert.equal(f.calls.length, 1)
})

test('認可await中の呼出元変更で、開始時の店舗/操作/本文hash/versionを差し替えない', async () => {
  const f = fixture(), proofText = JSON.stringify(f.proof()), original = clone(f.op), originalDispatch = clone(f.dispatch)
  f.respond(async () => ({ data: { operation: row({ ...original, status: 'not_sent', version: 2 }), recovered: true }, error: null }))
  f.auth.onCheck = () => { f.op.storeId = 7; f.op.operationId = actorId; f.op.payloadHash = 'f'.repeat(64); f.op.version = 99
    f.dispatch.command.storeId = 7; f.dispatch.dispatchHash = 'f'.repeat(64); f.dispatch.reviewedAt = Date.now() + 60000 }
  const result = await f.api.resolveProductEditNotSent(f.op, f.dispatch, proofText)
  assert.equal(result.storeId, original.storeId); assert.equal(result.operationId, original.operationId)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.p_expected_version, 1)
  assert.equal(f.calls[0].args.p_store_id, original.storeId); assert.equal(f.calls[0].args.p_payload_hash, original.payloadHash)
  assert.equal(f.calls[0].args.p_dispatch_hash, originalDispatch.dispatchHash)
})

test('RPCの不正terminal/回数/指紋/別対象を拒否し、同一証拠の再取得だけを許す', async () => {
  for (const change of [{ status: 'prepared', sendAttempts: 0 }, { status: 'completed', verifiedFingerprint: 'd'.repeat(64) },
    { storeId: 7 }, { actorId: operationId }, { sendAttempts: 0 }, { version: 99 }]) {
    const f = fixture(); f.respond(async () => ({ data: { operation: row({ ...f.op, status: 'not_sent', version: 2, ...change }), recovered: true }, error: null }))
    await safeReject(f.api.resolveProductEditNotSent(f.op, f.dispatch, JSON.stringify(f.proof()))); assert.equal(f.calls.length, 1)
  }
  const f = fixture(); f.op.status = 'not_sent'; f.op.version = 2
  f.respond(async () => ({ data: { operation: row(f.op), recovered: false }, error: null }))
  assert.equal((await f.api.resolveProductEditNotSent(f.op, f.dispatch, JSON.stringify(f.proof()))).version, 2)
})

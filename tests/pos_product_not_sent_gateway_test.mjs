import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { signPosProductRequest, verifyPosProductNotSentProof } from '../next_app/lib/pos-products/protocol.ts'

const signingSecret = 'ab'.repeat(32), consumeSecret = 'cd'.repeat(32)
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const now = 1_800_000_000_000
const audience = 'kennel.pos-product-not-sent.v1'
const stopCodes = ['POS_PRODUCT_EDIT_DISABLED', 'POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE',
  'POS_PRODUCT_EDIT_INVALID_REQUEST', 'POS_PRODUCT_EDIT_PREPARE_REJECTED', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED']
const stopped = code => ({ outcome: 'not_sent', code, saveRequestStarted: false, responseReceived: false })
const plain = value => JSON.parse(JSON.stringify(value))
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)
const proofSignature = proof => createHmac('sha256', signingSecret).update(JSON.stringify([1, audience,
  proof.operationId, proof.actorId, proof.storeId, proof.dispatchHash, proof.requestSignature,
  proof.stopCode, proof.occurredAt]), 'utf8').digest('hex')

function fixture(options = {}) {
  const props = { POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'true', POS_PRODUCT_SIGNING_SECRET: signingSecret,
    POS_PRODUCT_CONSUME_ENABLED: 'true', POS_PRODUCT_CONSUME_URL: 'https://kennel-dashboard.vercel.app/api/pos-products/consume',
    POS_PRODUCT_CONSUME_SECRET: consumeSecret, POS_PRODUCT_EDIT_EXECUTION_ENABLED: 'true', ...options.props }
  const calls = [], logs = []
  let time = now, executions = 0, hmacCalls = 0
  const context = vm.createContext({
    Date: { now: () => time }, Logger: { log: value => logs.push(value) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name] ?? null }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      newBlob: value => ({ getBytes: () => [...Buffer.from(value, 'utf8')] }),
      computeDigest: (_, value) => [...createHash('sha256').update(value, 'utf8').digest()],
      computeHmacSha256Signature: (value, secret) => {
        hmacCalls++
        if (options.rotateDuringProof && hmacCalls === 2) props.POS_PRODUCT_SIGNING_SECRET = 'ef'.repeat(32)
        return [...createHmac('sha256', secret).update(value, 'utf8').digest()]
      } },
    UrlFetchApp: { fetch: (url, request) => { calls.push({ url, request }); throw Error('synthetic-private-network') } },
  })
  const sources = ['posProductProtocol.js']
  if (options.realExecutor) sources.push('autoDownload.js', 'posProductReadDiagnostic.js', 'posProductForm.js',
    'posProductSubmission.js', 'posProductEditExecution.js')
  sources.push('posProductEditGateway.js')
  for (const path of sources) {
    vm.runInContext(readFileSync(new URL('../gas/' + path, import.meta.url), 'utf8'), context)
  }
  context.getPOSConfig_ = () => ({ baseUrl: 'https://cg8.power-k.jp/0D890OGI',
    loginId: 'synthetic-user', password: 'synthetic-private-password' })
  if (!options.realExecutor) context.executePosProductEdit_ = (_, command, consume) => {
    executions++
    if (options.executorError) throw Error(options.executorError)
    if (options.consumeCalled) {
      try { consume({ operationId, actorId, storeId: command.storeId,
        dispatchHash: createHash('sha256').update(canonical(command), 'utf8').digest('hex') }) }
      catch (_) { /* 通信後の誤ったnot_sentでも証明を生成できないことを確認する。 */ }
    }
    if (options.changedSecret !== undefined) props.POS_PRODUCT_SIGNING_SECRET = options.changedSecret
    if (Object.hasOwn(options, 'occurredAt')) time = options.occurredAt
    return options.result ?? stopped('POS_PRODUCT_EDIT_PREPARE_REJECTED')
  }
  const storeId = options.storeId ?? 7
  const command = { operationId, actorId, storeId, janCode: '4582107173062',
    before: { identity: {}, fields: { name: 'synthetic-private-name' }, settings: {}, groups: [], suppliers: [] },
    patch: { goodsName: 'synthetic-private-new-name' }, expiresAt: now + 100_000 }
  const envelope = signPosProductRequest({ action: 'dispatch', operationId, actorId, storeId, payload: command }, signingSecret, now)
  return { command, envelope, calls, logs, get executions() { return executions },
    run: (body = JSON.stringify(envelope)) => plain(context.handlePosProductEditDispatch_(body)) }
}

test('保存開始前の固定5コードだけに相関と専用audienceを束縛した署名証明を付ける', () => {
  for (const storeId of [6, 7]) for (const code of stopCodes) {
    const f = fixture({ storeId, result: stopped(code) }), output = f.run()
    const proof = output.notSentProof
    assert.equal(output.success, true)
    assert.deepEqual(output.result, stopped(code))
    assert.deepEqual(Object.keys(proof).sort(), ['version', 'audience', 'operationId', 'actorId', 'storeId',
      'dispatchHash', 'requestSignature', 'stopCode', 'occurredAt', 'signature'].sort())
    assert.equal(proof.version, 1); assert.equal(proof.audience, audience)
    assert.equal(proof.operationId, operationId); assert.equal(proof.actorId, actorId); assert.equal(proof.storeId, storeId)
    assert.equal(proof.dispatchHash, createHash('sha256').update(canonical(f.command), 'utf8').digest('hex'))
    assert.equal(proof.dispatchHash, output.dispatchHash)
    assert.equal(proof.requestSignature, f.envelope.signature)
    assert.equal(proof.stopCode, code); assert.equal(proof.occurredAt, now)
    assert.equal(proof.signature, proofSignature(proof))
    const verified = verifyPosProductNotSentProof(proof, signingSecret, { operationId, actorId, storeId,
      dispatchHash: output.dispatchHash, requestSignature: f.envelope.signature, earliestAt: now }, now)
    assert.equal(JSON.stringify(verified), canonical(proof), 'GAS→Next→DBの証拠本文bytesを一致させる')
    assert.equal(f.executions, 1); assert.equal(f.calls.length, 0)
    assert.deepEqual(f.logs, [])
    assert.doesNotMatch(JSON.stringify(output), /synthetic-private|password|Cookie|payload|<form/)
    assert.ok(!JSON.stringify(output).includes(signingSecret)); assert.ok(!JSON.stringify(output).includes(consumeSecret))
  }
})

test('未送信に見える結果でも未知code・開始済み・応答受信・余剰項目には証明を付けない', () => {
  for (const result of [stopped('POS_PRODUCT_EDIT_VERIFY_REQUIRED'), stopped('POS_PRODUCT_EDIT_PREPARE_REJECTED_EXTRA'),
    { ...stopped(stopCodes[0]), saveRequestStarted: true }, { ...stopped(stopCodes[0]), responseReceived: true },
    { ...stopped(stopCodes[0]), saveRequestStarted: 0 }, { ...stopped(stopCodes[0]), responseReceived: null },
    { ...stopped(stopCodes[0]), unknown: true }]) {
    const f = fixture({ result }), output = f.run()
    assert.equal(output.success, true); assert.deepEqual(output.result, result)
    assert.equal(Object.hasOwn(output, 'notSentProof'), false)
    assert.equal(f.calls.length, 0); assert.deepEqual(f.logs, [])
  }
})

test('consumeを呼び出した実行器が誤った未送信結果を返しても証明を作らない', () => {
  const f = fixture({ consumeCalled: true }), output = f.run()
  assert.equal(output.success, true); assert.equal(output.result.outcome, 'not_sent')
  assert.equal(Object.hasOwn(output, 'notSentProof'), false)
  assert.equal(f.calls.length, 1); assert.deepEqual(f.logs, [])
})

test('実際のGAS実行器のPOS読取り拒否はconsume前の署名証明になり保存しない', () => {
  const f = fixture({ realExecutor: true }), output = f.run()
  assert.equal(output.success, true)
  assert.deepEqual(output.result, stopped('POS_PRODUCT_EDIT_PREPARE_REJECTED'))
  assert.equal(output.notSentProof.stopCode, 'POS_PRODUCT_EDIT_PREPARE_REJECTED')
  assert.equal(output.notSentProof.signature, proofSignature(output.notSentProof))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, 'https://cg8.power-k.jp/0D890OGI')
  assert.equal(f.calls[0].request.method, 'get')
  assert.deepEqual(f.logs, [])
  assert.doesNotMatch(JSON.stringify(output), /synthetic-private|password|Cookie|payload|<form/)
})

test('verification_requiredとvalues_verifiedの既存plain応答は変更しない', () => {
  for (const result of [
    { outcome: 'verification_required', code: 'POS_PRODUCT_EDIT_EXECUTION_RIGHT_UNAVAILABLE', saveRequestStarted: false, responseReceived: false },
    { outcome: 'values_verified', code: 'POS_PRODUCT_EDIT_VALUES_VERIFIED', saveRequestStarted: true, responseReceived: true, inspection: { fixture: true } },
  ]) {
    const f = fixture({ result }), output = f.run()
    assert.deepEqual(output.result, result)
    assert.equal(Object.hasOwn(output, 'notSentProof'), false)
    assert.deepEqual(Object.keys(output).sort(), ['version', 'success', 'operationId', 'actorId', 'storeId', 'dispatchHash', 'result'].sort())
  }
})

test('署名検証時と異なる鍵・不正な証明時刻では署名証明を返さない', () => {
  for (const options of [{ changedSecret: 'ef'.repeat(32) }, { changedSecret: null }, { changedSecret: '' }, { rotateDuringProof: true },
    ...[NaN, -1, Number.MAX_SAFE_INTEGER + 1, '1800000000000'].map(occurredAt => ({ occurredAt }))]) {
    const f = fixture(options), output = f.run()
    assert.equal(output.success, true); assert.equal(Object.hasOwn(output, 'notSentProof'), false)
    assert.equal(f.calls.length, 0); assert.deepEqual(f.logs, [])
  }
})

test('署名・設定・実行例外の拒否は固定応答だけで秘密や証明を出さない', () => {
  for (const options of [{ props: { POS_PRODUCT_EDIT_GATEWAY_ENABLED: 'false' } },
    { props: { POS_PRODUCT_CONSUME_ENABLED: 'false' } }, { executorError: 'synthetic-private-password' }]) {
    const f = fixture(options), output = f.run()
    assert.deepEqual(output, { version: 1, success: false, code: 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE' })
    assert.deepEqual(f.logs, []); assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.deepEqual(f.run(JSON.stringify({ ...f.envelope, signature: '00'.repeat(32) })),
    { version: 1, success: false, code: 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE' })
  assert.equal(f.executions, 0)
})

import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { signPosProductRequest, verifyPosProductRequest } from '../next_app/lib/pos-products/protocol.ts'

const secret = '1b'.repeat(32)
const now = 1_800_000_000_000
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const request = () => ({ action: 'dispatch', operationId, actorId, storeId: 6,
  payload: { operationId, storeId: 6, kind: 'create', janCode: '0490123456789',
    fields: { name: '犬フード & "試験"', groupId: 'group-1', price: '999', cost: '499.5', supplierId: null } } })

// GASの公開Utilities APIと同じUTF-8/符号付きbyte形式で、実際の暗号計算を実行する。
const gas = vm.createContext({ Utilities: {
  Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
  newBlob: text => ({ getBytes: () => Array.from(Buffer.from(text, 'utf8'), n => n > 127 ? n - 256 : n) }),
  computeDigest: (algorithm, value, encoding) => Array.from(createHash(algorithm).update(value, encoding).digest(), n => n > 127 ? n - 256 : n),
  computeHmacSha256Signature: (value, key, encoding) => Array.from(createHmac('sha256', key).update(value, encoding).digest(), n => n > 127 ? n - 256 : n),
} })
vm.runInContext(readFileSync(new URL('../gas/posProductProtocol.js', import.meta.url), 'utf8'), gas)
const gasVerify = body => JSON.parse(JSON.stringify(gas.verifyPosProductRequest_(body, secret, now)))
const verifyBoth = body => [() => verifyPosProductRequest(body, secret, now), () => gasVerify(body)]

test('Node署名をNodeとGASの両方で検証し、日本語・先頭0・店舗・操作・利用者を保持する', () => {
  const body = JSON.stringify(signPosProductRequest(request(), secret, now))
  const nodeResult = verifyPosProductRequest(body, secret, now)
  assert.deepEqual(gasVerify(body), nodeResult)
  assert.equal(nodeResult.payload.janCode, '0490123456789')
  assert.equal(nodeResult.payload.fields.name, request().payload.fields.name)
  assert.equal(nodeResult.actorId, actorId)
})

test('店舗・実行者・操作・内容・時刻・用途のどの改ざんも拒否する', () => {
  const signed = signPosProductRequest(request(), secret, now)
  const changes = [{ storeId: 7 }, { actorId: operationId }, { operationId: actorId },
    { action: 'inspect' }, { payload: signed.payload.replace('999', '888') },
    { payloadHash: '0'.repeat(64) }, { issuedAt: now - 1 }, { expiresAt: now + 1000 },
    { audience: 'other' }, { version: 2 }, { signature: 'f'.repeat(64) }, { unknown: true }]
  for (const change of changes) for (const verify of verifyBoth(JSON.stringify({ ...signed, ...change }))) assert.throws(verify)
})

test('署名が正しくても期限切れ・未来発行・過長な有効期間は拒否する', () => {
  const expired = signPosProductRequest(request(), secret, now - 120_000)
  const future = signPosProductRequest(request(), secret, now + 5001)
  for (const signed of [expired, future]) for (const verify of verifyBoth(JSON.stringify(signed))) assert.throws(verify)
  assert.throws(() => signPosProductRequest(request(), secret, now, 120_001))
  assert.throws(() => signPosProductRequest(request(), secret, now, 0))
})

test('別の秘密鍵、欠損した鍵、短い鍵を拒否する', () => {
  const body = JSON.stringify(signPosProductRequest(request(), secret, now))
  for (const invalid of ['', undefined, 'short', '2c'.repeat(32)]) {
    assert.throws(() => verifyPosProductRequest(body, invalid, now))
    assert.throws(() => gas.verifyPosProductRequest_(body, invalid, now))
  }
  assert.throws(() => signPosProductRequest(request(), 'short', now))
})

test('JSONや必須項目の欠損・文字列店舗・過大な本文を安全に拒否する', () => {
  for (const body of ['', '{', 'null', '[]', '{}', 'a'.repeat(25_000)]) {
    for (const verify of verifyBoth(body)) assert.throws(verify, /POS_PRODUCT_AUTHORIZATION_REJECTED/)
  }
  for (const changed of [{storeId:'6'}, {actorId:''}, {operationId:''}, {action:'delete_all'}, {action:['dispatch']}]) {
    assert.throws(() => signPosProductRequest({ ...request(), ...changed }, secret, now))
  }
  assert.throws(() => signPosProductRequest({ ...request(), payload: { ...request().payload, text: 'あ'.repeat(6000) } }, secret, now))
})

test('エスケープで外側JSONが制限を超える場合も送信前に拒否する', () => {
  assert.throws(() => signPosProductRequest({...request(), payload:{...request().payload,text:'"'.repeat(7800)}}, secret, now))
})

test('外側とpayloadの店舗・操作が違えば署名生成時点でも拒否する', () => {
  for (const payload of [{...request().payload, storeId:7}, {...request().payload, operationId:actorId}, []]) {
    assert.throws(() => signPosProductRequest({...request(), payload}, secret, now))
  }
})

test('読取照合と再照合も用途を署名へ束縛する', () => {
  for (const action of ['inspect', 'reconcile']) {
    const body = JSON.stringify(signPosProductRequest({...request(), action}, secret, now))
    assert.equal(gasVerify(body).action, action)
  }
})

test('署名検証は書込みも冪等claimも行わない（同一署名の排他は別のDB処理が必須）', () => {
  const body = JSON.stringify(signPosProductRequest(request(), secret, now))
  assert.deepEqual(gasVerify(body), gasVerify(body))
  const source = readFileSync(new URL('../gas/posProductProtocol.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /UrlFetchApp|Logger\.|console\.|function doPost|function doGet/)
})

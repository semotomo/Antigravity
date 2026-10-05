import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceProductOperation, productOperationNextStep, assertSameProductOperation } from '../next_app/lib/pos-products/operations.ts'

const operation = () => ({ operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  storeId:6, payloadHash:'a'.repeat(64), status:'prepared', version:0, sendAttempts:0,
  expectedResultFingerprint:'b'.repeat(64), verifiedFingerprint:null })
const advance = (state, type, extra = {}) => advanceProductOperation(state, {type, expectedVersion:state.version, ...extra})
const confirm = state => advance(state, 'pos_verified', {fingerprint:state.expectedResultFingerprint})

test('POS送信・検証・DB反映を別状態とし、完了まで順序を強制する', () => {
  let state = operation()
  assert.equal(productOperationNextStep(state), 'dispatch')
  state = advance(state, 'claim_dispatch')
  assert.equal(productOperationNextStep(state), 'wait')
  assert.equal(state.sendAttempts, 1)
  state = advance(state, 'dispatch_returned')
  assert.equal(productOperationNextStep(state), 'verify_pos')
  state = confirm(state)
  assert.equal(productOperationNextStep(state), 'apply_db')
  state = advance(state, 'db_completed')
  assert.equal(state.status, 'completed')
  assert.equal(productOperationNextStep(state), 'none')
})

test('送信後タイムアウトは失敗扱いで再送せず、POS結果確認だけを行う', () => {
  const uncertain = advance(advance(operation(), 'claim_dispatch'), 'outcome_unknown')
  assert.equal(uncertain.status, 'uncertain')
  assert.equal(productOperationNextStep(uncertain), 'verify_pos')
  assert.throws(() => advance(uncertain, 'claim_dispatch'))
  assert.throws(() => advance(uncertain, 'reject_before_dispatch'))
  assert.throws(() => confirm({...uncertain, expectedResultFingerprint:'c'.repeat(64), verifiedFingerprint:'b'.repeat(64)}))
  assert.equal(confirm(uncertain).status, 'pos_confirmed')
})

test('POS成功・DB失敗後はDB反映だけを再試行し、POSの再送信を禁止する', () => {
  const verified = confirm(advance(advance(operation(), 'claim_dispatch'), 'dispatch_returned'))
  const pending = advance(verified, 'db_failed')
  assert.equal(productOperationNextStep(pending), 'apply_db')
  assert.throws(() => advance(pending, 'claim_dispatch'))
  assert.equal(advance(pending, 'db_completed').status, 'completed')
})

test('POS未照合・異なる結果指紋ではDB反映も成功表示も許可しない', () => {
  for (const state of [operation(), advance(operation(), 'claim_dispatch')]) {
    assert.throws(() => advance(state, 'db_completed'))
    assert.throws(() => confirm(state))
  }
  const verifying = advance(advance(operation(), 'claim_dispatch'), 'dispatch_returned')
  assert.throws(() => advance(verifying, 'pos_verified', {fingerprint:'c'.repeat(64)}))
})

test('同一操作の再取得は認可済み店舗・実行者・内容hashのすべてが一致する必要がある', () => {
  const stored = operation()
  assert.doesNotThrow(() => assertSameProductOperation(stored, stored))
  for (const change of [{storeId:7}, {actorId:stored.operationId}, {operationId:stored.actorId}, {payloadHash:'d'.repeat(64)}]) {
    assert.throws(() => assertSameProductOperation(stored, {...stored,...change}))
  }
})

test('古いversionからの遷移を拒否し、元の保存入力・操作情報を書き換えない', () => {
  const before = operation()
  const original = structuredClone(before)
  const claimed = advance(before, 'claim_dispatch')
  assert.deepEqual(before, original)
  assert.throws(() => advanceProductOperation(claimed, {type:'dispatch_returned',expectedVersion:0}))
  assert.equal(claimed.version, 1)
  assert.equal(claimed.payloadHash, before.payloadHash)
})

test('不正な保存状態・送信回数・完了後の再操作を拒否する', () => {
  for (const change of [{status:'unknown'}, {sendAttempts:2}, {version:-1}, {storeId:8},
    {status:'prepared',sendAttempts:1}, {status:'completed'}, {verifiedFingerprint:'b'.repeat(64)}]) {
    assert.throws(() => productOperationNextStep({...operation(),...change}))
  }
  const rejected = advance(operation(), 'reject_before_dispatch')
  assert.equal(productOperationNextStep(rejected), 'none')
  assert.throws(() => advance(rejected, 'claim_dispatch'))
})

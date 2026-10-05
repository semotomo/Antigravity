export type ProductOperationStatus = 'prepared' | 'dispatching' | 'verifying' | 'uncertain' |
  'pos_confirmed' | 'db_pending' | 'completed' | 'rejected'
type OperationIdentity = { operationId: string; actorId: string; storeId: 6 | 7; payloadHash: string }
export type ProductOperation = OperationIdentity & {
  status: ProductOperationStatus
  version: number
  sendAttempts: 0 | 1
  expectedResultFingerprint: string
  verifiedFingerprint: string | null
}
type Event = { expectedVersion: number } & (
  | { type: 'claim_dispatch' | 'dispatch_returned' | 'outcome_unknown' | 'reject_before_dispatch' | 'db_failed' | 'db_completed' }
  | { type: 'pos_verified'; fingerprint: string }
)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const VERIFIED = ['pos_confirmed', 'db_pending', 'completed']
const NEXT = {
  prepared: 'dispatch', dispatching: 'wait', verifying: 'verify_pos', uncertain: 'verify_pos',
  pos_confirmed: 'apply_db', db_pending: 'apply_db', completed: 'none', rejected: 'none',
} as const

function checkIdentity(state: OperationIdentity) {
  if (!state || !UUID.test(state.operationId) || !UUID.test(state.actorId) ||
      (state.storeId !== 6 && state.storeId !== 7) || !HASH.test(state.payloadHash)) {
    throw new Error('商品操作の対象情報が正しくありません。')
  }
}
function check(state: ProductOperation) {
  checkIdentity(state)
  if (!Object.hasOwn(NEXT, state.status) || !Number.isSafeInteger(state.version) || state.version < 0 ||
      !HASH.test(state.expectedResultFingerprint) || (state.sendAttempts !== 0 && state.sendAttempts !== 1)) {
    throw new Error('商品操作の保存状態が正しくありません。')
  }
  const beforeSend = state.status === 'prepared' || state.status === 'rejected'
  if (state.sendAttempts !== (beforeSend ? 0 : 1)) throw new Error('商品操作の送信状態が一致しません。')
  if (VERIFIED.includes(state.status) ? state.verifiedFingerprint !== state.expectedResultFingerprint : state.verifiedFingerprint !== null) {
    throw new Error('POS確認結果と商品操作の状態が一致しません。')
  }
}

/** 再配送でも別店舗・別利用者・別内容の操作結果を流用しない。認可は呼出元で毎回実施する。 */
export function assertSameProductOperation(stored: OperationIdentity, incoming: OperationIdentity): void {
  checkIdentity(stored)
  checkIdentity(incoming)
  if (stored.operationId !== incoming.operationId || stored.actorId !== incoming.actorId ||
      stored.storeId !== incoming.storeId || stored.payloadHash !== incoming.payloadHash) {
    throw new Error('同じ操作IDを異なる商品操作には使えません。')
  }
}

/** 保存済み状態からのみ復旧方針を決める。送信済みなら再送する状態へ戻さない。 */
export function productOperationNextStep(state: ProductOperation) {
  check(state)
  return NEXT[state.status]
}

/**
 * 純粋な遷移規則。DB側でも行ロックとversion比較を同一transactionで行う必要がある。
 * claim確定前は送信不可。claim後に落ちた処理もpreparedへ戻さず、再照合へ進める。
 * pos_verifiedは完了画面ではなく、POS再取得の対象ID・所属・全変更値を照合した結果に限る。
 */
export function advanceProductOperation(state: ProductOperation, event: Event): ProductOperation {
  check(state)
  if (event.expectedVersion !== state.version || state.version === Number.MAX_SAFE_INTEGER) {
    throw new Error('処理状態が更新されています。最新の状態を確認してください。')
  }
  let status: ProductOperationStatus
  let verifiedFingerprint = state.verifiedFingerprint
  let sendAttempts = state.sendAttempts
  if (event.type === 'claim_dispatch' && state.status === 'prepared') {
    status = 'dispatching'
    sendAttempts = 1
  } else if (event.type === 'reject_before_dispatch' && state.status === 'prepared') {
    status = 'rejected'
  } else if (event.type === 'dispatch_returned' && state.status === 'dispatching') {
    status = 'verifying'
  } else if (event.type === 'outcome_unknown' && ['dispatching', 'verifying', 'uncertain'].includes(state.status)) {
    status = 'uncertain'
  } else if (event.type === 'pos_verified' && ['verifying', 'uncertain'].includes(state.status) &&
      event.fingerprint === state.expectedResultFingerprint) {
    status = 'pos_confirmed'
    verifiedFingerprint = event.fingerprint
  } else if (event.type === 'db_failed' && ['pos_confirmed', 'db_pending'].includes(state.status)) {
    status = 'db_pending'
  } else if (event.type === 'db_completed' && ['pos_confirmed', 'db_pending'].includes(state.status)) {
    status = 'completed'
  } else {
    throw new Error('この状態では指定の商品操作を実行できません。再送せず結果を確認してください。')
  }
  const next = { ...state, status, verifiedFingerprint, sendAttempts, version: state.version + 1 }
  check(next)
  return next
}

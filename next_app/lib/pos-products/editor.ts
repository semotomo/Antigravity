import type { PosProductFields, PosProductStoreId } from './types'

// ブラウザへ渡す業務値のみ。POS内部ID、hidden、資格情報、保存payloadは含めない。
export type ProductEditorData = {
  storeId: PosProductStoreId
  productId: number
  janCode: string
  capturedAt: number
  fingerprint: string
  fields: PosProductFields
  groups: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
}

export type ProductEditorReviewData = {
  operationId: string
  reviewedAt: number
  changes: { field: keyof PosProductFields; label: string; before: string | null; after: string | null }[]
}

// 復旧表示は公開状態だけを含み、送信本文・内部ID・照合指紋は返さない。
export type ProductEditExecutionData = {
  storeId: PosProductStoreId
  operationId: string
  status: import('./operations').ProductOperationStatus
  version: number
  sendAttempts: number
  stage: 'prepared' | 'dispatching' | 'verification_required' | 'pos_confirmed' | 'db_pending' | 'completed' | 'rejected'
  nextAction: 'save' | 'verify' | 'apply_db' | 'none'
  posValuesVerified: boolean | null
  expiresAt: number | null
  message: string
}

export type ProductEditRecoveryTarget = { storeId: 6 | 7; productId: number; operationId: string }
/** 対象3項目をサーバー照合した解除判断。not_createdだけでは解除しない。 */
export type ProductEditRecoveryData = ProductEditRecoveryTarget & {
  state: 'not_created' | 'prepared' | 'in_progress' | 'completed' | 'rejected' | 'cancelled'
  canCancel: boolean
  releaseAllowed: boolean
  message: string
}

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

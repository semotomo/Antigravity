import type { ActionResult, ProductEditExecutionData, ProductEditRecoveryData, ProductEditorData, ProductEditorReviewData } from '@/lib/pos-products/editor'
import type { PosProductFields } from '@/lib/pos-products/types'

export type PreviewScenario = 'normal' | 'network-error' | 'conflict' | 'save-normal' | 'prepare-response-lost' | 'prepare-before-ledger' | 'prepare-unregistered' | 'save-response-lost' | 'db-pending' | 'save-rejected' | 'prepared-expired' | 'cancel-response-lost'
let scenario: PreviewScenario = 'normal'
let loads = 0
const operations = new Map<string, ProductEditExecutionData>()
const preparationCounts = new Map<string, number>()
const cancellations = new Set<string>()

const FIELD_LABELS: Record<keyof PosProductFields, string> = {
  name: '商品名', groupId: '商品グループ', price: '商品金額', cost: '商品原価', supplierId: '仕入先',
}
const pause = () => new Promise(resolve => setTimeout(resolve, 800))

export function configurePreviewScenario(next: PreviewScenario) {
  scenario = next
  loads = 0
}

function fixture(latest = false): ProductEditorData {
  return {
    storeId: 7, productId: 90001, janCode: '0000000000000', capturedAt: Date.now(),
    fingerprint: (latest ? 'b' : 'a').repeat(64),
    fields: {
      name: latest ? 'POSで外部変更された合成商品' : '合成テスト商品', groupId: 'fixture-group-a',
      price: latest ? '200' : '126', cost: latest ? '90' : '75', supplierId: 'fixture-supplier-a',
    },
    groups: [{ id: 'fixture-group-a', name: '合成グループA' }, { id: 'fixture-group-b', name: '合成グループB' }],
    suppliers: [{ id: 'fixture-supplier-a', name: '合成仕入先A' }, { id: 'fixture-supplier-b', name: '合成仕入先B' }],
  }
}

function target(input: unknown): input is { storeId: 7; productId: number; operationId: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return value.storeId === 7 && value.productId === 90001 && typeof value.operationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId)
}

export async function loadPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditorData>> {
  await pause()
  if (!target(input)) return { success: false, error: '合成テストの対象が一致しません。' }
  loads++
  return { success: true, data: fixture(scenario === 'conflict' && loads > 1) }
}

export async function reviewPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditorReviewData>> {
  await pause()
  if (!target(input)) return { success: false, error: '合成テストの対象が一致しません。' }
  const value = input as unknown as Record<string, unknown>
  if (value.kind !== 'update' || !value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) {
    return { success: false, error: '合成テストの入力を確認してください。' }
  }
  if (scenario === 'network-error') return { success: false, error: '合成通信失敗：変更内容を確認できません。入力は保持されています。' }
  const current = fixture(scenario === 'conflict')
  if (value.expectedFingerprint !== current.fingerprint) {
    return { success: false, error: '合成競合：POS商品が編集開始後に変更されました。入力を保持してPOSから読み直してください。' }
  }
  const fields = value.fields as Record<string, unknown>
  const keys = Object.keys(FIELD_LABELS) as (keyof PosProductFields)[]
  if (Object.keys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) ||
      typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 200 ||
      typeof fields.price !== 'string' || !/^\d{1,9}$/.test(fields.price) ||
      typeof fields.cost !== 'string' || !/^\d{1,9}$/.test(fields.cost) ||
      !current.groups.some(group => group.id === fields.groupId) ||
      (fields.supplierId !== null && !current.suppliers.some(supplier => supplier.id === fields.supplierId))) {
    return { success: false, error: '合成テストの5項目・店舗別候補・整数円を確認してください。' }
  }
  const changes: ProductEditorReviewData['changes'] = []
  for (const field of keys) {
    const after = fields[field] as string | null
    if (current.fields[field] !== after) {
      const catalog = field === 'groupId' ? current.groups : field === 'supplierId' ? current.suppliers : null
      const label = (value: string | null) => value === null ? null : catalog?.find(choice => choice.id === value)?.name ?? value
      changes.push({ field, label: FIELD_LABELS[field], before: label(current.fields[field]), after: label(after) })
    }
  }
  if (!changes.length) return { success: false, error: '変更された項目がありません。' }
  return { success: true, data: { operationId: input.operationId, reviewedAt: Date.now(), changes } }
}

function executionTarget(input: unknown): input is { storeId: 7; operationId: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return Object.keys(value).length === 2 && value.storeId === 7 && typeof value.operationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId)
}

export async function preparePosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditExecutionData>> {
  const checked = await reviewPosProductEditorAction(input)
  if (!checked.success) return checked
  const operationId = checked.data.operationId
  if (cancellations.has(operationId)) return { success: false, error: '合成取消済みの同じ操作IDでは保存準備できません。実通信はありません。' }
  const count = (preparationCounts.get(operationId) ?? 0) + 1
  preparationCounts.set(operationId, count)
  if (scenario === 'prepare-before-ledger' && count === 1) {
    return { success: false, error: '合成RPC前失敗：固定入力で保存準備だけ再試行してください。' }
  }
  const existing = operations.get(operationId)
  const data: ProductEditExecutionData = existing ?? {
    storeId: 7, operationId, status: 'prepared', version: 0, sendAttempts: 0, stage: 'prepared', nextAction: 'save',
    posValuesVerified: null, expiresAt: Date.now() + 5 * 60 * 1000, message: '合成保存準備済み。実データには接続していません。',
  }
  // 合成状態DTOだけを保持する。入力本文・資格情報・POS台帳は作らない。
  operations.set(operationId, data)
  if (scenario === 'prepare-unregistered') {
    const next = { ...data, nextAction: count === 1 ? 'none' as const : 'save' as const,
      message: count === 1 ? '合成dispatch未登録。保存準備だけを再試行してください。' : '同じ入力の合成登録を確認しました。保存は別途確認してください。' }
    operations.set(operationId, next)
    return { success: true, data: { ...next } }
  }
  if (scenario === 'prepared-expired') {
    const expired = { ...data, nextAction: 'none' as const, expiresAt: Date.now() - 1, message: '合成準備は期限切れです。未送信取消を確認できます。' }
    operations.set(operationId, expired)
    return { success: true, data: { ...expired } }
  }
  if (['prepare-response-lost', 'cancel-response-lost'].includes(scenario) && !existing) {
    return { success: false, error: '合成準備応答消失：同じ操作IDで保存状態を確認してください。' }
  }
  return { success: true, data: { ...data } }
}

export async function savePosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditExecutionData>> {
  await pause()
  if (!executionTarget(input)) return { success: false, error: '合成保存対象が一致しません。' }
  const before = operations.get(input.operationId)
  if (!before) return { success: false, error: '合成操作が見つかりません。新しい操作で再送しないでください。' }
  if (before.stage === 'completed' || before.stage === 'rejected') return { success: true, data: { ...before } }
  if (scenario === 'save-rejected' && before.stage === 'prepared') {
    const data: ProductEditExecutionData = { ...before, status: 'rejected', stage: 'rejected', nextAction: 'none',
      version: 1, sendAttempts: 0, expiresAt: null, message: '合成操作を送信前に拒否しました。POS送信はありません。' }
    operations.set(input.operationId, data)
    return { success: true, data: { ...data } }
  }
  if (scenario === 'save-response-lost' && before.stage === 'prepared') {
    operations.set(input.operationId, { ...before, status: 'uncertain', stage: 'verification_required', nextAction: 'verify',
      version: 2, sendAttempts: 1, expiresAt: null, message: '合成送信の結果が不明です。再送せず照合が必要です。' })
    return { success: false, error: '合成保存応答消失：再送せず同じ操作の保存状態を確認してください。' }
  }
  if (scenario === 'db-pending' && before.stage === 'prepared') {
    const data: ProductEditExecutionData = { ...before, status: 'db_pending', stage: 'db_pending', nextAction: 'apply_db',
      version: 3, sendAttempts: 1, posValuesVerified: true, expiresAt: null, message: '合成POS照合済み。合成DB反映が未完了です。' }
    operations.set(input.operationId, data)
    return { success: true, data: { ...data } }
  }
  const data: ProductEditExecutionData = { ...before, status: 'completed', stage: 'completed', nextAction: 'none',
    version: before.version + 4, sendAttempts: 1, posValuesVerified: true, expiresAt: null, message: '合成POS照合・合成DB反映が完了しました。本番データの保存はありません。' }
  operations.set(input.operationId, data)
  return { success: true, data: { ...data } }
}

export async function recoverPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditExecutionData>> {
  await pause()
  if (!executionTarget(input)) return { success: false, error: '合成復旧対象が一致しません。' }
  const data = operations.get(input.operationId)
  return data ? { success: true, data: { ...data } }
    : { success: false, error: '合成操作のメモリ状態がありません。実通信・再送は行っていません。' }
}

export async function inspectPosProductEditorRecoveryAction(input: unknown): Promise<ActionResult<ProductEditRecoveryData>> {
  await pause()
  if (!target(input) || Object.keys(input).length !== 3) return { success: false, error: '合成取消対象が一致しません。' }
  const op = operations.get(input.operationId)
  const state = cancellations.has(input.operationId) ? 'cancelled' : !op ? 'not_created' : op.stage === 'prepared' ? 'prepared' :
    op.stage === 'completed' ? 'completed' : op.stage === 'rejected' ? 'rejected' : 'in_progress'
  return { success: true, data: { ...input, state, canCancel: state === 'not_created' || state === 'prepared',
    releaseAllowed: ['cancelled', 'completed', 'rejected'].includes(state), message: state === 'cancelled'
      ? '合成の未送信取消を確認しました。同じIDの合成準備も拒否します。本番データは変更していません。'
      : state === 'in_progress' ? '合成の送信後操作は取消できません。結果確認を続けてください。' : '合成対象3項目の状態だけを確認しました。未作成は取消完了まで解除できません。' } }
}

export async function cancelPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditRecoveryData>> {
  const checked = await inspectPosProductEditorRecoveryAction(input)
  if (!checked.success) return checked
  const data = checked.data
  if (data.state === 'cancelled') return checked
  if (!data.canCancel) return { success: false, error: '合成の送信後/結果不明/完了操作は取消できません。' }
  cancellations.add(data.operationId)
  const op = operations.get(data.operationId)
  if (op) operations.set(data.operationId, { ...op, status: 'rejected', stage: 'rejected', version: op.version + 1,
    sendAttempts: 0, nextAction: 'none', expiresAt: null, message: '合成の未送信操作を取り消しました。' })
  if (scenario === 'cancel-response-lost') return { success: false, error: '合成取消応答が失われました。同じ操作IDで読取り状態確認してください。' }
  return inspectPosProductEditorRecoveryAction({ storeId: data.storeId, productId: data.productId, operationId: data.operationId })
}

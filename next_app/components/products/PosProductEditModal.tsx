'use client'

import { useEffect, useId, useReducer, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/components/ui/StatusBadge'
import { loadPosProductEditorAction, reviewPosProductEditorAction } from '@/app/actions/posProducts'
import { getProductStoreName } from '@/lib/productStores'
import type { ProductListRow } from '@/lib/products'
import type { ProductEditExecutionData, ProductEditRecoveryData, ProductEditorData, ProductEditorReviewData } from '@/lib/pos-products/editor'
import type { PosProductCommand, PosProductFields } from '@/lib/pos-products/types'

type EditorState = {
  baseline: ProductEditorData | null
  draft: PosProductFields | null
  refreshed: ProductEditorData | null
  review: ProductEditorReviewData | null
  error: string | null
  recovery: ProductEditorRecovery | null
  execution: ProductEditExecutionData | null
  storageReady: boolean
  storageBlocked: boolean
  executionNeedsRecovery: boolean
  frozenCommand: ProductEditorUpdateCommand | null
  preparationOnly: boolean
  recoveryCheck: ProductEditRecoveryData | null
  storageIdentityAmbiguous: boolean
}

type ProductEditorRecovery = { storeId: 6 | 7; productId: number; operationId: string }
type ProductEditorUpdateCommand = Extract<PosProductCommand, { kind: 'update' }>

type EditorEvent =
  | { type: 'loaded'; data: ProductEditorData }
  | { type: 'changed'; field: keyof PosProductFields; value: string }
  | { type: 'keep-input' }
  | { type: 'replace-input' }
  | { type: 'reviewed'; data: ProductEditorReviewData }
  | { type: 'failed'; error: string }
  | { type: 'clear-message' }
  | { type: 'storage-ready' }
  | { type: 'storage-blocked'; error: string; ambiguous?: boolean }
  | { type: 'recovery-checked'; data: ProductEditRecoveryData }
  | { type: 'recovery-checking' }
  | { type: 'execution-started'; pointer: ProductEditorRecovery; command?: ProductEditorUpdateCommand | null; preparationOnly?: boolean }
  | { type: 'execution-command'; command: ProductEditorUpdateCommand }
  | { type: 'execution-dispatched' }
  | { type: 'execution-preparing' }
  | { type: 'execution-result'; data: ProductEditExecutionData }
  | { type: 'execution-failed'; error: string }

const FIELD_LABELS: Record<keyof PosProductFields, string> = {
  name: '商品名', groupId: '商品グループ', price: '商品金額', cost: '商品原価', supplierId: '仕入先',
}
const INPUT_CLASS = 'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20 disabled:bg-gray-100'
const BUTTON_CLASS = 'rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-50'

export function initialProductEditorState(): EditorState {
  return { baseline: null, draft: null, refreshed: null, review: null, error: null,
    recovery: null, execution: null, storageReady: false, storageBlocked: false, executionNeedsRecovery: false,
    frozenCommand: null, preparationOnly: false, recoveryCheck: null, storageIdentityAmbiguous: false }
}

export function productEditorReducer(state: EditorState, event: EditorEvent): EditorState {
  // 保存を開始した入力は、結果不明・復旧後も別の操作へ変更しない。
  if ((state.recovery || state.storageBlocked) && ['loaded', 'changed', 'keep-input', 'replace-input', 'reviewed', 'clear-message'].includes(event.type)) return state
  switch (event.type) {
    case 'loaded':
      // 再取得しても入力と元の基準は変更せず、採用方法を利用者が選ぶ。
      return state.draft
        ? { ...state, refreshed: event.data, review: null, error: null }
        : { ...state, baseline: event.data, draft: { ...event.data.fields }, review: null, error: null }
    case 'changed':
      if (!state.draft) return state
      return { ...state, draft: { ...state.draft, [event.field]: event.field === 'supplierId' && event.value === '' ? null : event.value }, review: null, error: null }
    case 'keep-input':
      return state.refreshed ? { ...state, baseline: state.refreshed, refreshed: null, review: null, error: null } : state
    case 'replace-input':
      return state.refreshed ? { ...state, baseline: state.refreshed, draft: { ...state.refreshed.fields }, refreshed: null, review: null, error: null } : state
    case 'reviewed':
      return { ...state, review: event.data, error: null }
    case 'failed':
      return { ...state, review: null, error: event.error }
    case 'clear-message':
      return { ...state, review: null, error: null }
    case 'storage-ready':
      return { ...state, storageReady: true }
    case 'storage-blocked':
      return { ...state, storageReady: true, storageBlocked: true, storageIdentityAmbiguous: event.ambiguous ?? state.storageIdentityAmbiguous, error: event.error }
    case 'recovery-checked':
      return { ...state, recoveryCheck: event.data, error: null }
    case 'recovery-checking':
      return { ...state, recoveryCheck: null }
    case 'execution-started':
      return state.recovery ? state : { ...state, recovery: event.pointer, storageReady: true, executionNeedsRecovery: true,
        frozenCommand: event.command ?? null, preparationOnly: event.preparationOnly ?? false,
        draft: state.draft ?? (event.command ? { ...event.command.fields } : null), error: null }
    case 'execution-command':
      return { ...state, frozenCommand: event.command, draft: state.draft ?? { ...event.command.fields } }
    case 'execution-dispatched':
      return { ...state, preparationOnly: false, recoveryCheck: null }
    case 'execution-preparing':
      return { ...state, preparationOnly: true, recoveryCheck: null }
    case 'execution-result':
      return { ...state, execution: event.data, executionNeedsRecovery: false, recoveryCheck: null, error: null }
    case 'execution-failed':
      return { ...state, executionNeedsRecovery: true, recoveryCheck: null, error: event.error }
  }
}

export function parseProductEditorRecovery(raw: string | null, storeId: 6 | 7, productId: number): ProductEditorRecovery | null {
  if (raw === null) return null
  if (raw.length > 256) throw new Error('復旧情報を確認できません。')
  const pointer: unknown = JSON.parse(raw)
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) throw new Error('復旧情報を確認できません。')
  const value = pointer as Record<string, unknown>
  if (Object.keys(value).length !== 3 || value.storeId !== storeId || value.productId !== productId ||
      !Number.isSafeInteger(productId) || productId <= 0 || typeof value.operationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId)) {
    throw new Error('復旧情報を確認できません。')
  }
  return { storeId, productId, operationId: value.operationId }
}

export function parseProductEditorIntent(raw: string, pointer: ProductEditorRecovery, parseCommand: (value: unknown) => PosProductCommand): ProductEditorUpdateCommand {
  if (raw.length > 4096) throw new Error('固定入力を確認できません。')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('固定入力を確認できません。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 6 || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields) ||
      Object.keys(input.fields).length !== 5 || Object.keys(FIELD_LABELS).some(field => !Object.hasOwn(input.fields!, field))) {
    throw new Error('固定入力を確認できません。')
  }
  const command = parseCommand(value)
  if (command.kind !== 'update' || command.storeId !== pointer.storeId || command.productId !== pointer.productId ||
      command.operationId !== pointer.operationId || (Object.keys(FIELD_LABELS) as (keyof PosProductFields)[])
        .some(field => command.fields[field] !== (input.fields as Record<string, unknown>)[field])) {
    throw new Error('固定入力の対象が一致しません。')
  }
  return command
}

const STAGE_LABELS: Record<ProductEditExecutionData['stage'], string> = {
  prepared: '保存準備済み', dispatching: 'POS送信処理中・結果未確認', verification_required: 'POS結果の照合が必要',
  pos_confirmed: 'POSの変更を確認済み・DB反映待ち', db_pending: 'POSの変更を確認済み・DB反映待ち',
  completed: 'POS照合・DB反映完了', rejected: '操作が拒否されました',
}

function recoveryKey(storeId: 6 | 7, productId: number) {
  return `kennel-pos-edit-execution:v1:${storeId}:${productId}`
}
function intentKey(storeId: 6 | 7, productId: number) { return `kennel-pos-edit-intent:v1:${storeId}:${productId}` }
function phaseKey(storeId: 6 | 7, productId: number) { return `kennel-pos-edit-phase:v1:${storeId}:${productId}` }

export function hasProductEditorChanges(state: EditorState): boolean {
  return Boolean(state.baseline && state.draft &&
    (Object.keys(FIELD_LABELS) as (keyof PosProductFields)[]).some(field => state.draft?.[field] !== state.baseline?.fields[field]))
}

function displayField(data: ProductEditorData, field: keyof PosProductFields): string {
  const value = data.fields[field]
  if (field === 'groupId') return data.groups.find(choice => choice.id === value)?.name ?? value ?? '未設定'
  if (field === 'supplierId') return data.suppliers.find(choice => choice.id === value)?.name ?? value ?? '未設定'
  return value ?? '未設定'
}

type PosProductEditModalProps = {
  product: ProductListRow
  storeId: 6 | 7
  onClose: () => void
  savingEnabled?: boolean
  onSaved?: () => void
}

export function PosProductEditModal({ product, storeId, onClose, savingEnabled = false, onSaved }: PosProductEditModalProps) {
  const [state, dispatch] = useReducer(productEditorReducer, undefined, initialProductEditorState)
  const [pending, setPending] = useState<'load' | 'review' | 'prepare' | 'save' | 'recover' | 'inspect' | 'cancel' | null>(null)
  const [confirmation, setConfirmation] = useState<'close' | 'replace' | 'save' | 'continue' | 'cancel' | null>(null)
  const [rescueOperationId, setRescueOperationId] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const operationId = useRef<string | null>(null)
  const executionLock = useRef<ProductEditorRecovery | null>(null)
  const notifiedOperation = useRef<string | null>(null)
  const latestExecution = useRef<ProductEditExecutionData | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const dirty = hasProductEditorChanges(state)
  const baseline = state.baseline
  const draft = state.draft
  const locked = state.recovery !== null || state.storageBlocked
  const editDisabled = pending !== null || locked || !state.storageReady
  const executionCompleted = !state.executionNeedsRecovery && state.execution?.stage === 'completed'
  const executionRejected = !state.executionNeedsRecovery && state.execution?.stage === 'rejected'
  const recoveryRelease = !state.storageIdentityAmbiguous && state.recoveryCheck?.releaseAllowed === true
  // 今回のhandler内で束縛した操作以外は、対象3項目のサーバー確認が解除に必要。
  const releaseConfirmed = recoveryRelease || (!state.storageBlocked && baseline !== null && (executionCompleted || executionRejected))
  const continuationAllowed = !state.recoveryCheck?.releaseAllowed && !state.storageBlocked && !state.executionNeedsRecovery && state.execution !== null &&
    (state.execution.nextAction === 'verify' || state.execution.nextAction === 'apply_db' ||
      (savingEnabled && state.execution.nextAction === 'save'))
  const prepareRetryAllowed = !state.recoveryCheck?.releaseAllowed && savingEnabled && !state.storageBlocked && state.frozenCommand !== null &&
    ((state.preparationOnly && state.executionNeedsRecovery && (!state.execution || state.execution.stage === 'prepared')) ||
      (!state.executionNeedsRecovery && state.execution?.stage === 'prepared' && state.execution.sendAttempts === 0 && state.execution.nextAction === 'none'))

  useEffect(() => {
    let active = true
    // 初期表示は公開された固定入力と識別子だけを復元し、自動照合・書込みはしない。
    queueMicrotask(async () => {
      if (!active) return
      let ambiguous = false
      try {
        const rawPointer = window.sessionStorage.getItem(recoveryKey(storeId, product.id))
        const rawIntent = window.sessionStorage.getItem(intentKey(storeId, product.id))
        const phase = window.sessionStorage.getItem(phaseKey(storeId, product.id))
        // 途中書込みでも識別子だけは先に保持する。異なるID/所属の混在は一括解除しない。
        const candidates: ProductEditorRecovery[] = []
        for (const raw of [rawPointer, rawIntent]) {
          if (raw === null) continue
          try {
            if (raw.length > 4096) { ambiguous = true; continue }
            const value = JSON.parse(raw)
            if (value && typeof value.operationId === 'string') {
              if (value.storeId !== storeId || value.productId !== product.id) { ambiguous = true; continue }
              const candidate = parseProductEditorRecovery(JSON.stringify({ storeId, productId: product.id, operationId: value.operationId }), storeId, product.id)
              if (candidate) candidates.push(candidate)
            }
          } catch { /* 他方に残る有効IDだけを救済する。両方不明なら停止する。 */ }
        }
        ambiguous ||= candidates.some(candidate => candidate.operationId !== candidates[0].operationId) ||
          (candidates.length === 0 && (rawPointer !== null || rawIntent !== null || phase !== null))
        const recovered = candidates[0] ?? null
        if (recovered) {
          executionLock.current = recovered
          operationId.current = recovered.operationId
          dispatch({ type: 'execution-started', pointer: recovered })
        }
        const pointer = parseProductEditorRecovery(rawPointer, storeId, product.id)
        let command: ProductEditorUpdateCommand | null = null
        if (ambiguous || (!pointer && (rawIntent !== null || phase !== null)) || ((rawIntent === null) !== (phase === null))) throw new Error('復旧情報が一致しません。')
        if (rawIntent !== null && pointer) {
          if (phase !== 'prepare' && phase !== 'execute') throw new Error('復旧段階を確認できません。')
          const { parsePosProductCommand } = await import(/* webpackMode: "eager" */ '@/lib/pos-products/validation')
          command = parseProductEditorIntent(rawIntent, pointer, parsePosProductCommand)
        }
        if (!active) return
        if (pointer) {
          executionLock.current = pointer
          operationId.current = pointer.operationId
          if (command) dispatch({ type: 'execution-command', command })
          if (phase === 'prepare') dispatch({ type: 'execution-preparing' })
        } else dispatch({ type: 'storage-ready' })
      } catch {
        if (active) dispatch({ type: 'storage-blocked', ambiguous, error: '復旧情報を安全に確認できないため、新しい操作は停止しています。元の操作IDで取消・解除条件をサーバー確認してください。IDを特定できない場合は管理者の確認が必要です。' })
      }
    })
    return () => { active = false }
  }, [storeId, product.id])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  useEffect(() => {
    if (!dirty && !pending && !locked) return
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [dirty, pending, locked])

  function close() {
    if (inFlight.current) return
    if (releaseConfirmed && state.recovery) {
      try {
        window.sessionStorage.removeItem(intentKey(storeId, product.id))
        window.sessionStorage.removeItem(phaseKey(storeId, product.id))
        window.sessionStorage.removeItem(recoveryKey(storeId, product.id))
      }
      catch {
        dispatch({ type: 'execution-failed', error: '確定した操作の復旧情報を解除できません。画面は閉じず、ブラウザの保存設定を確認してください。' })
        setConfirmation(null)
        return
      }
    }
    onClose()
  }

  function requestClose() {
    if (inFlight.current) return
    if (dirty || locked || executionLock.current) setConfirmation('close')
    else close()
  }

  async function load() {
    if (inFlight.current || locked || executionLock.current || !state.storageReady) return
    inFlight.current = true
    setPending('load')
    dispatch({ type: 'clear-message' })
    try {
      operationId.current ??= crypto.randomUUID()
      const result = await loadPosProductEditorAction({ storeId, productId: product.id, operationId: operationId.current })
      if (result.success) {
        if (result.data.storeId !== storeId || result.data.productId !== product.id || result.data.janCode !== product.jan_code) throw new Error('商品の対象が一致しません。')
        dispatch({ type: 'loaded', data: result.data })
      }
      else dispatch({ type: 'failed', error: result.error })
    } catch {
      dispatch({ type: 'failed', error: 'POSの商品情報を取得できません。入力を保持して取得し直してください。' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  async function review() {
    if (inFlight.current || locked || executionLock.current || !state.storageReady || !baseline || !draft || state.refreshed || !operationId.current) return
    inFlight.current = true
    setPending('review')
    dispatch({ type: 'clear-message' })
    try {
      const result = await reviewPosProductEditorAction({ kind: 'update', storeId, productId: product.id,
        operationId: operationId.current, expectedFingerprint: baseline.fingerprint, fields: draft })
      if (result.success) {
        if (result.data.operationId !== operationId.current) throw new Error('レビューの対象が一致しません。')
        dispatch({ type: 'reviewed', data: result.data })
      }
      else dispatch({ type: 'failed', error: result.error })
    } catch {
      dispatch({ type: 'failed', error: '変更内容を確認できません。入力を保持しています。POS値を再取得して確認してください。' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  function acceptExecution(data: ProductEditExecutionData, pointer: ProductEditorRecovery) {
    if (data.storeId !== pointer.storeId || data.operationId !== pointer.operationId ||
        !Object.hasOwn(STAGE_LABELS, data.stage) || !Number.isSafeInteger(data.version) || data.version < 0 ||
        (data.sendAttempts !== 0 && data.sendAttempts !== 1) ||
        (latestExecution.current && (data.version < latestExecution.current.version || (['completed', 'rejected'].includes(latestExecution.current.stage) && data.stage !== latestExecution.current.stage))) ||
        (data.stage === 'rejected' && (data.status !== 'rejected' || data.nextAction !== 'none' || data.sendAttempts !== 0)) ||
        (data.stage === 'completed' && (data.status !== 'completed' || data.posValuesVerified !== true || data.sendAttempts !== 1 || data.nextAction !== 'none'))) {
      throw new Error('保存状態の対象を確認できません。')
    }
    latestExecution.current = data
    dispatch({ type: 'execution-result', data })
    if (data.stage === 'completed' && notifiedOperation.current !== data.operationId) {
      notifiedOperation.current = data.operationId
      onSaved?.()
    }
  }

  async function persistIntent(pointer: ProductEditorRecovery, input: ProductEditorUpdateCommand): Promise<ProductEditorUpdateCommand> {
    const { parsePosProductCommand } = await import(/* webpackMode: "eager" */ '@/lib/pos-products/validation')
    const parsed = parsePosProductCommand(input)
    if (parsed.kind !== 'update' || parsed.storeId !== pointer.storeId || parsed.productId !== pointer.productId || parsed.operationId !== pointer.operationId) {
      throw new Error('固定入力の対象が一致しません。')
    }
    const command = { ...parsed, fields: { ...parsed.fields } }
    window.sessionStorage.setItem(recoveryKey(storeId, product.id), JSON.stringify(pointer))
    window.sessionStorage.setItem(intentKey(storeId, product.id), JSON.stringify(command))
    window.sessionStorage.setItem(phaseKey(storeId, product.id), 'prepare')
    dispatch({ type: 'execution-command', command })
    return command
  }

  function markExecutionStarted() {
    if (state.frozenCommand) window.sessionStorage.setItem(phaseKey(storeId, product.id), 'execute')
    dispatch({ type: 'execution-dispatched' })
  }

  async function startSave() {
    if (!savingEnabled || inFlight.current || locked || executionLock.current || !state.storageReady ||
        !baseline || !draft || state.refreshed || !state.review || !operationId.current ||
        state.review.operationId !== operationId.current) return
    const pointer: ProductEditorRecovery = { storeId, productId: product.id, operationId: operationId.current }
    const command = { kind: 'update' as const, storeId, productId: product.id, operationId: pointer.operationId,
      expectedFingerprint: baseline.fingerprint, fields: { ...draft } }
    // awaitより先に入力/操作IDを固定する。復旧には公開された業務入力だけを残す。
    executionLock.current = pointer
    inFlight.current = true
    dispatch({ type: 'execution-started', pointer, command, preparationOnly: true })
    setConfirmation(null)
    setPending('prepare')
    try {
      const frozenCommand = await persistIntent(pointer, command)
      const actions = await import(/* webpackMode: "eager" */ '@/app/actions/posProductExecution')
      const prepared = await actions.preparePosProductEditorAction(frozenCommand)
      if (!prepared.success) { dispatch({ type: 'execution-failed', error: prepared.error }); return }
      acceptExecution(prepared.data, pointer)
      if (prepared.data.stage === 'prepared' && prepared.data.nextAction === 'save') {
        // 初回handlerのstateは固定前なので、再読込用phaseも必ず保存前に更新する。
        window.sessionStorage.setItem(phaseKey(storeId, product.id), 'execute')
        dispatch({ type: 'execution-dispatched' })
        setPending('save')
        const result = await actions.savePosProductEditorAction({ storeId: pointer.storeId, operationId: pointer.operationId })
        if (result.success) acceptExecution(result.data, pointer)
        else dispatch({ type: 'execution-failed', error: result.error })
      }
    } catch {
      dispatch({ type: 'execution-failed', error: '保存開始・結果を確認できません。入力と操作IDを保持しています。再送せず保存状態を確認してください。' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  async function retryPrepare() {
    const pointer = executionLock.current ?? state.recovery
    if (inFlight.current || !prepareRetryAllowed || !pointer || !state.frozenCommand) return
    inFlight.current = true
    setPending('prepare')
    dispatch({ type: 'execution-preparing' })
    try {
      const command = await persistIntent(pointer, state.frozenCommand)
      const { preparePosProductEditorAction } = await import(/* webpackMode: "eager" */ '@/app/actions/posProductExecution')
      const result = await preparePosProductEditorAction(command)
      if (result.success) acceptExecution(result.data, pointer)
      else dispatch({ type: 'execution-failed', error: result.error })
      // 再準備はPOS保存へ進めない。結果表示後、利用者が別途継続を確認する。
    } catch {
      dispatch({ type: 'execution-failed', error: '同じ入力の保存準備を確認できません。入力・操作IDは変更しません。基準値の競合が続く場合は管理者に確認してください。' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  async function recover() {
    const pointer = executionLock.current ?? state.recovery
    if (inFlight.current || !pointer) return
    inFlight.current = true
    setPending('recover')
    try {
      const { recoverPosProductEditorAction } = await import(/* webpackMode: "eager" */ '@/app/actions/posProductExecution')
      const result = await recoverPosProductEditorAction({ storeId: pointer.storeId, operationId: pointer.operationId })
      if (result.success) acceptExecution(result.data, pointer)
      else dispatch({ type: 'execution-failed', error: result.error })
    } catch {
      dispatch({ type: 'execution-failed', error: '保存状態を確認できません。同じ操作IDを保持しています。新しい操作で再送しないでください。' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  async function continueSave() {
    const pointer = executionLock.current ?? state.recovery
    if (inFlight.current || !pointer || !continuationAllowed) return
    inFlight.current = true
    setConfirmation(null)
    setPending('save')
    try {
      markExecutionStarted()
      const { savePosProductEditorAction } = await import(/* webpackMode: "eager" */ '@/app/actions/posProductExecution')
      const result = await savePosProductEditorAction({ storeId: pointer.storeId, operationId: pointer.operationId })
      if (result.success) acceptExecution(result.data, pointer)
      else dispatch({ type: 'execution-failed', error: result.error })
    } catch {
      dispatch({ type: 'execution-failed', error: '処理結果を確認できません。再送せず同じ操作IDで保存状態を確認してください。' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  function acceptRecoveryCheck(data: ProductEditRecoveryData, pointer: ProductEditorRecovery) {
    if (Object.keys(data).length !== 7 || data.storeId !== pointer.storeId || data.productId !== pointer.productId ||
        data.operationId !== pointer.operationId || !['not_created', 'prepared', 'in_progress', 'completed', 'rejected', 'cancelled'].includes(data.state) ||
        typeof data.canCancel !== 'boolean' || typeof data.releaseAllowed !== 'boolean' || typeof data.message !== 'string' ||
        (data.releaseAllowed !== ['completed', 'rejected', 'cancelled'].includes(data.state)) ||
        (data.canCancel && !['prepared', 'not_created'].includes(data.state))) throw new Error('解除状態を確認できません。')
    dispatch({ type: 'recovery-checked', data })
  }

  async function inspectRecovery() {
    if (inFlight.current) return
    let pointer = executionLock.current ?? state.recovery
    try {
      pointer ??= parseProductEditorRecovery(JSON.stringify({ storeId, productId: product.id, operationId: rescueOperationId.trim() }), storeId, product.id)
      if (!pointer) return
    } catch { dispatch({ type: 'failed', error: '操作IDは元のUUIDを入力してください。新しいIDを作成しないでください。' }); return }
    inFlight.current = true
    setPending('inspect')
    dispatch({ type: 'recovery-checking' })
    try {
      const { inspectPosProductEditorRecoveryAction } = await import(/* webpackMode: "eager" */ '@/app/actions/posProductExecution')
      const result = await inspectPosProductEditorRecoveryAction(pointer)
      if (!result.success) { dispatch({ type: 'execution-failed', error: result.error }); return }
      acceptRecoveryCheck(result.data, pointer)
      if (!state.recovery) {
        executionLock.current = pointer
        operationId.current = pointer.operationId
        dispatch({ type: 'execution-started', pointer })
      }
    } catch { dispatch({ type: 'execution-failed', error: '取消・解除条件を確認できません。復旧情報は保持しています。' }) }
    finally { inFlight.current = false; setPending(null) }
  }

  async function cancelOperation() {
    const pointer = executionLock.current ?? state.recovery
    if (inFlight.current || !pointer || state.storageIdentityAmbiguous || !state.recoveryCheck?.canCancel) return
    inFlight.current = true
    setPending('cancel')
    setConfirmation(null)
    dispatch({ type: 'recovery-checking' })
    try {
      const { cancelPosProductEditorAction } = await import(/* webpackMode: "eager" */ '@/app/actions/posProductExecution')
      const result = await cancelPosProductEditorAction(pointer)
      if (!result.success) { dispatch({ type: 'execution-failed', error: result.error }); return }
      if (result.data.state !== 'cancelled' || !result.data.releaseAllowed || result.data.canCancel) throw new Error('取消未確認')
      acceptRecoveryCheck(result.data, pointer)
      // 閉じる確認までstorage/入力を保持し、自動保存や別IDで再送しない。
    } catch { dispatch({ type: 'execution-failed', error: '取消の完了を確認できません。同じ操作IDで状態確認してください。' }) }
    finally { inFlight.current = false; setPending(null) }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
      role={confirmation ? 'alertdialog' : undefined}
      className="m-auto w-full max-w-3xl overflow-y-auto rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/60"
      style={{ width: 'calc(100% - 2rem)', maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)' }}
      onCancel={event => { event.preventDefault(); if (inFlight.current) return; if (confirmation) setConfirmation(null); else requestClose() }}
      onClick={event => { if (event.target === event.currentTarget && !confirmation) requestClose() }}>
      {confirmation ? (
        <div className="space-y-5 p-6">
          <h2 id={titleId} className="text-balance text-xl font-bold">{confirmation === 'cancel' ? 'この未送信操作を取り消しますか？' : confirmation === 'close' ? locked ? releaseConfirmed ? '確定した結果を確認して閉じますか？' : '保存状況を保持して閉じますか？' : '編集内容を破棄しますか？' : confirmation === 'replace' ? '最新のPOS値で置き換えますか？' : confirmation === 'save' ? '確認した内容をPOSへ保存しますか？' : '同じ操作の処理を続けますか？'}</h2>
          <p id={descriptionId} className="text-pretty text-sm text-gray-600">{confirmation === 'close'
            ? locked ? recoveryRelease ? 'サーバーで対象の終了・予約解放を確認しました。この対象の復旧情報だけを解除します。再度開いてPOSの最新値を読み込んでください。' : releaseConfirmed && executionCompleted ? 'POS照合とDB反映が完了しました。閉じると完了した操作の復旧情報を解除します。' : releaseConfirmed && executionRejected ? 'この操作はPOS送信前に拒否されたことが確定しています。閉じると拒否された操作の復旧情報を解除し、再度POSの最新値から編集できます。' : state.frozenCommand ? '保存結果が未確認の場合があります。同じ固定入力と操作IDをこのタブに保持します。再度開いて保存状況を確認してください。' : '保存結果が未確認の場合があります。同じ操作IDをこのタブに保持します。入力値は復元できませんが、再度開いて保存状況を確認してください。' : '画面で入力した変更は失われます。POSには保存されていません。'
            : confirmation === 'cancel' ? '店舗・商品・本人と操作IDを再照合し、POS未送信の準備だけを取り消します。送信開始済みや結果不明の操作は解除しません。同じIDの遅延準備も拒否し、成功後は閉じる確認まで入力・復旧情報を保持します。'
            : confirmation === 'replace' ? '現在の入力を破棄し、再取得したPOS値を入力欄に反映します。'
            : confirmation === 'save' ? '店舗とJANは変更しません。確認した5項目を固定し、POS保存・保存後照合・DB反映を開始します。処理結果が不明になった場合は新しい操作で再送しないでください。'
            : '固定済みの入力と同じ操作IDで続けます。POS送信済みの場合は再送せず、状態に応じた照合またはDB反映を行います。'}</p>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" autoFocus disabled={pending !== null} onClick={() => setConfirmation(null)} className={BUTTON_CLASS}>{locked ? '状態表示に戻る' : '編集に戻る'}</button>
            <button type="button" onClick={() => {
              if (inFlight.current) return
              if (confirmation === 'close') close()
              else if (confirmation === 'replace') { dispatch({ type: 'replace-input' }); setConfirmation(null) }
              else if (confirmation === 'save') void startSave()
              else if (confirmation === 'cancel') void cancelOperation()
              else void continueSave()
            }} disabled={pending !== null} className={BUTTON_CLASS}>{confirmation === 'cancel' ? 'この操作の未送信取消を実行' : confirmation === 'close' ? locked ? recoveryRelease ? '確認済みの復旧情報を解除して閉じる' : releaseConfirmed && executionCompleted ? '完了して閉じる' : releaseConfirmed && executionRejected ? '拒否を確認して閉じる' : '保存状況を保持して閉じる' : '入力を破棄して閉じる' : confirmation === 'replace' ? '最新のPOS値で置き換える' : confirmation === 'save' ? '確認した内容をPOSへ保存する' : '同じ操作で処理を続ける'}</button>
          </div>
        </div>
      ) : (
        <>
          <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
            <div>
              <h2 id={titleId} className="text-balance text-2xl font-bold">POS商品を編集・確認</h2>
              <p id={descriptionId} className="mt-2 text-pretty text-sm text-gray-600">{getProductStoreName(storeId)} / JAN <span className="tabular-nums">{baseline?.janCode ?? product.jan_code}</span></p>
              <p className="mt-1 text-sm text-gray-500">{product.product_name}</p>
            </div>
            <button type="button" onClick={requestClose} disabled={pending !== null} aria-label="閉じる" className={cn(BUTTON_CLASS, 'shrink-0 p-2')}><X className="size-5" /></button>
          </header>
          <div className="space-y-6 px-6 py-6" aria-busy={pending !== null}>
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-pretty text-sm text-amber-900">{savingEnabled
              ? '変更確認後に明示的な保存確認が必要です。結果不明時は再送せず、同じ操作IDで保存状態を確認してください。'
              : locked ? '新しいPOS保存は停止中です。既存操作は、認可済みの状態に応じてPOS照合・DB反映だけを続けられます。'
              : '準備用：変更内容の確認まで。POS保存はまだ有効になっていません。'}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={load} disabled={editDisabled} className={BUTTON_CLASS}>{pending === 'load' ? 'POSから読込中...' : baseline ? 'POS値を再取得' : 'POSから読み込む'}</button>
              {baseline ? <p className="text-xs text-gray-500">取得日時: <span className="tabular-nums">{new Date(baseline.capturedAt).toLocaleString('ja-JP')}</span></p> : <p className="text-sm text-gray-500">POSの現在値を読み込んでから編集してください。</p>}
            </div>
            {state.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-pretty text-sm text-red-700">{state.error}</p> : null}
            {state.storageBlocked && !state.recovery ? <section className="space-y-3 rounded-xl border border-amber-300 p-4" aria-label="操作IDの読取り救済"><p className="text-sm">元の操作IDを特定できないため、新しい編集は開始しません。操作IDを入力して状態だけを確認できますが、元IDとの一致を証明できない復旧情報は解除しません。</p><input aria-label="救済確認の操作ID" value={rescueOperationId} disabled={pending !== null} maxLength={36} onChange={event => setRescueOperationId(event.target.value)} className={INPUT_CLASS} placeholder="元の操作UUID" /><button type="button" disabled={pending !== null} onClick={() => void inspectRecovery()} className={BUTTON_CLASS}>操作IDで状態だけ確認</button></section> : null}
            {state.recovery ? (
              <section aria-live="polite" aria-label="保存・復旧状況" className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="text-balance font-bold">{state.recoveryCheck?.state === 'cancelled' ? '未送信取消・予約解放を確認済み' : state.recoveryCheck?.releaseAllowed ? '操作の終了・予約解放を確認済み' : state.execution ? STAGE_LABELS[state.execution.stage] : '保存状況の確認が必要です'}</h3>
                <p className="text-pretty text-sm text-gray-700">{state.executionNeedsRecovery ? '処理結果が未確認です。入力と操作IDは固定しています。保存状態を確認するまで処理を続けられません。' : state.execution?.message}</p>
                {!baseline ? <p className="text-pretty text-sm text-gray-600">{state.frozenCommand ? 'このタブに保持した同じ固定入力を復元しました。変更せず、同じ操作の復旧だけを行います。' : '前回の入力値は復元できません。サーバーに固定された同じ操作の状況を確認します。新しい編集は開始しません。'}</p> : null}
                {state.frozenCommand ? <p className="text-pretty text-xs text-gray-600">復旧のため、このタブ内に店舗・商品・操作IDと固定した5項目、公開された編集開始指紋を保持しています。資格情報やPOS内部状態は保存していません。</p> : null}
                <p className="break-all text-xs text-gray-600">操作ID: <span className="tabular-nums">{state.recovery.operationId}</span></p>
                {state.recoveryCheck ? <p role="status" className="text-pretty text-sm text-gray-700">{state.recoveryCheck.message}</p> : null}
                {state.storageIdentityAmbiguous ? <p className="text-sm text-amber-900">元の操作IDとの一致を確認できないため、状態が終了済みでも復旧情報は解除しません。管理者に確認してください。</p> : null}
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => void recover()} disabled={pending !== null} className={BUTTON_CLASS}>{pending === 'recover' ? '保存状態を確認中...' : '保存状態を確認（読取りのみ）'}</button>
                  {continuationAllowed && state.execution ? (
                    <button type="button" disabled={pending !== null} onClick={() => setConfirmation('continue')} className={BUTTON_CLASS}>{state.execution.nextAction === 'verify' ? 'POSの結果を照合する' : state.execution.nextAction === 'apply_db' ? '確認済みPOS値をDBへ反映' : '同じ操作で保存を続ける'}</button>
                  ) : null}
                  {prepareRetryAllowed ? <button type="button" onClick={() => void retryPrepare()} disabled={pending !== null} className={BUTTON_CLASS}>{pending === 'prepare' ? '同じ入力の保存準備中...' : '同じ入力で保存準備だけ再試行'}</button> : null}
                  <button type="button" onClick={() => void inspectRecovery()} disabled={pending !== null} className={BUTTON_CLASS}>{pending === 'inspect' ? '取消・解除条件を確認中...' : '取消・解除条件を確認（読取りのみ）'}</button>
                  {state.recoveryCheck?.canCancel && !state.storageIdentityAmbiguous ? <button type="button" onClick={() => setConfirmation('cancel')} disabled={pending !== null} className={BUTTON_CLASS}>未送信の操作を取り消す...</button> : null}
                </div>
                {!savingEnabled && state.execution?.nextAction === 'save' ? <p className="text-sm text-gray-600">新しいPOS送信は停止中です。同じ操作の保存状況は読取り確認できます。</p> : null}
                {prepareRetryAllowed ? <p className="text-pretty text-sm text-gray-600">再試行は保存準備のみです。成功しても自動保存しません。期限切れ・基準値競合が続く場合は、取消条件を確認してください。</p> : null}
              </section>
            ) : null}
            {state.refreshed ? (
              <section className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="再取得したPOS値">
                <h3 className="text-balance font-bold">再取得したPOS値</h3>
                <p className="text-pretty text-sm text-gray-700">入力は保持しています。最新のPOS値を確認し、続け方を選択してください。</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(FIELD_LABELS) as (keyof PosProductFields)[]).map(field => <div key={field}><dt className="text-xs text-gray-500">{FIELD_LABELS[field]}</dt><dd className="mt-1 break-words text-sm tabular-nums">{displayField(state.refreshed!, field)}</dd></div>)}
                </dl>
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={editDisabled} className={BUTTON_CLASS} onClick={() => dispatch({ type: 'keep-input' })}>入力を保持して最新値を基準にする</button>
                  <button type="button" disabled={editDisabled} className={BUTTON_CLASS} onClick={() => setConfirmation('replace')}>最新のPOS値で入力を置き換える</button>
                </div>
              </section>
            ) : null}
            {baseline && draft ? (
              <form onSubmit={event => { event.preventDefault(); void review() }} className="space-y-5">
                <fieldset disabled={editDisabled || state.refreshed !== null} className="grid gap-4 sm:grid-cols-2">
                  <legend className="mb-3 font-semibold">編集内容</legend>
                  <label className="space-y-2 sm:col-span-2"><span className="text-sm font-medium">商品名</span><input required maxLength={200} value={draft.name} onChange={event => dispatch({ type: 'changed', field: 'name', value: event.target.value })} className={INPUT_CLASS} /></label>
                  <label className="space-y-2"><span className="text-sm font-medium">商品グループ</span><select required value={draft.groupId} onChange={event => dispatch({ type: 'changed', field: 'groupId', value: event.target.value })} className={INPUT_CLASS}>
                    {!baseline.groups.some(choice => choice.id === draft.groupId) ? <option value={draft.groupId}>現在の入力（最新候補から選び直してください）</option> : null}
                    {baseline.groups.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                  </select></label>
                  <label className="space-y-2"><span className="text-sm font-medium">仕入先</span><select value={draft.supplierId ?? ''} onChange={event => dispatch({ type: 'changed', field: 'supplierId', value: event.target.value })} className={INPUT_CLASS}>
                    <option value="">未設定</option>
                    {draft.supplierId && !baseline.suppliers.some(choice => choice.id === draft.supplierId) ? <option value={draft.supplierId}>現在の入力（最新候補から選び直してください）</option> : null}
                    {baseline.suppliers.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                  </select></label>
                  <label className="space-y-2"><span className="text-sm font-medium">商品金額（円）</span><input required type="number" inputMode="numeric" min="0" max="999999999" step="1" value={draft.price} onChange={event => dispatch({ type: 'changed', field: 'price', value: event.target.value })} className={cn(INPUT_CLASS, 'tabular-nums')} /></label>
                  <label className="space-y-2"><span className="text-sm font-medium">商品原価（円）</span><input required type="number" inputMode="numeric" min="0" max="999999999" step="1" value={draft.cost} onChange={event => dispatch({ type: 'changed', field: 'cost', value: event.target.value })} className={cn(INPUT_CLASS, 'tabular-nums')} /></label>
                </fieldset>
                <div className="flex justify-end"><button type="submit" disabled={editDisabled || state.refreshed !== null || !dirty} className={BUTTON_CLASS}>{pending === 'review' ? '変更内容を確認中...' : '変更内容を確認'}</button></div>
              </form>
            ) : null}
            {!baseline && state.frozenCommand ? <section aria-label="固定した保存準備入力" className="space-y-3 rounded-2xl border border-gray-200 p-4"><h3 className="font-bold">固定した保存準備入力（変更不可）</h3><dl className="grid gap-3 sm:grid-cols-2">{(Object.keys(FIELD_LABELS) as (keyof PosProductFields)[]).map(field => <div key={field}><dt className="text-xs text-gray-500">{FIELD_LABELS[field]}</dt><dd className="mt-1 break-words text-sm tabular-nums">{state.frozenCommand!.fields[field] ?? '未設定'}</dd></div>)}</dl></section> : null}
            {state.review ? (
              <section aria-live="polite" className="space-y-3 rounded-2xl border border-gray-200 p-4">
                <h3 className="text-balance font-bold">{locked ? '今回の保存操作に固定した変更内容' : '確認した変更内容（未保存）'}</h3>
                <p className="text-pretty text-sm text-gray-600">{locked ? 'この入力と操作IDは固定されています。現在の保存結果は上の状態表示を確認してください。' : 'POSの現在値と照合しました。入力を変更すると、この確認結果は無効になります。'}</p>
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th scope="col" className="px-2 py-2">項目</th><th scope="col" className="px-2 py-2">変更前</th><th scope="col" className="px-2 py-2">変更後</th></tr></thead><tbody>{state.review.changes.map(change => <tr key={change.field} className="border-t border-gray-200"><th scope="row" className="px-2 py-3 font-medium">{change.label}</th><td className="break-words px-2 py-3 tabular-nums">{change.before ?? '未設定'}</td><td className="break-words px-2 py-3 tabular-nums">{change.after ?? '未設定'}</td></tr>)}</tbody></table></div>
                {savingEnabled && !locked ? <div className="flex justify-end"><button type="button" disabled={editDisabled || state.refreshed !== null || !dirty} onClick={() => setConfirmation('save')} className={BUTTON_CLASS}>POSへ保存...</button></div> : null}
              </section>
            ) : null}
            <footer className="flex justify-end border-t border-gray-200 pt-5"><button type="button" disabled={pending !== null} onClick={requestClose} className={BUTTON_CLASS}>閉じる</button></footer>
          </div>
        </>
      )}
    </dialog>
  )
}

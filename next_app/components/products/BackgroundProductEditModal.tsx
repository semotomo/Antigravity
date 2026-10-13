'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/components/ui/StatusBadge'
import { getProductStoreName } from '@/lib/productStores'
import type { ProductListRow } from '@/lib/products'
import { parseBackgroundEditRequest, parseBackgroundProductPatch, parseBackgroundPosChoiceBaseline } from '@/lib/pos-products/background-edit'
import type { BackgroundExpectedValues, BackgroundProductPatch, BackgroundPosChoiceBaseline, ProductEditIntakeData } from '@/lib/pos-products/background-edit'
import { decodeBackgroundClassificationSnapshot } from '@/lib/pos-products/classification'
import type { BackgroundClassificationSnapshot } from '@/lib/pos-products/classification'
import { BackgroundEditFailure, backgroundEditFailureCode, parseBackgroundEditFailureCode } from '@/lib/pos-products/background-failure'
import type { BackgroundEditFailureCode } from '@/lib/pos-products/background-failure'

type Draft = { name: string; price: string; cost: string }
type Patch = BackgroundProductPatch
type ExpectedValues = BackgroundExpectedValues
type Target = { storeId: 6 | 7; productId: number; janCode: string }
type Intent = Target & { version: 1; operationId: string; patch: Patch; expectedValues: ExpectedValues; catalogSnapshotId?: string; posChoiceBaseline?: BackgroundPosChoiceBaseline }
type ClassificationDraft = { groupId: string; supplierId: string | null }
type ClassificationEdited = Partial<Record<keyof ClassificationDraft, boolean>>
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fields = ['name', 'price', 'cost'] as const
const patchFields = [...fields, 'groupId', 'supplierId'] as const
const labels = { name: '商品名', price: '売価', cost: '原価' }
const inputClass = 'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20 disabled:bg-gray-100'
const buttonClass = 'rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-50'

export function backgroundEditStorageKey(target: Pick<Target, 'storeId' | 'productId'>) {
  return `kennel-pos-background-edit:v1:${target.storeId}:${target.productId}`
}

export function backgroundProductEditPatch(draft: Draft, edited: Partial<Record<keyof Draft, boolean>>): Patch {
  const patch: Patch = {}
  for (const field of fields) {
    if (!edited[field]) continue
    const value = draft[field].trim()
    if (field === 'name' ? !value || value.length > 200 || /[\x00-\x1f\x7f]/.test(value) : !/^\d{1,9}$/.test(value)) {
      throw new BackgroundEditFailure('BG_EDIT_INPUT')
    }
    patch[field] = field === 'name' ? value : String(Number(value))
  }
  if (!Object.keys(patch).length) throw new BackgroundEditFailure('BG_EDIT_INPUT')
  return patch
}

export function backgroundProductEditExpectedValues(product: Pick<ProductListRow, 'product_name' | 'selling_price' | 'cost_price'>, patch: Patch): ExpectedValues {
  const money = (value: number | null) => Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : null
  const original = { name: product.product_name ?? null, price: money(product.selling_price), cost: money(product.cost_price) }
  return Object.fromEntries(fields.filter(field => Object.hasOwn(patch, field)).map(field => [field, original[field]]))
}

function intentPayload(intent: Pick<Intent, 'operationId' | 'storeId' | 'productId' | 'patch' | 'expectedValues' | 'catalogSnapshotId'>) {
  const { operationId, storeId, productId, patch, expectedValues, catalogSnapshotId } = intent
  return { operationId, storeId, productId, patch, expectedValues, ...(catalogSnapshotId !== undefined ? { catalogSnapshotId } : {}) }
}

export function backgroundProductClassificationPatch(snapshot: BackgroundClassificationSnapshot | null, draft: ClassificationDraft | null,
  edited: ClassificationEdited, target: Target): { patch: Patch; expectedValues: ExpectedValues; catalogSnapshotId?: string; posChoiceBaseline?: BackgroundPosChoiceBaseline } {
  const patch: Patch = {}, expectedValues: ExpectedValues = {}
  if (!edited.groupId && !edited.supplierId) return { patch, expectedValues }
  if (!snapshot || !draft) throw new BackgroundEditFailure('BG_EDIT_INPUT')
  if (edited.groupId && draft.groupId !== snapshot.currentGroupId) { patch.groupId = draft.groupId; expectedValues.groupId = snapshot.currentGroupId }
  if (edited.supplierId && draft.supplierId !== snapshot.currentSupplierId) { patch.supplierId = draft.supplierId; expectedValues.supplierId = snapshot.currentSupplierId }
  if (!Object.keys(patch).length) return { patch, expectedValues }
  try {
    const verified = decodeBackgroundClassificationSnapshot(snapshot, target)
    const group = verified.groups.find(group => group.id === draft.groupId)
    const supplier = draft.supplierId === null ? null : verified.suppliers.find(supplier => supplier.id === draft.supplierId)
    if (!group || supplier === undefined) throw new BackgroundEditFailure('BG_EDIT_INPUT')
    const baseline = { groupId: verified.currentGroupId, groupName: verified.groups.find(group => group.id === verified.currentGroupId)!.name,
      supplierId: verified.currentSupplierId, supplierName: verified.suppliers.find(supplier => supplier.id === verified.currentSupplierId)?.name ?? null,
      requested: { ...(Object.hasOwn(patch, 'groupId') ? { groupId: { ...group } } : {}),
        ...(Object.hasOwn(patch, 'supplierId') ? { supplierId: supplier === null ? null : { ...supplier } } : {}) } }
    return { patch, expectedValues, catalogSnapshotId: verified.snapshotId, posChoiceBaseline: parseBackgroundPosChoiceBaseline(baseline, patch) }
  } catch { throw new BackgroundEditFailure('BG_EDIT_INPUT') }
}

export function readBackgroundEditIntent(storage: StoragePort, target: Target): Intent | null {
  try {
    const raw = storage.getItem(backgroundEditStorageKey(target))
    if (raw === null) return null
    if (raw.length > 16384) throw new BackgroundEditFailure('BG_EDIT_STORAGE')
    const value = JSON.parse(raw) as Intent
    if (!value || value.version !== 1 || value.storeId !== target.storeId || value.productId !== target.productId ||
        value.janCode !== target.janCode || typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
        !value.patch || typeof value.patch !== 'object' || Array.isArray(value.patch)) throw new BackgroundEditFailure('BG_EDIT_STORAGE')
    const request = parseBackgroundEditRequest(intentPayload(value))
    const baseline = value.posChoiceBaseline === undefined ? undefined : parseBackgroundPosChoiceBaseline(value.posChoiceBaseline, request.patch)
    if (baseline && !request.catalogSnapshotId) throw new BackgroundEditFailure('BG_EDIT_STORAGE')
    return { ...request, version: 1, janCode: value.janCode, ...(baseline ? { posChoiceBaseline: baseline } : {}) }
  } catch { throw new BackgroundEditFailure('BG_EDIT_STORAGE') }
}

export function isBackgroundEditIntake(value: unknown, target?: Target, operationId?: string): value is ProductEditIntakeData {
  if (!value || typeof value !== 'object') return false
  const data = value as ProductEditIntakeData
  try {
    parseBackgroundProductPatch(data.patch)
    if (Object.hasOwn(data.patch, 'groupId') || Object.hasOwn(data.patch, 'supplierId')) {
      if (typeof data.catalogSnapshotId !== 'string' || !UUID.test(data.catalogSnapshotId)) return false
      parseBackgroundPosChoiceBaseline(data.posChoiceBaseline, data.patch)
    } else if (data.catalogSnapshotId !== undefined || data.posChoiceBaseline !== undefined) return false
  } catch { return false }
  return typeof data.operationId === 'string' && UUID.test(data.operationId) && [6, 7].includes(data.storeId) &&
    Number.isSafeInteger(data.productId) && data.productId > 0 && typeof data.janCode === 'string' &&
    ['queued', 'working', 'needs_review', 'completed', 'cancelled'].includes(data.status) &&
    typeof data.message === 'string' && typeof data.createdAt === 'string' && typeof data.updatedAt === 'string' &&
    !!data.patch && typeof data.patch === 'object' && !Array.isArray(data.patch) &&
    (!target || data.storeId === target.storeId && data.productId === target.productId && data.janCode === target.janCode) &&
    (!operationId || data.operationId === operationId)
}

function matchesBackgroundIntent(data: ProductEditIntakeData, intent: Pick<Intent, 'patch' | 'expectedValues' | 'catalogSnapshotId' | 'posChoiceBaseline'>) {
  return patchFields.every(field => data.patch[field] === intent.patch[field]) &&
    (intent.catalogSnapshotId === undefined || data.catalogSnapshotId === intent.catalogSnapshotId) &&
    (!Object.hasOwn(intent.patch, 'groupId') || data.posChoiceBaseline?.groupId === intent.expectedValues.groupId) &&
    (!Object.hasOwn(intent.patch, 'supplierId') || data.posChoiceBaseline?.supplierId === intent.expectedValues.supplierId) &&
    (!intent.posChoiceBaseline || JSON.stringify(parseBackgroundPosChoiceBaseline(data.posChoiceBaseline, data.patch)) === JSON.stringify(intent.posChoiceBaseline))
}

async function backgroundEditRequest(fetcher: typeof fetch, url: string, options: RequestInit,
  requestCode: BackgroundEditFailureCode, responseCode: BackgroundEditFailureCode, timeoutMs = 20_000): Promise<{ data: unknown }> {
  const controller = new AbortController()
  let stageCode = requestCode
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectDeadline: (reason: BackgroundEditFailure) => void = () => {}
  const abort = () => { rejectDeadline(new BackgroundEditFailure(stageCode)); controller.abort() }
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject
    timer = setTimeout(abort, timeoutMs)
  })
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  try {
    return await Promise.race([deadline, (async () => {
      let response: Response
      try { response = await fetcher(url, { ...options, signal: controller.signal }) } catch { throw new BackgroundEditFailure(requestCode) }
      stageCode = responseCode
      let body: unknown
      try { body = await response.json() } catch { throw new BackgroundEditFailure(responseCode) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BackgroundEditFailure(responseCode)
      const result = body as { success?: unknown; diagnosticCode?: unknown; data?: unknown }
      if (!response.ok || result.success !== true) {
        // サーバー本文や未知コードは表示せず、許可済みの固定コードだけを引き継ぐ。
        throw new BackgroundEditFailure(parseBackgroundEditFailureCode(result.diagnosticCode) ?? responseCode)
      }
      return { data: result.data }
    })()])
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}

export async function loadBackgroundProductClassification(options: {
  target: Target; refresh?: boolean; fetcher: typeof fetch; signal?: AbortSignal
}): Promise<BackgroundClassificationSnapshot | null> {
  const { target, refresh } = options
  const params = new URLSearchParams({ storeId: String(target.storeId), productId: String(target.productId) })
  const body = await backgroundEditRequest(options.fetcher,
    `/api/pos-products/background-classification${refresh ? '' : `?${params}`}`,
    refresh ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: options.signal,
      body: JSON.stringify({ storeId: target.storeId, productId: target.productId }) }
      : { method: 'GET', cache: 'no-store', signal: options.signal },
    'BG_EDIT_CHECK_REQUEST', 'BG_EDIT_CHECK_RESPONSE', refresh ? 90_000 : 20_000)
  if (body.data === null) return null
  try { return decodeBackgroundClassificationSnapshot(body.data, target) }
  catch { throw new BackgroundEditFailure('BG_EDIT_CHECK_RESPONSE') }
}

class UnacceptedBackgroundEditFailure extends BackgroundEditFailure {
  constructor() { super('BG_EDIT_NO_INTAKE') }
}

export async function acceptBackgroundProductEdit(options: {
  target: Target; patch: Patch; expectedValues: ExpectedValues; storage: StoragePort; fetcher: typeof fetch; createId: () => string
  lock: { current: boolean }; onAccepted: (data: ProductEditIntakeData) => void; onClose: () => void
  retryUnaccepted?: boolean
  requestTimeoutMs?: number
  catalogSnapshotId?: string; posChoiceBaseline?: BackgroundPosChoiceBaseline
}) {
  // Reactの再描画より前にロックし、同時クリックを一度の受付に限定する。
  if (options.lock.current) return
  options.lock.current = true
  try {
    let intent = readBackgroundEditIntent(options.storage, options.target)
    let data: ProductEditIntakeData | null = null
    if (intent) {
      const params = new URLSearchParams({ store: String(intent.storeId), operationId: intent.operationId })
      const body = await backgroundEditRequest(options.fetcher, `/api/pos-products/background-edit?${params}`, { method: 'GET', cache: 'no-store' },
        'BG_EDIT_CHECK_REQUEST', 'BG_EDIT_CHECK_RESPONSE', options.requestTimeoutMs)
      const received = body.data
      if (received === null) {
        // 読取りだけの確認からPOSTへ進めない。別の明示操作でも同一IDを再照会する。
        if (!options.retryUnaccepted) throw new UnacceptedBackgroundEditFailure()
      } else {
        if (!isBackgroundEditIntake(received, options.target, intent.operationId) ||
            !matchesBackgroundIntent(received, intent)) throw new BackgroundEditFailure('BG_EDIT_CHECK_RESPONSE')
        data = received
      }
    } else {
      if (options.retryUnaccepted) throw new BackgroundEditFailure('BG_EDIT_INPUT')
      try {
        const patch = { ...options.patch }
        if (fields.some(field => Object.hasOwn(patch, field))) Object.assign(patch,
          backgroundProductEditPatch({ name: '', price: '', cost: '', ...patch }, Object.fromEntries(fields.filter(field => Object.hasOwn(patch, field)).map(field => [field, true]))))
        const request = parseBackgroundEditRequest(intentPayload({ ...options.target, operationId: options.createId(), patch,
          expectedValues: options.expectedValues, catalogSnapshotId: options.catalogSnapshotId }))
        const baseline = options.posChoiceBaseline === undefined ? undefined : parseBackgroundPosChoiceBaseline(options.posChoiceBaseline, request.patch)
        if (baseline && (!request.catalogSnapshotId || Object.hasOwn(patch, 'groupId') && baseline.groupId !== request.expectedValues.groupId ||
            Object.hasOwn(patch, 'supplierId') && baseline.supplierId !== request.expectedValues.supplierId)) throw new BackgroundEditFailure('BG_EDIT_INPUT')
        intent = { ...request, janCode: options.target.janCode, version: 1, ...(baseline ? { posChoiceBaseline: baseline } : {}) }
      } catch { throw new BackgroundEditFailure('BG_EDIT_INPUT') }
      // 通信開始前に操作IDと入力を保全する。失敗時はPOS/受付POSTへ進まない。
      try { options.storage.setItem(backgroundEditStorageKey(options.target), JSON.stringify(intent)) } catch { throw new BackgroundEditFailure('BG_EDIT_STORAGE') }
    }
    if (!data) {
      const { operationId } = intent
      const body = await backgroundEditRequest(options.fetcher, '/api/pos-products/background-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intentPayload(intent)),
      }, 'BG_EDIT_ACCEPT_REQUEST', 'BG_EDIT_ACCEPT_RESPONSE', options.requestTimeoutMs)
      const received = body.data
      if (!isBackgroundEditIntake(received, options.target, operationId) ||
          !matchesBackgroundIntent(received, intent)) {
        throw new BackgroundEditFailure('BG_EDIT_ACCEPT_RESPONSE')
      }
      data = received
    }
    if (!data) throw new BackgroundEditFailure('BG_EDIT_ACCEPT_RESPONSE')
    options.onAccepted(data)
    // 受付確認後だけ保全情報を解除する。解除不能でもサーバーの同一ID確認を維持する。
    try { options.storage.removeItem(backgroundEditStorageKey(options.target)) } catch {}
    options.onClose()
  } finally { options.lock.current = false }
}

export async function controlBackgroundProductEdit(options: {
  target: Target; operation: ProductEditIntakeData; action: 'cancel' | 'resume'; fetcher: typeof fetch
  lock: { current: boolean }; onAccepted: (data: ProductEditIntakeData) => void; onClose: () => void
  requestTimeoutMs?: number
}) {
  if (options.lock.current) return
  options.lock.current = true
  try {
    const { operation, action } = options
    if (!isBackgroundEditIntake(operation, options.target) ||
        (action === 'resume' ? operation.status !== 'needs_review' : !['queued', 'needs_review'].includes(operation.status))) {
      throw new Error('この操作の状態を確認できません。')
    }
    const body = await backgroundEditRequest(options.fetcher, '/api/pos-products/background-edit/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: operation.storeId, operationId: operation.operationId, action }),
    }, 'BG_EDIT_ACCEPT_REQUEST', 'BG_EDIT_ACCEPT_RESPONSE', options.requestTimeoutMs)
    const received = body.data
    if (!isBackgroundEditIntake(received, options.target, operation.operationId) ||
        patchFields.some(field => received.patch[field] !== operation.patch[field]) || received.catalogSnapshotId !== operation.catalogSnapshotId) throw new BackgroundEditFailure('BG_EDIT_ACCEPT_RESPONSE')
    options.onAccepted(received)
    options.onClose()
  } finally { options.lock.current = false }
}

export async function abandonBackgroundEditIntent(options: {
  target: Target; storage: StoragePort; fetcher: typeof fetch; lock: { current: boolean }; onAbandoned: () => void; onClose: () => void
  requestTimeoutMs?: number
}) {
  if (options.lock.current) return
  options.lock.current = true
  try {
    const intent = readBackgroundEditIntent(options.storage, options.target)
    if (!intent) throw new Error('受付情報を確認できません。')
    const { operationId, storeId, productId } = intent
    const body = await backgroundEditRequest(options.fetcher, '/api/pos-products/background-edit/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId, storeId, productId, action: 'abandon' }) }, 'BG_EDIT_ACCEPT_REQUEST', 'BG_EDIT_ACCEPT_RESPONSE', options.requestTimeoutMs)
    const receipt = body.data as { operationId?: unknown; storeId?: unknown; productId?: unknown; abandoned?: unknown } | null
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.keys(receipt).length !== 4 ||
        receipt.operationId !== operationId || receipt.storeId !== storeId || receipt.productId !== productId || receipt.abandoned !== true) {
      throw new Error('未受付の取消を確認できません。入力は保持しています。')
    }
    // GETの不存在だけでは解除しない。遅延受付を拒否するDB証跡の確認後だけ消す。
    options.storage.removeItem(backgroundEditStorageKey(options.target))
    options.onAbandoned()
    options.onClose()
  } finally { options.lock.current = false }
}

type Props = {
  product: ProductListRow; storeId: 6 | 7; existingOperation?: ProductEditIntakeData | null
  backgroundClassificationEnabled?: boolean
  onAccepted: (data: ProductEditIntakeData) => void; onClose: () => void; onAdvanced?: () => void; onAbandoned?: () => void
}

function backgroundEditFailureMessage(code: BackgroundEditFailureCode, confirmedUnaccepted = false) {
  const message = code === 'BG_EDIT_INPUT' ? '商品名は200文字以内、売価・原価は0以上の整数で入力してください。分類・仕入先は取得した有効な候補から選択してください。'
    : code === 'BG_EDIT_STORAGE' ? 'この端末の受付情報を保全・確認できません。入力を保持しています。'
      : confirmedUnaccepted ? 'まだ受付されていません。希望値と同じ操作IDを保持しています。再受付する場合は「同じ内容で再受付」を押してください。'
        : '保存受付を確認できません。入力と同じ操作IDを保持しています。「受付状態を確認」で再確認してください。'
  return `${message}（診断コード: ${code}）`
}

export function BackgroundProductEditModal({ product, storeId, existingOperation, backgroundClassificationEnabled = false, onAccepted, onClose, onAdvanced, onAbandoned }: Props) {
  const money = (value: number | null) => Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : ''
  const [draft, setDraft] = useState<Draft>(() => ({ name: product.product_name ?? '', price: money(product.selling_price), cost: money(product.cost_price), ...existingOperation?.patch }))
  const [edited, setEdited] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [ready, setReady] = useState(false)
  const [stored, setStored] = useState(false)
  const [storedOperationId, setStoredOperationId] = useState<string | null>(null)
  const [unaccepted, setUnaccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [classificationOpen, setClassificationOpen] = useState(false)
  const [classificationSnapshot, setClassificationSnapshot] = useState<BackgroundClassificationSnapshot | null>(null)
  const [classificationDraft, setClassificationDraft] = useState<ClassificationDraft | null>(null)
  const [classificationEdited, setClassificationEdited] = useState<ClassificationEdited>({})
  const [classificationPending, setClassificationPending] = useState(false)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [storedBaseline, setStoredBaseline] = useState<BackgroundPosChoiceBaseline | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const classificationLock = useRef(false)
  const classificationEdits = useRef<ClassificationEdited>({})
  const classificationController = useRef<AbortController | null>(null)
  const titleId = useId(), descriptionId = useId()
  const active = existingOperation && ['queued', 'working', 'needs_review'].includes(existingOperation.status)
  // 状況取得がモーダル表示より遅れても、サーバーに保持した希望値を表示する。
  const displayed = active ? { ...draft, ...existingOperation.patch } : draft
  const heldBaseline = active ? existingOperation.posChoiceBaseline : stored ? storedBaseline : null
  const classificationChanged = !!classificationSnapshot && !!classificationDraft &&
    (classificationEdited.groupId && classificationDraft.groupId !== classificationSnapshot.currentGroupId ||
      classificationEdited.supplierId && classificationDraft.supplierId !== classificationSnapshot.currentSupplierId)
  const choicesFresh = !!classificationSnapshot && classificationSnapshot.expiresAt > Date.now()

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
    try {
      const intent = readBackgroundEditIntent(window.sessionStorage, { productId: product.id, storeId, janCode: product.jan_code ?? '' })
      if (intent) { setDraft(value => ({ ...value, ...intent.patch })); setStored(true); setStoredOperationId(intent.operationId); setStoredBaseline(intent.posChoiceBaseline ?? null) }
      setReady(true)
    } catch { setError(`${backgroundEditFailureMessage('BG_EDIT_STORAGE')}受付状態の確認を開始できないため、操作を停止しています。`) }
    return () => { classificationController.current?.abort(); if (node?.open) node.close() }
  }, [product.id, product.jan_code, storeId])

  function requestClose() {
    if (lock.current) return
    if (!active && !stored && (Object.keys(edited).length || classificationChanged)) setConfirmClose(true)
    else onClose()
  }

  async function save(retryUnaccepted = false) {
    if (!ready || active || lock.current) return
    if (retryUnaccepted && (!stored || !unaccepted)) return
    if (!product.jan_code) { setError(backgroundEditFailureMessage('BG_EDIT_INPUT')); return }
    setError(null); setUnaccepted(false)
    try {
      const target = { productId: product.id, storeId, janCode: product.jan_code }
      const normalPatch = stored || !Object.keys(edited).length ? {} : backgroundProductEditPatch(draft, edited)
      const classification = stored || !backgroundClassificationEnabled ? { patch: {}, expectedValues: {} }
        : backgroundProductClassificationPatch(classificationSnapshot, classificationDraft, classificationEdited, target)
      const patch = { ...normalPatch, ...classification.patch }
      setPending(true)
      await acceptBackgroundProductEdit({ ...classification, target, patch,
        expectedValues: { ...backgroundProductEditExpectedValues(product, normalPatch), ...classification.expectedValues },
        storage: window.sessionStorage, fetcher: fetch, createId: () => window.crypto.randomUUID(), lock, onAccepted, onClose, retryUnaccepted })
    } catch (failure) {
      try {
        const intent = readBackgroundEditIntent(window.sessionStorage, { productId: product.id, storeId, janCode: product.jan_code ?? '' })
        setStored(intent !== null); setStoredOperationId(intent?.operationId ?? null)
        if (intent) { setDraft(value => ({ ...value, ...intent.patch })); setStoredBaseline(intent.posChoiceBaseline ?? null) }
      } catch { setStored(true) }
      const code = backgroundEditFailureCode(failure, 'BG_EDIT_INPUT')
      // 失敗応答のコードだけでは許可しない。成功したGETの不存在確認だけを根拠にする。
      const confirmedUnaccepted = failure instanceof UnacceptedBackgroundEditFailure
      setUnaccepted(confirmedUnaccepted)
      setError(backgroundEditFailureMessage(code, confirmedUnaccepted))
    } finally { setPending(false) }
  }

  async function loadClassification(refresh = false) {
    if (!backgroundClassificationEnabled || !ready || active || stored || classificationLock.current || !product.jan_code) return
    classificationLock.current = true
    const controller = new AbortController()
    classificationController.current = controller
    setClassificationOpen(true); setClassificationPending(true); setClassificationError(null)
    try {
      const options = { target: { storeId, productId: product.id, janCode: product.jan_code }, fetcher: fetch, signal: controller.signal }
      let snapshot = await loadBackgroundProductClassification({ ...options, refresh })
      // 初回のcache不存在だけを一度取得する。失敗・不正応答は自動再試行しない。
      if (!snapshot && !refresh) snapshot = await loadBackgroundProductClassification({ ...options, refresh: true })
      if (!snapshot) throw new BackgroundEditFailure('BG_EDIT_CHECK_RESPONSE')
      if (controller.signal.aborted) return
      const verified = snapshot
      setClassificationSnapshot(verified)
      // 通常入力と、編集中の選択は非同期の取得結果で上書きしない。
      setClassificationDraft(previous => ({
        groupId: previous && classificationEdits.current.groupId ? previous.groupId : verified.currentGroupId,
        supplierId: previous && classificationEdits.current.supplierId ? previous.supplierId : verified.currentSupplierId,
      }))
    } catch (failure) {
      if (!controller.signal.aborted) setClassificationError(`分類・仕入先の候補を取得できません。入力は保持しています。商品名・売価・原価は編集・保存できます。（診断コード: ${backgroundEditFailureCode(failure, 'BG_EDIT_CHECK_RESPONSE')}）`)
    } finally {
      classificationLock.current = false
      if (!controller.signal.aborted) setClassificationPending(false)
    }
  }

  function changeClassification(field: keyof ClassificationDraft, value: string) {
    classificationEdits.current = { ...classificationEdits.current, [field]: true }
    setClassificationEdited(classificationEdits.current)
    setClassificationDraft(previous => previous ? { ...previous, [field]: field === 'supplierId' && value === '' ? null : value } : previous)
    setError(null)
  }

  async function control(action: 'cancel' | 'resume') {
    if (!existingOperation || !active || lock.current || !product.jan_code) return
    setPending(true); setError(null)
    try {
      await controlBackgroundProductEdit({ target: { productId: product.id, storeId, janCode: product.jan_code },
        operation: existingOperation, action, fetcher: fetch, lock, onAccepted, onClose })
    } catch { setError('操作を受け付けられませんでした。希望値と同じ操作IDを保持しています。再保存せず、状態を確認してください。') }
    finally { setPending(false) }
  }
  async function abandon() {
    if (!ready || active || !stored || lock.current || !product.jan_code) return
    setPending(true); setError(null)
    try {
      await abandonBackgroundEditIntent({ target: { productId: product.id, storeId, janCode: product.jan_code }, storage: window.sessionStorage,
        fetcher: fetch, lock, onAbandoned: () => onAbandoned?.(), onClose })
    } catch { setError('未受付の取消を確認できません。既に受付済みの場合は「受付状態を確認」で同じ操作を確認してください。入力は保持しています。') }
    finally { setPending(false) }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    className="m-auto w-full max-w-lg overflow-y-auto rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/60"
    style={{ width: 'calc(100% - 2rem)', maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)' }}
    onCancel={event => { event.preventDefault(); requestClose() }}>
    <form className="space-y-5 p-5 sm:p-6" onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 id={titleId} className="text-balance text-xl font-bold">{confirmClose ? '入力を保存せず閉じますか？' : '商品を編集'}</h2>
      <p id={descriptionId} className="text-pretty text-sm text-gray-600">{getProductStoreName(storeId)} · <span className="tabular-nums">{product.jan_code}</span></p>
      {confirmClose ? <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonClass} onClick={() => setConfirmClose(false)}>編集を続ける</button>
        <button type="button" className={buttonClass} onClick={onClose}>閉じる</button>
      </div> : <>
        {active ? <div role="status" className="text-pretty rounded-xl bg-sky-50 p-3 text-sm text-sky-900"><p>
          {existingOperation.status === 'needs_review' ? '要確認' : '反映待ち'}：{existingOperation.message}
        </p><p className="mt-2">新しい保存は行いません。以下の操作は同じ受付IDの状態をサーバーで確認します。</p>
          <p className="mt-2 text-xs">操作ID: <span className="break-all font-mono">{existingOperation.operationId}</span></p>
        </div> : null}
        {fields.map(field => <label key={field} className="block space-y-2">
          <span className="text-sm font-medium">{labels[field]}</span>
          <input value={displayed[field]} disabled={!ready || pending || stored || !!active} inputMode={field === 'name' ? 'text' : 'numeric'}
            maxLength={field === 'name' ? 200 : 9} className={cn(inputClass, field !== 'name' && 'tabular-nums')}
            onChange={event => { setDraft(value => ({ ...value, [field]: event.target.value })); setEdited(value => ({ ...value, [field]: true })); setError(null) }} />
        </label>)}
        {heldBaseline ? <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
          {heldBaseline.requested.groupId ? <p>商品グループ：<span>{heldBaseline.requested.groupId.name}</span></p> : null}
          {Object.hasOwn(heldBaseline.requested, 'supplierId') ? <p>仕入先：<span>{heldBaseline.requested.supplierId?.name ?? '未設定'}</span></p> : null}
        </div> : classificationOpen && !active && !stored ? <section aria-label="分類・仕入先" className="space-y-4 rounded-xl border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">分類・仕入先</h3>
            <button type="button" className={buttonClass} disabled={!ready || pending || classificationPending}
              onClick={() => void loadClassification(true)}>候補を再取得</button>
          </div>
          {classificationPending ? <p role="status" className="text-sm text-gray-600">候補を取得しています。商品名・売価・原価は編集・保存できます。</p> : null}
          {classificationError ? <p role="alert" className="text-pretty text-sm text-red-700">{classificationError}</p> : null}
          {classificationSnapshot && !choicesFresh ? <p role="status" className="text-sm text-gray-600">候補の有効期限が切れています。入力は保持しています。候補を再取得してください。</p> : null}
          <label className="block space-y-2"><span className="text-sm font-medium">商品グループ</span>
            <select value={classificationDraft?.groupId ?? ''} disabled={!choicesFresh || pending} className={inputClass}
              onChange={event => changeClassification('groupId', event.target.value)}>
              {!classificationSnapshot ? <option value="">候補を取得すると選択できます</option>
                : classificationDraft && !classificationSnapshot.groups.some(group => group.id === classificationDraft.groupId)
                  ? <option value={classificationDraft.groupId}>保持した希望値（候補から選び直してください）</option> : null}
              {classificationSnapshot?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="block space-y-2"><span className="text-sm font-medium">仕入先</span>
            <select value={classificationDraft?.supplierId ?? ''} disabled={!choicesFresh || pending} className={inputClass}
              onChange={event => changeClassification('supplierId', event.target.value)}>
              <option value="">{classificationSnapshot ? '未設定' : '候補を取得すると選択できます'}</option>
              {classificationDraft?.supplierId && classificationSnapshot && !classificationSnapshot.suppliers.some(supplier => supplier.id === classificationDraft.supplierId)
                ? <option value={classificationDraft.supplierId}>保持した希望値（候補から選び直してください）</option> : null}
              {classificationSnapshot?.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
        </section> : null}
        {error ? <p role="alert" className="text-pretty text-sm text-red-700">{error}</p> : null}
        {stored && !active && storedOperationId ? <p className="text-xs text-gray-600">操作ID: <span className="break-all font-mono">{storedOperationId}</span></p> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {stored && !active && unaccepted ? <button type="button" className={buttonClass} disabled={!ready || pending}
            onClick={() => void save(true)}>同じ内容で再受付</button> : null}
          {stored && !active ? <button type="button" className={buttonClass} disabled={pending} onClick={() => void abandon()}>未受付の入力を取り消す</button> : null}
          {active && existingOperation.status === 'needs_review' ? <button type="button" className={buttonClass} disabled={pending}
            onClick={() => void control('resume')}>再確認を依頼</button> : null}
          {active && ['queued', 'needs_review'].includes(existingOperation.status) ? <button type="button" className={buttonClass} disabled={pending}
            onClick={() => void control('cancel')}>未送信の変更を取り消す</button> : null}
          {(backgroundClassificationEnabled || onAdvanced) && !active && !stored && !classificationOpen ? <button type="button" className={buttonClass}
            disabled={!ready || pending || !backgroundClassificationEnabled && Object.keys(edited).length > 0}
            title={!backgroundClassificationEnabled && Object.keys(edited).length ? '入力を保存してから開いてください。' : undefined}
            onClick={backgroundClassificationEnabled ? () => void loadClassification() : onAdvanced}>分類・仕入先を編集</button> : null}
          <button type="button" className={buttonClass} disabled={pending} onClick={requestClose}>閉じる</button>
          {!active ? <button type="submit" disabled={!ready || pending || !stored && !Object.keys(edited).length && !classificationChanged}
            className={cn(buttonClass, 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800')}>
            {pending ? '受付中…' : stored ? '受付状態を確認' : '保存'}
          </button> : null}
        </div>
      </>}
    </form>
  </dialog>
}

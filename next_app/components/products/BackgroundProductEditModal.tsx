'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/components/ui/StatusBadge'
import { getProductStoreName } from '@/lib/productStores'
import type { ProductListRow } from '@/lib/products'
import type { BackgroundExpectedValues, ProductEditIntakeData } from '@/lib/pos-products/background-edit'

type Draft = { name: string; price: string; cost: string }
type Patch = Partial<Draft>
type ExpectedValues = BackgroundExpectedValues
type Target = { storeId: 6 | 7; productId: number; janCode: string }
type Intent = Target & { version: 1; operationId: string; patch: Patch; expectedValues: ExpectedValues }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fields = ['name', 'price', 'cost'] as const
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
      throw new Error(field === 'name' ? '商品名を200文字以内で入力してください。' : `${labels[field]}を0以上の整数で入力してください。`)
    }
    patch[field] = field === 'name' ? value : String(Number(value))
  }
  if (!Object.keys(patch).length) throw new Error('変更する項目を入力してください。')
  return patch
}

export function backgroundProductEditExpectedValues(product: Pick<ProductListRow, 'product_name' | 'selling_price' | 'cost_price'>, patch: Patch): ExpectedValues {
  const money = (value: number | null) => Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : null
  const original = { name: product.product_name ?? null, price: money(product.selling_price), cost: money(product.cost_price) }
  return Object.fromEntries(Object.keys(patch).map(field => [field, original[field as keyof Draft]]))
}

function validExpectedValues(value: unknown, patch: Patch): value is ExpectedValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const expected = value as ExpectedValues
  return Object.keys(expected).length === Object.keys(patch).length &&
    Object.keys(patch).every(field => Object.hasOwn(expected, field) &&
      (expected[field as keyof Draft] === null || typeof expected[field as keyof Draft] === 'string'))
}

export function readBackgroundEditIntent(storage: StoragePort, target: Target): Intent | null {
  const raw = storage.getItem(backgroundEditStorageKey(target))
  if (raw === null) return null
  if (raw.length > 4096) throw new Error('保存済みの受付情報を確認できません。')
  const value = JSON.parse(raw) as Intent
  if (!value || value.version !== 1 || value.storeId !== target.storeId || value.productId !== target.productId ||
      value.janCode !== target.janCode || !UUID.test(value.operationId) || !value.patch || Array.isArray(value.patch) ||
      Object.keys(value.patch).some(field => !fields.includes(field as keyof Draft)) ||
      Object.values(value.patch).some(field => typeof field !== 'string') || !validExpectedValues(value.expectedValues, value.patch)) throw new Error('保存済みの受付情報を確認できません。')
  backgroundProductEditPatch({ name: '', price: '', cost: '', ...value.patch },
    Object.fromEntries(Object.keys(value.patch).map(field => [field, true])))
  return value
}

export function isBackgroundEditIntake(value: unknown, target?: Target, operationId?: string): value is ProductEditIntakeData {
  if (!value || typeof value !== 'object') return false
  const data = value as ProductEditIntakeData
  return typeof data.operationId === 'string' && UUID.test(data.operationId) && [6, 7].includes(data.storeId) &&
    Number.isSafeInteger(data.productId) && data.productId > 0 && typeof data.janCode === 'string' &&
    ['queued', 'working', 'needs_review', 'completed', 'cancelled'].includes(data.status) &&
    typeof data.message === 'string' && typeof data.createdAt === 'string' && typeof data.updatedAt === 'string' &&
    !!data.patch && typeof data.patch === 'object' && !Array.isArray(data.patch) &&
    Object.keys(data.patch).every(key => fields.includes(key as keyof Draft)) &&
    Object.values(data.patch).every(value => typeof value === 'string') &&
    (!target || data.storeId === target.storeId && data.productId === target.productId && data.janCode === target.janCode) &&
    (!operationId || data.operationId === operationId)
}

export async function acceptBackgroundProductEdit(options: {
  target: Target; patch: Patch; expectedValues: ExpectedValues; storage: StoragePort; fetcher: typeof fetch; createId: () => string
  lock: { current: boolean }; onAccepted: (data: ProductEditIntakeData) => void; onClose: () => void
}) {
  // Reactの再描画より前にロックし、同時クリックを一度の受付に限定する。
  if (options.lock.current) return
  options.lock.current = true
  try {
    let intent = readBackgroundEditIntent(options.storage, options.target)
    let data: ProductEditIntakeData | null = null
    if (intent) {
      const params = new URLSearchParams({ store: String(intent.storeId), operationId: intent.operationId })
      const response = await options.fetcher(`/api/pos-products/background-edit?${params}`, { method: 'GET', cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.success !== true || body.data !== null && (!isBackgroundEditIntake(body.data, options.target, intent.operationId) ||
          fields.some(field => body.data.patch[field] !== intent!.patch[field]))) {
        throw new Error('受付状態を確認できません。同じ入力のまま再確認してください。')
      }
      data = body.data
    } else {
      const patch = backgroundProductEditPatch({ name: '', price: '', cost: '', ...options.patch },
        Object.fromEntries(Object.keys(options.patch).map(field => [field, true])))
      if (!validExpectedValues(options.expectedValues, patch)) throw new Error('表示元の商品値を確認できません。')
      intent = { ...options.target, version: 1, operationId: options.createId(), patch, expectedValues: { ...options.expectedValues } }
      if (!UUID.test(intent.operationId)) throw new Error('受付情報を作成できません。')
      // 通信開始前に操作IDと入力を保全する。失敗時はPOS/受付POSTへ進まない。
      options.storage.setItem(backgroundEditStorageKey(options.target), JSON.stringify(intent))
    }
    if (!data) {
      const { operationId, storeId, productId, patch, expectedValues } = intent
      const response = await options.fetcher('/api/pos-products/background-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId, storeId, productId, patch, expectedValues }),
      })
      const body = await response.json()
      if (!response.ok || body.success !== true || !isBackgroundEditIntake(body.data, options.target, operationId) ||
          fields.some(field => body.data.patch[field] !== patch[field])) {
        throw new Error('変更を受け付けられませんでした。入力を保持しています。受付状態を再確認してください。')
      }
      data = body.data
    }
    if (!data) throw new Error('受付状態を確認できません。')
    options.onAccepted(data)
    // 受付確認後だけ保全情報を解除する。解除不能でもサーバーの同一ID確認を維持する。
    try { options.storage.removeItem(backgroundEditStorageKey(options.target)) } catch {}
    options.onClose()
  } finally { options.lock.current = false }
}

export async function controlBackgroundProductEdit(options: {
  target: Target; operation: ProductEditIntakeData; action: 'cancel' | 'resume'; fetcher: typeof fetch
  lock: { current: boolean }; onAccepted: (data: ProductEditIntakeData) => void; onClose: () => void
}) {
  if (options.lock.current) return
  options.lock.current = true
  try {
    const { operation, action } = options
    if (!isBackgroundEditIntake(operation, options.target) ||
        (action === 'resume' ? operation.status !== 'needs_review' : !['queued', 'needs_review'].includes(operation.status))) {
      throw new Error('この操作の状態を確認できません。')
    }
    const response = await options.fetcher('/api/pos-products/background-edit/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: operation.storeId, operationId: operation.operationId, action }),
    })
    const body = await response.json()
    if (!response.ok || body.success !== true || !isBackgroundEditIntake(body.data, options.target, operation.operationId) ||
        fields.some(field => body.data.patch[field] !== operation.patch[field])) throw new Error('操作の受付状態を確認できません。')
    options.onAccepted(body.data)
    options.onClose()
  } finally { options.lock.current = false }
}

export async function abandonBackgroundEditIntent(options: {
  target: Target; storage: StoragePort; fetcher: typeof fetch; lock: { current: boolean }; onAbandoned: () => void; onClose: () => void
}) {
  if (options.lock.current) return
  options.lock.current = true
  try {
    const intent = readBackgroundEditIntent(options.storage, options.target)
    if (!intent) throw new Error('受付情報を確認できません。')
    const { operationId, storeId, productId } = intent
    const response = await options.fetcher('/api/pos-products/background-edit/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId, storeId, productId, action: 'abandon' }) })
    const body = await response.json(), receipt = body.data
    if (!response.ok || body.success !== true || !receipt || Object.keys(receipt).length !== 4 ||
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
  onAccepted: (data: ProductEditIntakeData) => void; onClose: () => void; onAdvanced?: () => void; onAbandoned?: () => void
}

export function BackgroundProductEditModal({ product, storeId, existingOperation, onAccepted, onClose, onAdvanced, onAbandoned }: Props) {
  const money = (value: number | null) => Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : ''
  const [draft, setDraft] = useState<Draft>(() => ({ name: product.product_name ?? '', price: money(product.selling_price), cost: money(product.cost_price), ...existingOperation?.patch }))
  const [edited, setEdited] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [ready, setReady] = useState(false)
  const [stored, setStored] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const titleId = useId(), descriptionId = useId()
  const active = existingOperation && ['queued', 'working', 'needs_review'].includes(existingOperation.status)
  // 状況取得がモーダル表示より遅れても、サーバーに保持した希望値を表示する。
  const displayed = active ? { ...draft, ...existingOperation.patch } : draft

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
    try {
      const intent = readBackgroundEditIntent(window.sessionStorage, { productId: product.id, storeId, janCode: product.jan_code ?? '' })
      if (intent) { setDraft(value => ({ ...value, ...intent.patch })); setStored(true) }
      setReady(true)
    } catch { setError('この端末の受付情報を確認できません。保存せず、既存の操作を確認してください。') }
    return () => { if (node?.open) node.close() }
  }, [product.id, product.jan_code, storeId])

  function requestClose() {
    if (lock.current) return
    if (!active && !stored && Object.keys(edited).length) setConfirmClose(true)
    else onClose()
  }

  async function save() {
    if (!ready || active || lock.current) return
    if (!product.jan_code) { setError('JANコードがないため、この商品を受付できません。'); return }
    setError(null)
    try {
      const patch = stored ? {} : backgroundProductEditPatch(draft, edited)
      setPending(true)
      await acceptBackgroundProductEdit({ target: { productId: product.id, storeId, janCode: product.jan_code }, patch,
        expectedValues: backgroundProductEditExpectedValues(product, patch),
        storage: window.sessionStorage, fetcher: fetch, createId: () => window.crypto.randomUUID(), lock, onAccepted, onClose })
    } catch {
      setStored(() => {
        try { return readBackgroundEditIntent(window.sessionStorage, { productId: product.id, storeId, janCode: product.jan_code ?? '' }) !== null } catch { return true }
      })
      setError('変更を受け付けられませんでした。入力を保持しています。もう一度保存して受付状態を確認してください。')
    } finally { setPending(false) }
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
        {error ? <p role="alert" className="text-pretty text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {stored && !active ? <button type="button" className={buttonClass} disabled={pending} onClick={() => void abandon()}>未受付の入力を取り消す</button> : null}
          {active && existingOperation.status === 'needs_review' ? <button type="button" className={buttonClass} disabled={pending}
            onClick={() => void control('resume')}>再確認を依頼</button> : null}
          {active && ['queued', 'needs_review'].includes(existingOperation.status) ? <button type="button" className={buttonClass} disabled={pending}
            onClick={() => void control('cancel')}>未送信の変更を取り消す</button> : null}
          {onAdvanced && !active && !stored ? <button type="button" className={buttonClass} disabled={!ready || pending || Object.keys(edited).length > 0}
            title={Object.keys(edited).length ? '入力を保存してから開いてください。' : undefined} onClick={onAdvanced}>分類・仕入先を編集</button> : null}
          <button type="button" className={buttonClass} disabled={pending} onClick={requestClose}>閉じる</button>
          {!active ? <button type="submit" disabled={!ready || pending || !stored && !Object.keys(edited).length}
            className={cn(buttonClass, 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800')}>
            {pending ? '受付中…' : stored ? '受付状態を確認' : '保存'}
          </button> : null}
        </div>
      </>}
    </form>
  </dialog>
}

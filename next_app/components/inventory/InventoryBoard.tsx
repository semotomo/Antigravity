'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  PackageSearch,
  Printer,
  RotateCcw,
  Save,
  Search,
} from 'lucide-react'

import {
  finalizeInventorySessionAction,
  prepareInventoryFinalizationAction,
  refreshInventoryBalanceAction,
  saveInventoryCountAction,
  setInventoryItemExclusionAction,
  setInventoryProductStatusAction,
  startInventorySessionAction,
} from '@/app/actions/inventory'
import { cn, StatusBadge } from '@/components/ui/StatusBadge'
import type { InventoryCountMode } from '@/lib/inventory/validation'
import type {
  InventoryWorkspace,
  InventoryWorkspaceItem,
} from '@/lib/inventory/workspace'
import type { InventoryOverview as InventoryOverviewData } from '@/lib/inventory/management'
import type { InventoryFinalizationReview } from '@/lib/inventory/recalculationService'
import { getProductStoreName } from '@/lib/productStores'
import { InventoryCountDialog } from './InventoryCountDialog'
import { InventoryFinalizeDialog } from './InventoryFinalizeDialog'
import { InventoryOverview } from './InventoryOverview'
import { InventoryReasonDialog } from './InventoryReasonDialog'

const JanCodeScannerField = dynamic(
  () => import('@/components/orders/JanCodeScannerField').then((module) => module.JanCodeScannerField),
  {
    ssr: false,
    loading: () => <div className="h-11 rounded-2xl bg-gray-100" aria-hidden="true" />,
  },
)

type CountStatus = 'all' | 'counted' | 'uncounted'
const FINALIZATION_NOTICE_KEY = 'inventory-finalization-notice'

type FinalizationNotice = {
  kind: 'success' | 'warning'
  storeId: 6 | 7
}

function saveFinalizationNotice(notice: FinalizationNotice) {
  try {
    window.sessionStorage.setItem(FINALIZATION_NOTICE_KEY, JSON.stringify(notice))
  } catch {
    // ブラウザ保存が使えなくても、確定・同期結果そのものには影響させない。
  }
}

type InventoryBoardProps = {
  allowedStores: Array<6 | 7>
  managerStores: Array<6 | 7>
  initialOverview: InventoryOverviewData
  initialWorkspace: InventoryWorkspace
  storeId: 6 | 7
}

type WorkspaceApiResponse =
  | { success: true; data: InventoryWorkspace }
  | { success: false; message: string }

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

async function fetchWorkspace(input: {
  countStatus: CountStatus
  limit?: number
  offset: number
  query: string
  sessionId: string | null
  storeId: 6 | 7
}) {
  const params = new URLSearchParams({
    storeId: String(input.storeId),
    sessionId: input.sessionId ?? '',
    query: input.query,
    countStatus: input.countStatus,
    limit: String(input.limit ?? 100),
    offset: String(input.offset),
  })
  const response = await fetch(`/api/inventory/workspace?${params.toString()}`, {
    cache: 'no-store',
  })
  const body = await response.json() as WorkspaceApiResponse
  if (!response.ok || !body.success) {
    throw new Error(body.success ? '棚卸し一覧の取得に失敗しました。' : body.message)
  }
  return body.data
}

function InventoryItemCard({
  canManage,
  item,
  saving,
  onExclusion,
  onSave,
  onStatus,
}: {
  canManage: boolean
  item: InventoryWorkspaceItem
  saving: boolean
  onExclusion: (item: InventoryWorkspaceItem) => void
  onSave: (item: InventoryWorkspaceItem, quantity: number, mode: InventoryCountMode) => Promise<boolean>
  onStatus: (item: InventoryWorkspaceItem) => void
}) {
  const [quantity, setQuantity] = useState(
    item.countedQuantity === null ? '' : String(item.countedQuantity),
  )
  const [error, setError] = useState('')

  const submit = async () => {
    const value = quantity.trim()
    if (!/^\d+(?:\.\d{1,3})?$/.test(value)) {
      setError('0以上、小数3桁以内で入力してください。')
      return
    }
    setError('')
    await onSave(item, Number(value), item.countedQuantity === null ? 'initial' : 'replace')
  }

  const countLabel = item.countedQuantity === null
    ? '未入力'
    : item.countedQuantity === 0
      ? '在庫0'
      : '入力済み'

  return (
    <article className="content-visibility-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate font-bold text-gray-950">{item.productNameSnapshot}</h3>
            <StatusBadge variant={item.countedQuantity === null ? 'warning' : 'success'}>
              {countLabel}
            </StatusBadge>
            {!item.isActive ? <StatusBadge variant="gray">停止商品</StatusBadge> : null}
          </div>
          <p className="mt-1 font-mono text-xs text-gray-500">JAN: {item.janSnapshot}</p>
          <p className="mt-1 truncate text-xs text-gray-500">
            {item.categorySnapshot || 'カテゴリ未設定'}
            {item.supplierSnapshot ? ` / ${item.supplierSnapshot}` : ''}
            {item.shelfSnapshot ? ` / 棚 ${item.shelfSnapshot}` : ''}
          </p>
          {item.countedAt ? (
            <p className="mt-2 text-xs text-gray-500">計数時刻: {formatDateTime(item.countedAt)}</p>
          ) : null}
        </div>

        <div className="w-full lg:w-72">
          {item.excludedAt ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <strong>理由付き除外</strong>
              <p className="mt-1 text-xs">{item.exclusionReason}</p>
            </div>
          ) : (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">実在庫数</span>
            <div className="flex gap-2">
              <input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submit()
                  }
                }}
                inputMode="decimal"
                min="0"
                step="0.001"
                aria-label={`${item.productNameSnapshot}の実在庫数`}
                className="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-right text-lg font-bold tabular-nums outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="inline-flex min-w-20 items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-sm font-bold text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                保存
              </button>
            </div>
          </label>
          )}
          {error ? <p className="mt-1 text-xs font-medium text-red-700">{error}</p> : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onExclusion(item)}
              disabled={saving}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50"
            >
              {item.excludedAt ? '除外を解除' : '棚卸し対象から除外'}
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={() => onStatus(item)}
                disabled={saving}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50',
                  item.isActive
                    ? 'border-red-200 text-red-700 hover:bg-red-50'
                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
                )}
              >
                {item.isActive ? <Ban className="size-3.5" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
                {item.isActive ? '商品を停止' : '停止を解除'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export function InventoryBoard({
  allowedStores,
  managerStores,
  initialOverview,
  initialWorkspace,
  storeId,
}: InventoryBoardProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [view, setView] = useState<'count' | 'overview'>(
    initialWorkspace.session ? 'count' : initialOverview.session ? 'overview' : 'count',
  )
  const [query, setQuery] = useState('')
  const [countStatus, setCountStatus] = useState<CountStatus>('uncounted')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [dialogItem, setDialogItem] = useState<InventoryWorkspaceItem | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [reasonItem, setReasonItem] = useState<{ kind: 'status' | 'exclusion'; item: InventoryWorkspaceItem } | null>(null)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [finalizationReview, setFinalizationReview] = useState<InventoryFinalizationReview | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [starting, startTransition] = useTransition()
  const activeSessionId = workspace.session?.id ?? null
  const canManage = managerStores.includes(storeId)
  const finalizationPending = finalizing || savingItemId !== null

  useEffect(() => {
    try {
      const rawNotice = window.sessionStorage.getItem(FINALIZATION_NOTICE_KEY)
      if (!rawNotice) return
      window.sessionStorage.removeItem(FINALIZATION_NOTICE_KEY)
      const notice = JSON.parse(rawNotice) as FinalizationNotice
      if (notice.storeId !== storeId) return
      if (notice.kind === 'warning') {
        setError('棚卸しの確定は完了しましたが、確定直後の最新履歴同期に失敗しました。現在庫の「最新履歴で再計算」を実行してください。')
        return
      }
      setMessage('棚卸しを確定し、確定後に最新の販売・返品履歴を同期しました。')
    } catch {
      try {
        window.sessionStorage.removeItem(FINALIZATION_NOTICE_KEY)
      } catch {
        // sessionStorage自体が無効でも画面表示は継続する。
      }
    }
  }, [storeId])

  const loadWorkspace = useCallback(async (options?: {
    countStatus?: CountStatus
    limit?: number
    offset?: number
    query?: string
    sessionId?: string | null
  }) => {
    setLoading(true)
    try {
      const next = await fetchWorkspace({
        countStatus: options?.countStatus ?? countStatus,
        limit: options?.limit,
        offset: options?.offset ?? offset,
        query: options?.query ?? query,
        sessionId: options && 'sessionId' in options ? options.sessionId ?? null : activeSessionId,
        storeId,
      })
      setWorkspace(next)
      setError('')
      return next
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '棚卸し一覧の取得に失敗しました。')
      return null
    } finally {
      setLoading(false)
    }
  }, [activeSessionId, countStatus, offset, query, storeId])

  useEffect(() => {
    if (!activeSessionId) return
    const timer = window.setTimeout(() => {
      void loadWorkspace()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeSessionId, loadWorkspace])

  const handleStart = () => {
    setError('')
    setMessage('')
    startTransition(async () => {
      const result = await startInventorySessionAction({ storeId })
      if (!result.success) {
        setError(result.message)
        return
      }
      const next = await loadWorkspace({ sessionId: null, countStatus: 'uncounted', offset: 0 })
      if (next?.session) {
        setMessage('棚卸しの下書きを開始しました。')
        setView('count')
      }
    })
  }

  const handleReasonAction = async (reason: string) => {
    if (!reasonItem || !workspace.session) return false
    setSavingItemId(reasonItem.item.id)
    setDialogError('')
    const { item, kind } = reasonItem
    const result = kind === 'status'
      ? await setInventoryProductStatusAction({
          storeId,
          janCode: item.janSnapshot,
          active: !item.isActive,
          reason,
        })
      : await setInventoryItemExclusionAction({
          storeId,
          sessionId: workspace.session.id,
          janCode: item.janSnapshot,
          excluded: item.excludedAt === null,
          reason,
          expectedRowVersion: item.rowVersion,
        })
    if (!result.success) {
      setDialogError(result.message)
      setError(result.message)
      if (result.conflict) await loadWorkspace()
      setSavingItemId(null)
      return false
    }
    setReasonItem(null)
    setMessage(kind === 'status'
      ? item.isActive ? '商品を停止しました。停止後もこの棚卸しの数量は入力できます。' : '商品の停止を解除しました。'
      : item.excludedAt ? '棚卸し対象へ戻しました。' : '理由付きで棚卸し対象から除外しました。')
    await loadWorkspace()
    setSavingItemId(null)
    return true
  }

  const runFinalizationReview = async () => {
    if (!workspace.session) return
    if (savingItemId) {
      setDialogError('数量の保存完了後に確定前チェックを実行してください。')
      return
    }
    setFinalizing(true)
    setDialogError('')
    try {
      const result = await prepareInventoryFinalizationAction({ storeId, sessionId: workspace.session.id })
      if (!result.success) {
        setDialogError(result.message)
        return
      }
      setFinalizationReview(result.data)
    } catch {
      setDialogError('確定前チェック結果を取得できませんでした。入力済みの棚卸し数量は保存されています。通信を確認して再試行してください。')
    } finally {
      setFinalizing(false)
    }
  }

  const finalizeSession = async () => {
    if (!workspace.session || !finalizationReview?.canFinalize || savingItemId) return
    setFinalizing(true)
    setDialogError('')
    let result
    try {
      result = await finalizeInventorySessionAction({
        storeId,
        sessionId: workspace.session.id,
        snapshotId: finalizationReview.snapshotId,
        calculatedAsOf: finalizationReview.calculatedAsOf,
        expectedRowVersion: workspace.session.rowVersion,
      })
    } catch {
      setDialogError('棚卸しの確定結果を確認できませんでした。入力数量は失われません。画面を再読み込みして確定状態を確認してください。')
      setFinalizing(false)
      return
    }
    if (!result.success) {
      setDialogError(result.message)
      setFinalizing(false)
      if (result.conflict) await loadWorkspace()
      return
    }

    let syncWarning: string | null = null
    try {
      // 確定応答を受け取ってから別Actionで同期し、同期障害を確定失敗に見せない。
      const synchronization = await refreshInventoryBalanceAction({
        storeId,
        sessionId: workspace.session.id,
      })
      if (!synchronization.success) syncWarning = synchronization.message
    } catch {
      syncWarning = '確定直後の最新履歴同期に失敗しました。'
    }

    setFinalizeOpen(false)
    setFinalizationReview(null)
    setFinalizing(false)
    saveFinalizationNotice({
      kind: syncWarning ? 'warning' : 'success',
      storeId,
    })
    window.location.reload()
  }

  const handleSave = async (
    item: InventoryWorkspaceItem,
    quantity: number,
    mode: InventoryCountMode,
  ) => {
    if (!workspace.session) return false
    setSavingItemId(item.id)
    setError('')
    setDialogError('')
    try {
      const result = await saveInventoryCountAction({
        storeId,
        sessionId: workspace.session.id,
        janCode: item.janSnapshot,
        quantity,
        mode,
        expectedRowVersion: item.rowVersion,
      })
      if (!result.success) {
        setDialogError(result.message)
        setError(result.message)
        if (result.conflict) await loadWorkspace()
        return false
      }

      setWorkspace((current) => ({
        ...current,
        progress: {
          ...current.progress,
          ...result.data.progress,
        },
        items: current.items.map((currentItem) =>
          currentItem.id === result.data.item.id ? result.data.item : currentItem,
        ),
      }))
      setMessage(`${item.productNameSnapshot}を下書き保存しました。`)
      setDialogItem(null)
      await loadWorkspace()
      return true
    } catch (saveError) {
      const saveMessage = saveError instanceof Error
        ? saveError.message
        : '棚卸し数量の保存に失敗しました。'
      setDialogError(saveMessage)
      setError(saveMessage)
      return false
    } finally {
      setSavingItemId(null)
    }
  }

  const lookupJan = async (rawValue: string) => {
    const janCode = rawValue.replace(/\D/g, '')
    if (!janCode || !workspace.session) return
    setLoading(true)
    setError('')
    try {
      const result = await fetchWorkspace({
        countStatus: 'all',
        limit: 20,
        offset: 0,
        query: janCode,
        sessionId: workspace.session.id,
        storeId,
      })
      const exactItem = result.items.find((item) => item.janSnapshot === janCode)
      if (!exactItem) {
        setError('この店舗の棚卸し対象に一致するJANがありません。')
        return
      }
      setDialogError('')
      setDialogItem(exactItem)
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'JANの照合に失敗しました。')
    } finally {
      setLoading(false)
    }
  }

  const progress = workspace.progress
  const pageStart = workspace.filteredCount === 0 ? 0 : workspace.offset + 1
  const pageEnd = Math.min(workspace.offset + workspace.items.length, workspace.filteredCount)
  const canGoBack = workspace.offset > 0
  const canGoNext = workspace.offset + workspace.limit < workspace.filteredCount

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <ClipboardCheck className="size-6" aria-hidden="true" />
              </span>
              <div>
                <h1 className="text-balance text-2xl font-bold text-gray-950 sm:text-3xl">
                  棚卸し・在庫管理
                </h1>
                <p className="mt-1 text-pretty text-sm text-gray-600">
                  実在庫を商品ごとの計数時刻と一緒に保存します。
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="棚卸し対象店舗">
            {allowedStores.map((allowedStoreId) => (
              <Link
                key={allowedStoreId}
                href={`/inventory?store=${allowedStoreId}`}
                className={cn(
                  'rounded-xl border px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600',
                  allowedStoreId === storeId
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {getProductStoreName(allowedStoreId)}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2" aria-label="棚卸し画面の切り替え">
            <button type="button" onClick={() => setView('count')} className={cn('rounded-xl border px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600', view === 'count' ? 'border-sky-700 bg-sky-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}>棚卸し入力</button>
            <button type="button" onClick={() => setView('overview')} className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600', view === 'overview' ? 'border-sky-700 bg-sky-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}><Boxes className="size-4" aria-hidden="true" />現在庫</button>
          </div>
          {view === 'count' && workspace.session ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/inventory/print?store=${storeId}&session=${workspace.session.id}&mode=blank&sort=category`} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"><Printer className="size-4" aria-hidden="true" />記入用を印刷</Link>
              <Link href={`/inventory/print?store=${storeId}&session=${workspace.session.id}&mode=result&sort=category`} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"><Printer className="size-4" aria-hidden="true" />入力結果を印刷</Link>
              <button type="button" onClick={() => { setDialogError(''); setFinalizationReview(null); setFinalizeOpen(true) }} disabled={finalizationPending} className="rounded-xl bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">確定前チェック</button>
            </div>
          ) : null}
        </div>
      </section>

      {message ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900" aria-live="polite">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      {view === 'overview' ? (
        <InventoryOverview
          key={`${storeId}:${initialOverview.session?.id ?? 'none'}`}
          canManage={canManage}
          initialOverview={initialOverview}
          storeId={storeId}
        />
      ) : !workspace.session ? (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-10">
          <PackageSearch className="mx-auto size-12 text-sky-700" aria-hidden="true" />
          <h2 className="mt-4 text-balance text-xl font-bold text-gray-950">
            {getProductStoreName(storeId)}の棚卸しを開始
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-sm text-gray-600">
            現在の商品マスタを停止商品も含めて下書きへ取り込みます。開始後は商品ごとに数量を保存して、いつでも再開できます。
          </p>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-6 py-3 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="size-4" aria-hidden="true" />}
            棚卸しを開始する
          </button>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['棚卸し済み', progress.countedCount, 'text-emerald-700'],
              ['未棚卸し', progress.uncountedCount, 'text-amber-700'],
              ['対象商品', progress.totalCount, 'text-gray-900'],
              ['進捗率', `${progress.progressRate}%`, 'text-sky-700'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-gray-600">{label}</p>
                <p className={cn('mt-2 text-3xl font-bold tabular-nums', color)}>{value}</p>
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="min-w-0 flex-1">
                <JanCodeScannerField
                  label="JANコードで商品を追加・確認"
                  helpText="カメラ、写真、JANコードリーダー、手入力に対応しています。"
                  onDetectedCode={(value) => {
                    void lookupJan(value)
                    return '商品を確認しています。'
                  }}
                  onEnterKey={(value) => void lookupJan(value)}
                  wrapperClassName="space-y-2"
                />
              </div>
              <div className="min-w-0 flex-1">
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-gray-800">商品を検索</span>
                  <span className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value)
                        setOffset(0)
                      }}
                      placeholder="商品名 / JAN / カテゴリ / 仕入れ先 / 棚番号"
                      className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                    />
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2" aria-label="棚卸し状態で絞り込み">
                {([
                  ['uncounted', '未棚卸し'],
                  ['counted', '棚卸し済み'],
                  ['all', 'すべて'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setCountStatus(value)
                      setOffset(0)
                    }}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600',
                      countStatus === value
                        ? 'border-sky-700 bg-sky-700 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                数量を保存するたびに下書きに自動保存されます。
              </p>
            </div>
          </section>

          <section className="space-y-3" aria-busy={loading}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-600 tabular-nums">
                {workspace.filteredCount}件中 {pageStart}〜{pageEnd}件
              </p>
              {loading ? <Loader2 className="size-5 animate-spin text-sky-700" aria-label="一覧を更新中" /> : null}
            </div>

            {workspace.items.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
                <PackageSearch className="mx-auto size-10 text-gray-400" aria-hidden="true" />
                <h2 className="mt-3 text-balance text-lg font-bold text-gray-900">対象商品がありません</h2>
                <p className="mt-2 text-pretty text-sm text-gray-500">
                  検索条件を変更するか、「すべて」を選択してください。
                </p>
              </div>
            ) : (
              workspace.items.map((item) => (
                <InventoryItemCard
                  key={`${item.id}:${item.rowVersion}`}
                  item={item}
                  canManage={canManage}
                  saving={savingItemId === item.id}
                  onExclusion={(target) => { setDialogError(''); setReasonItem({ kind: 'exclusion', item: target }) }}
                  onSave={handleSave}
                  onStatus={(target) => { setDialogError(''); setReasonItem({ kind: 'status', item: target }) }}
                />
              ))
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOffset((current) => Math.max(0, current - workspace.limit))}
                disabled={!canGoBack || loading}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                前へ
              </button>
              <button
                type="button"
                onClick={() => setOffset((current) => current + workspace.limit)}
                disabled={!canGoNext || loading}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-40"
              >
                次へ
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </section>
        </>
      )}

      {dialogItem ? (
        <InventoryCountDialog
          item={dialogItem}
          saving={savingItemId === dialogItem.id}
          error={dialogError}
          onClose={() => {
            if (!savingItemId) setDialogItem(null)
          }}
          onSave={(mode, quantity) => handleSave(dialogItem, quantity, mode)}
        />
      ) : null}
      {reasonItem ? (
        <InventoryReasonDialog
          title={reasonItem.kind === 'status'
            ? reasonItem.item.isActive ? '商品を停止' : '停止を解除'
            : reasonItem.item.excludedAt ? '棚卸し対象へ戻す' : '棚卸し対象から除外'}
          description={reasonItem.kind === 'status'
            ? reasonItem.item.isActive
              ? `${reasonItem.item.productNameSnapshot}を停止します。現在の棚卸し数量と履歴は削除されません。`
              : `${reasonItem.item.productNameSnapshot}を有効へ戻します。`
            : reasonItem.item.excludedAt
              ? `${reasonItem.item.productNameSnapshot}を未棚卸しへ戻します。`
              : `${reasonItem.item.productNameSnapshot}を今回の確定対象から除外します。`}
          confirmLabel={reasonItem.kind === 'status'
            ? reasonItem.item.isActive ? '商品を停止' : '停止を解除'
            : reasonItem.item.excludedAt ? '対象へ戻す' : '理由付きで除外'}
          destructive={reasonItem.kind === 'status' && reasonItem.item.isActive}
          error={dialogError}
          pending={savingItemId === reasonItem.item.id}
          onClose={() => { if (!savingItemId) setReasonItem(null) }}
          onConfirm={handleReasonAction}
        />
      ) : null}
      {finalizeOpen ? (
        <InventoryFinalizeDialog
          error={dialogError}
          pending={finalizationPending}
          review={finalizationReview}
          onClose={() => { if (!finalizing) setFinalizeOpen(false) }}
          onReview={runFinalizationReview}
          onFinalize={finalizeSession}
        />
      ) : null}
    </div>
  )
}

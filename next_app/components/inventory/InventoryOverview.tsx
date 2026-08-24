'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MinusCircle,
  Printer,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'

import {
  addInventoryAdjustmentAction,
  correctFinalizedInventoryCountAction,
  refreshInventoryBalanceAction,
  setInventoryProductStatusAction,
} from '@/app/actions/inventory'
import { cn, StatusBadge } from '@/components/ui/StatusBadge'
import type { InventoryOverview as InventoryOverviewData, InventoryOverviewItem } from '@/lib/inventory/management'
import { InventoryQuantityActionDialog } from './InventoryQuantityActionDialog'
import { InventoryReasonDialog } from './InventoryReasonDialog'

type StockStatus = 'all' | 'negative' | 'adjusted'

type OverviewResponse =
  | { success: true; data: InventoryOverviewData }
  | { success: false; message: string }

async function fetchOverview(input: { storeId: 6 | 7; query: string; stockStatus: StockStatus; offset: number }) {
  const params = new URLSearchParams({
    storeId: String(input.storeId),
    query: input.query,
    stockStatus: input.stockStatus,
    limit: '100',
    offset: String(input.offset),
  })
  const response = await fetch(`/api/inventory/overview?${params.toString()}`, { cache: 'no-store' })
  const body = await response.json() as OverviewResponse
  if (!response.ok || !body.success) {
    throw new Error(body.success ? '現在庫一覧の取得に失敗しました。' : body.message)
  }
  return body.data
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

function Breakdown({ item }: { item: InventoryOverviewItem }) {
  const values = [
    ['実在庫', item.physicalQuantity],
    ['販売', -item.salesQuantity],
    ['返品', item.returnQuantity],
    ['移動入', item.transferInQuantity],
    ['移動出', -item.transferOutQuantity],
    ['物品使用', -item.usageQuantity],
    ['調整', item.adjustmentDelta],
  ] as const
  return (
    <div className="mt-3 grid grid-cols-4 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-7">
      {values.map(([label, value]) => (
        <div key={label}>
          <p className="text-[11px] text-gray-500">{label}</p>
          <p className={cn('mt-0.5 text-sm font-bold tabular-nums', value < 0 ? 'text-red-700' : 'text-gray-800')}>{value > 0 && label !== '実在庫' ? `+${value}` : value}</p>
        </div>
      ))}
    </div>
  )
}

export function InventoryOverview({
  canManage,
  initialOverview,
  storeId,
}: {
  canManage: boolean
  initialOverview: InventoryOverviewData
  storeId: 6 | 7
}) {
  const [overview, setOverview] = useState(initialOverview)
  const [query, setQuery] = useState('')
  const [stockStatus, setStockStatus] = useState<StockStatus>('all')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [quantityAction, setQuantityAction] = useState<{ mode: 'correction' | 'adjustment'; item: InventoryOverviewItem } | null>(null)
  const [statusItem, setStatusItem] = useState<InventoryOverviewItem | null>(null)
  const firstRender = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchOverview({ storeId, query, stockStatus, offset })
      setOverview(data)
      setError('')
      return data
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '現在庫一覧の取得に失敗しました。')
      return null
    } finally {
      setLoading(false)
    }
  }, [offset, query, stockStatus, storeId])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const timer = window.setTimeout(() => { void load() }, 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const runRefresh = async () => {
    if (!overview.session) return
    setPending(true)
    setError('')
    const result = await refreshInventoryBalanceAction({ storeId, sessionId: overview.session.id })
    if (!result.success) {
      setError(result.message)
    } else {
      setMessage('最新の販売・返品・移動・使用・調整から現在庫を再計算しました。')
      await load()
    }
    setPending(false)
  }

  const changeStatus = async (reason: string) => {
    if (!statusItem) return false
    setPending(true)
    const nextActive = !statusItem.isActive
    const result = await setInventoryProductStatusAction({ storeId, janCode: statusItem.janCode, active: nextActive, reason })
    if (!result.success) {
      setError(result.message)
      setPending(false)
      return false
    }
    setStatusItem(null)
    setMessage(nextActive ? '商品の停止を解除しました。' : '商品を停止しました。残数の在庫履歴は保持されます。')
    await load()
    setPending(false)
    return true
  }

  const saveQuantityAction = async (quantity: number, reason: string) => {
    if (!quantityAction) return false
    setPending(true)
    const { item, mode } = quantityAction
    const result = mode === 'correction'
      ? await correctFinalizedInventoryCountAction({ storeId, sessionId: item.sessionId, janCode: item.janCode, quantity, reason, expectedRowVersion: item.rowVersion })
      : await addInventoryAdjustmentAction({ storeId, sessionId: item.sessionId, janCode: item.janCode, quantityDelta: quantity, reason, idempotencyKey: crypto.randomUUID() })
    if (!result.success) {
      setError(result.message)
      setPending(false)
      return false
    }
    const syncWarning = typeof result.data.syncWarning === 'string' ? result.data.syncWarning : null
    setQuantityAction(null)
    setMessage(syncWarning
      ? `履歴は保存しましたが、再計算に失敗しました。「最新履歴で再計算」を実行してください。${syncWarning}`
      : mode === 'correction' ? '確定済み数量を訂正し、現在庫を再計算しました。' : '手動調整を追加し、現在庫を再計算しました。')
    await load()
    setPending(false)
    return true
  }

  if (!overview.session) {
    return (
      <section className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
        <MinusCircle className="mx-auto size-10 text-gray-400" aria-hidden="true" />
        <h2 className="mt-3 text-balance text-lg font-bold text-gray-900">確定済みの現在庫はありません</h2>
        <p className="mt-2 text-pretty text-sm text-gray-500">最初の棚卸しを開始し、全商品を確認して確定してください。</p>
      </section>
    )
  }

  const pageStart = overview.filteredCount === 0 ? 0 : overview.offset + 1
  const pageEnd = Math.min(overview.offset + overview.items.length, overview.filteredCount)
  return (
    <div className="space-y-4">
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900" aria-live="polite">{message}</div> : null}
      {error ? <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900" role="alert"><AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ['現在庫の商品', overview.summary.totalCount, 'text-gray-950'],
          ['マイナス在庫', overview.summary.negativeCount, 'text-red-700'],
          ['手動調整あり', overview.summary.adjustedCount, 'text-amber-700'],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-sm font-medium text-gray-600">{label}</p><p className={cn('mt-2 text-3xl font-bold tabular-nums', color)}>{value}</p></div>
        ))}
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="min-w-0 flex-1 space-y-2"><span className="text-sm font-semibold text-gray-800">現在庫を検索</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0) }} placeholder="商品名 / JAN / カテゴリ / 仕入れ先" className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></span></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void runRefresh()} disabled={pending} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50"><RefreshCw className={cn('size-4', pending && 'animate-spin')} aria-hidden="true" />最新履歴で再計算</button>
            <Link href={`/inventory/print?store=${storeId}&session=${overview.session.id}&mode=result&sort=category`} target="_blank" className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-sm font-bold text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"><Printer className="size-4" aria-hidden="true" />結果を印刷</Link>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4" aria-label="現在庫状態で絞り込み">
          {([['all', 'すべて'], ['negative', 'マイナス'], ['adjusted', '手動調整あり']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setStockStatus(value); setOffset(0) }} className={cn('rounded-xl border px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600', stockStatus === value ? 'border-sky-700 bg-sky-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}>{label}</button>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-busy={loading}>
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium tabular-nums text-gray-600">{overview.filteredCount}件中 {pageStart}〜{pageEnd}件</p>{loading ? <Loader2 className="size-5 animate-spin text-sky-700" aria-label="現在庫を更新中" /> : null}</div>
        {overview.items.map((item) => (
          <article key={`${item.sessionItemId}:${item.rowVersion}`} className={cn('content-visibility-auto rounded-2xl border bg-white p-4 shadow-sm', item.calculatedQuantity < 0 ? 'border-red-300' : item.isLargeAdjustment ? 'border-amber-300' : 'border-gray-200')}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-gray-950">{item.productName}</h3>{!item.isActive ? <StatusBadge variant="gray">停止商品</StatusBadge> : null}{item.calculatedQuantity < 0 ? <StatusBadge variant="danger">マイナス</StatusBadge> : null}{item.isLargeAdjustment ? <StatusBadge variant="warning">差異大</StatusBadge> : null}</div>
                <p className="mt-1 font-mono text-xs text-gray-500">JAN: {item.janCode}</p>
                <p className="mt-1 truncate text-xs text-gray-500">{item.category || 'カテゴリ未設定'}{item.supplierName ? ` / ${item.supplierName}` : ''}{item.shelfCode ? ` / 棚 ${item.shelfCode}` : ''}</p>
                <p className="mt-2 text-xs text-gray-500">計算基準: {formatDateTime(item.calculatedAsOf)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <div className={cn('mr-2 text-right', item.calculatedQuantity < 0 ? 'text-red-700' : 'text-sky-800')}><p className="text-xs font-medium">現在庫</p><p className="text-3xl font-bold tabular-nums">{item.calculatedQuantity}</p></div>
                {canManage ? <><button type="button" onClick={() => setQuantityAction({ mode: 'correction', item })} className="rounded-xl border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">数量を訂正</button><button type="button" onClick={() => setQuantityAction({ mode: 'adjustment', item })} className="inline-flex items-center gap-1 rounded-xl border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"><SlidersHorizontal className="size-3.5" aria-hidden="true" />手動調整</button><button type="button" onClick={() => setStatusItem(item)} className={cn('rounded-xl border px-3 py-2 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600', item.isActive ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50')}>{item.isActive ? '商品を停止' : '停止を解除'}</button></> : null}
              </div>
            </div>
            <Breakdown item={item} />
          </article>
        ))}
        <div className="flex items-center justify-end gap-2 pt-2"><button type="button" onClick={() => setOffset((current) => Math.max(0, current - overview.limit))} disabled={overview.offset === 0 || loading} className="inline-flex items-center gap-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"><ChevronLeft className="size-4" aria-hidden="true" />前へ</button><button type="button" onClick={() => setOffset((current) => current + overview.limit)} disabled={overview.offset + overview.limit >= overview.filteredCount || loading} className="inline-flex items-center gap-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">次へ<ChevronRight className="size-4" aria-hidden="true" /></button></div>
      </section>

      {quantityAction ? <InventoryQuantityActionDialog mode={quantityAction.mode} item={quantityAction.item} error={error} pending={pending} onClose={() => { if (!pending) setQuantityAction(null) }} onConfirm={saveQuantityAction} /> : null}
      {statusItem ? <InventoryReasonDialog title={statusItem.isActive ? '商品を停止' : '停止を解除'} description={statusItem.isActive ? `${statusItem.productName}を停止します。現在庫と棚卸し履歴は削除されません。` : `${statusItem.productName}を有効へ戻します。`} confirmLabel={statusItem.isActive ? '商品を停止' : '停止を解除'} destructive={statusItem.isActive} error={error} pending={pending} onClose={() => { if (!pending) setStatusItem(null) }} onConfirm={changeStatus} /> : null}
    </div>
  )
}

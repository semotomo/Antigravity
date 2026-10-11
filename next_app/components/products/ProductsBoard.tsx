'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, SquarePen, Loader2 } from 'lucide-react'
import { JanCodeScannerField } from '@/components/orders/JanCodeScannerField'
import { ProductFormModal } from '@/components/products/ProductFormModal'
import { PosProductEditModal } from '@/components/products/PosProductEditModal'
import { BackgroundProductEditModal, isBackgroundEditIntake } from '@/components/products/BackgroundProductEditModal'
import type { ProductEditIntakeData } from '@/lib/pos-products/background-edit'
import { ProductsSubnav } from '@/components/products/ProductsSubnav'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { BarcodeToggle } from '@/components/ui/BarcodeToggle'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  calculateTaxIncludedPrice,
  formatProductDateTime,
  formatYen,
  type ProductListRow,
} from '@/lib/products'
import { getProductStoreName } from '@/lib/productStores'

type ProductsBoardProps = {
  products: ProductListRow[]
  posEditorEnabled?: boolean
  posSaveEnabled?: boolean
  backgroundEditEnabled?: boolean
  selectedStoreId?: 6 | 7 | null
}

type DialogState = {
  product: ProductListRow
  nonce: number
  legacy?: boolean
} | null

export function ProductsBoard({ products: _initialProducts, posEditorEnabled = false, posSaveEnabled = false, backgroundEditEnabled = false, selectedStoreId = null }: ProductsBoardProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [searchRevision, setSearchRevision] = useState(0)
  const [backgroundEntries, setBackgroundEntries] = useState<Record<string, ProductEditIntakeData>>({})
  const [statusRevision, setStatusRevision] = useState(0)
  const previousStatus = useRef<Record<string, ProductEditIntakeData['status']>>({})
  const refreshedOperations = useRef(new Set<string>())
  const editingWithPos = posEditorEnabled || backgroundEditEnabled
  const statusTargets = JSON.stringify(results.filter(product => product.store_id === 6 || product.store_id === 7)
    .map(product => ({ store: product.store_id, id: product.id, jan: product.jan_code })))

  // 可視商品の状態だけを店舗別・100件以内で取得する。希望値はproductsへ混ぜない。
  useEffect(() => {
    if (!backgroundEditEnabled) return
    const targets = JSON.parse(statusTargets) as { store: 6 | 7; id: number; jan: string }[]
    if (!targets.length) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    async function refreshStatuses() {
      if (controller.signal.aborted || running || document.visibilityState === 'hidden') return
      running = true
      try {
        const rows: ProductEditIntakeData[] = []
        for (const store of [6, 7] as const) {
          const ids = targets.filter(target => target.store === store).map(target => target.id)
          for (let start = 0; start < ids.length; start += 100) {
            const batch = ids.slice(start, start + 100)
            const params = new URLSearchParams({ store: String(store), products: batch.join(',') })
            const response = await fetch(`/api/pos-products/background-edit?${params}`, { signal: controller.signal, cache: 'no-store' })
            const body = await response.json()
            if (!response.ok || body.success !== true || !Array.isArray(body.data)) throw new Error('受付状況を確認できません。')
            for (const data of body.data) {
              const target = targets.find(target => target.store === store && target.id === data?.productId)
              if (!target || !isBackgroundEditIntake(data, { storeId: store, productId: target.id, janCode: target.jan })) throw new Error('受付状況を確認できません。')
              rows.push(data)
            }
          }
        }
        if (controller.signal.aborted) return
        let completed = false
        for (const data of rows) {
          const previous = previousStatus.current[data.operationId]
          if (data.status === 'completed' && previous && previous !== 'completed' && !refreshedOperations.current.has(data.operationId)) {
            refreshedOperations.current.add(data.operationId); completed = true
          }
          previousStatus.current[data.operationId] = data.status
        }
        setBackgroundEntries(previous => {
          const next = { ...previous }
          for (const target of targets) delete next[`${target.store}:${target.id}`]
          for (const data of rows) next[`${data.storeId}:${data.productId}`] = data
          return next
        })
        if (completed) { router.refresh(); setSearchRevision(value => value + 1) }
        if (rows.some(data => data.status === 'queued' || data.status === 'working')) timer = setTimeout(() => void refreshStatuses(), 30_000)
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => void refreshStatuses(), 30_000)
      } finally { running = false }
    }
    function onVisible() {
      if (document.visibilityState === 'visible') { clearTimeout(timer); void refreshStatuses() }
    }
    void refreshStatuses()
    document.addEventListener('visibilitychange', onVisible)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [backgroundEditEnabled, statusTargets, statusRevision, query, includeInactive, router])

  function acceptEdit(data: ProductEditIntakeData) {
    // 受付ACK消失中に完了した操作も、同じIDの確認後に確定値を一度だけ再取得する。
    if (data.status === 'completed' && !refreshedOperations.current.has(data.operationId)) {
      refreshedOperations.current.add(data.operationId)
      router.refresh()
      setSearchRevision(value => value + 1)
    }
    previousStatus.current[data.operationId] = data.status
    setBackgroundEntries(previous => ({ ...previous, [`${data.storeId}:${data.productId}`]: data }))
    setStatusRevision(value => value + 1)
  }

  function hasLegacyPointer(product: ProductListRow) {
    try {
      return ['kennel-pos-edit-execution:v1', 'kennel-pos-edit-intent:v1', 'kennel-pos-edit-phase:v1']
        .some(prefix => window.sessionStorage.getItem(`${prefix}:${product.store_id}:${product.id}`) !== null)
    } catch { return true }
  }

  function backgroundStatus(product: ProductListRow) {
    const data = backgroundEditEnabled ? backgroundEntries[`${product.store_id}:${product.id}`] : undefined
    return data && ['queued', 'working', 'needs_review'].includes(data.status) ? data : undefined
  }

  // 300ms のデバウンス付きでサーバーサイド検索APIを呼び出す
  useEffect(() => {
    let active = true
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed })
        if (includeInactive) {
          params.set('includeInactive', 'true')
        }
        const res = await fetch(`/api/products/search?${params.toString()}`)
        if (res.ok) {
          const result = await res.json()
          if (active && result.success && Array.isArray(result.data)) {
            setResults(result.data)
          }
        }
      } catch (e) {
        console.error('商品検索エラー:', e)
      } finally {
        if (active) setLoading(false)
      }
    }, 300) // 300ms デバウンス

    return () => { active = false; clearTimeout(timer) }
  }, [includeInactive, query, searchRevision])

  const columns: DataTableColumn<ProductListRow>[] = [
    {
      key: 'jan_code',
      header: 'JAN',
      render: (product) => <BarcodeToggle janCode={product.jan_code} />,
    },
    {
      key: 'product_name',
      header: '商品情報',
      render: (product) => (
        <div className="min-w-[240px]">
          <p className="font-semibold text-gray-900">{product.product_name ?? '商品名未設定'}</p>
          {backgroundStatus(product) ? <div className="mt-2 space-y-1 text-xs">
            <StatusBadge variant={backgroundStatus(product)?.status === 'needs_review' ? 'warning' : 'info'}>
              {backgroundStatus(product)?.status === 'needs_review' ? '要確認' : '反映待ち'}
            </StatusBadge>
            <p role="status" className="text-pretty text-gray-600">{backgroundStatus(product)?.status === 'needs_review'
              ? backgroundStatus(product)?.message : '変更を受け付けました。POSへ反映中です。'}</p>
            <p className="text-pretty text-gray-600">反映予定：{Object.entries(backgroundStatus(product)!.patch).map(([field, value]) =>
              `${({ name: '商品名', price: '売価', cost: '原価' } as Record<string, string>)[field]} ${value}`).join(' / ')}</p>
          </div> : null}
          <p className="mt-1 text-xs text-gray-500">
            {product.category || 'カテゴリ未設定'}
            {product.product_group ? ` / ${product.product_group}` : ''}
            {product.brand ? ` / ${product.brand}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'pricing',
      header: '価格',
      render: (product) => (
        <div className="space-y-1 text-sm">
          <p className="text-gray-700">原価 {formatYen(product.cost_price)}</p>
          <p className="font-semibold text-gray-900">売価 {formatYen(product.selling_price)}</p>
          <p className="text-xs text-gray-500">
            税込 {formatYen(calculateTaxIncludedPrice(product.selling_price))}
          </p>
        </div>
      ),
      align: 'right',
    },
    {
      key: 'supplier_name',
      header: '仕入れ先',
      render: (product) => (
        <span className="text-sm font-medium text-gray-700">
          {product.supplier_name || '-'}
        </span>
      ),
    },
    {
      key: 'store_id',
      header: '店舗',
      render: (product) => (
        <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-700/10">
          {getProductStoreName(product.store_id)}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状態',
      align: 'center',
      render: (product) => (
        <StatusBadge variant={product.is_active ? 'success' : 'gray'}>
          {product.is_active ? '有効' : '停止'}
        </StatusBadge>
      ),
    },
    {
      key: 'updated_at',
      header: '更新日',
      render: (product) => formatProductDateTime(product.updated_at),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'center',
      render: (product) => (
        <button
          type="button"
          disabled={editingWithPos && (selectedStoreId === null || product.store_id !== selectedStoreId)}
          title={editingWithPos && (selectedStoreId === null || product.store_id !== selectedStoreId) ? '編集する店舗を一つ選択してください。' : undefined}
          onClick={() => {
            if (editingWithPos && (selectedStoreId === null || product.store_id !== selectedStoreId)) return
            setDialogState({
              product,
              nonce: Date.now(),
              legacy: backgroundEditEnabled && hasLegacyPointer(product),
            })
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SquarePen className="h-4 w-4" />
          {backgroundEditEnabled ? backgroundStatus(product) ? '受付内容' : '編集' : posEditorEnabled ? 'POS編集' : '編集'}
        </button>
      ),
    },
  ]

  return (
    <>
      <div className="space-y-6">
        <ProductsSubnav />
        {editingWithPos && selectedStoreId === null ? (
          <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            POS商品を編集する店舗を「本店のみ」または「わんわん」から選択してください。
          </p>
        ) : null}

        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-sky-700 px-6 py-7 text-white">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">商品マスタ</h1>
                <p className="mt-2 max-w-2xl text-sm text-sky-50/90">
                  本店・わんわんで分離された商品名、原価、売価を店舗ごとに検索・編集します。
                </p>
              </div>
              <div className="rounded-3xl bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100">
                  ヒット件数
                </p>
                <p className="mt-2 text-2xl font-bold">{results.length}</p>
                <p className="text-xs text-sky-50/90">現在表示中の商品数</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">商品を検索</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="商品名 / JAN / カテゴリ / ブランド を入力して検索"
                  className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-36 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {loading && (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-600 animate-pulse" />
                  )}
                  <JanCodeScannerField
                    buttonOnly={true}
                    wrapperClassName="shrink-0"
                    onValueChange={(value) => setQuery(value)}
                  />
                </div>
              </div>
            </label>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
              />
              停止商品も表示
            </label>
          </div>

          {query.trim() === '' ? (
            <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                <Search className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-gray-900">商品を検索してください</h2>
              <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
                上部の検索窓に「商品名」「JANコード」「カテゴリ」などを入力すると、データベースから高速に検索して結果を表示します。
              </p>
            </div>
          ) : (
            <DataTable
              data={results}
              columns={columns}
              keyExtractor={(product) => String(product.id)}
              emptyMessage={loading ? '検索中...' : '条件に一致する商品が見つかりませんでした。'}
            />
          )}
        </section>
      </div>

      {dialogState ? (
        editingWithPos ? (
          selectedStoreId !== null && dialogState.product.store_id === selectedStoreId ? (
            backgroundEditEnabled && !dialogState.legacy ? (
            <BackgroundProductEditModal
              key={`${dialogState.product.id}-${dialogState.nonce}`}
              product={dialogState.product}
              storeId={selectedStoreId}
              existingOperation={backgroundStatus(dialogState.product)}
              onAccepted={acceptEdit}
              onAbandoned={() => { router.refresh(); setSearchRevision(value => value + 1); setStatusRevision(value => value + 1) }}
              onClose={() => setDialogState(null)}
              onAdvanced={() => setDialogState(value => value ? { ...value, legacy: true } : null)}
            />
            ) : (
            <PosProductEditModal
              key={`${dialogState.product.id}-${dialogState.nonce}`}
              product={dialogState.product}
              storeId={selectedStoreId}
              savingEnabled={posSaveEnabled}
              onSaved={() => setSearchRevision(value => value + 1)}
              onClose={() => setDialogState(null)}
            />
            )
          ) : null
        ) : (
          <ProductFormModal
            key={`${dialogState.product.id}-${dialogState.nonce}`}
            open
            product={dialogState.product}
            onClose={() => setDialogState(null)}
          />
        )
      ) : null}
    </>
  )
}

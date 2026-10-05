'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { isProductSyncFailureCode, productSyncFailure } from '@/lib/product-sync/notifications'
import type { ProductSyncStoreResult } from '@/lib/product-sync/notifications'

// 商品マスタ同期ボタン
// POSポータルから商品マスタCSVをダウンロードし、Supabase productsテーブルに同期する
export function ProductMasterSyncButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [results, setResults] = useState<ProductSyncStoreResult[]>([])
  const [needsCheck, setNeedsCheck] = useState(false)

  async function handleSync() {
    setPending(true)
    setMessage('')
    setIsError(false)
    setResults([])

    try {
      const response = await fetch('/api/gas/sync-products', {
        method: 'POST',
      })

      const payload = (await response.json().catch(() => null)) as
        | { message?: string; success?: boolean; results?: ProductSyncStoreResult[] }
        | null

      const details = (Array.isArray(payload?.results) ? payload.results : []).flatMap(row => {
        if ((row.storeId !== 6 && row.storeId !== 7) || row.success || !isProductSyncFailureCode(row.code)) return []
        return [productSyncFailure({ id: row.storeId, name: row.storeId === 7 ? '本店' : 'わんわん' }, row.code)]
      })
      setResults(details)
      setIsError(!response.ok || payload?.success !== true)
      setNeedsCheck(details.some(row => row.outcome === 'unknown' || row.code === 'PRODUCT_SYNC_PENDING_SYNC') || (!response.ok && response.status >= 500 && !details.length))
      setMessage(payload?.message || '商品同期の結果を確認できません。再送せず、管理者に同期状態を確認してもらってください。')
      router.refresh()
    } catch {
      setIsError(true)
      setNeedsCheck(true)
      setMessage('商品同期の結果を確認できません。再送せず、管理者に同期状態を確認してもらってください。')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleSync}
        disabled={pending || needsCheck}
        className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:bg-indigo-50/50 disabled:text-indigo-400"
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {pending ? '同期中...' : needsCheck ? '同期状態の確認が必要' : '商品マスタ同期'}
      </button>

      {message ? (
        <p role={isError ? 'alert' : 'status'} className={`text-xs ${isError ? 'text-red-600' : 'text-emerald-600'}`}>{message}</p>
      ) : null}
      {results.map(result => <div key={result.storeId} role="alert" className="max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-semibold">{result.store}</p><p>{result.message}</p><p className="mt-1">次の対応: {result.nextStep}</p></div>)}
      {needsCheck ? <Link href="/products" className="text-xs text-indigo-700 underline">商品マスタ画面で同期状態・通知を確認</Link> : null}
    </div>
  )
}

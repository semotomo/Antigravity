'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, RefreshCw } from 'lucide-react'

// 商品マスタ同期ボタン
// POSポータルから商品マスタCSVをダウンロードし、Supabase productsテーブルに同期する
export function ProductMasterSyncButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  async function handleSync() {
    setPending(true)
    setMessage('')
    setIsError(false)

    try {
      const response = await fetch('/api/gas/sync-products', {
        method: 'POST',
      })

      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.message || '商品マスタの同期に失敗しました。')
      }

      setMessage(payload?.message || '商品マスタを同期しました。')
      router.refresh()
    } catch (error) {
      setIsError(true)
      setMessage(
        error instanceof Error ? error.message : '商品マスタの同期中にエラーが発生しました。'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleSync}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:bg-indigo-50/50 disabled:text-indigo-400"
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {pending ? '同期中...' : '商品マスタ同期'}
      </button>

      {message ? (
        <p className={`text-xs ${isError ? 'text-red-600' : 'text-emerald-600'}`}>{message}</p>
      ) : null}
    </div>
  )
}

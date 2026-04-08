'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, UploadCloud } from 'lucide-react'

export function SalesImportButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  async function handleImport() {
    setPending(true)
    setMessage('')
    setIsError(false)

    try {
      const response = await fetch('/api/gas/trigger', {
        method: 'POST',
      })

      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.message || '売上データの取込に失敗しました。')
      }

      setMessage(payload?.message || '売上データを取り込みました。')
      router.refresh()
    } catch (error) {
      setIsError(true)
      setMessage(
        error instanceof Error ? error.message : '売上データの取込中にエラーが発生しました。'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleImport}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {pending ? '取込中...' : '売上データ取込'}
      </button>

      {message ? (
        <p className={`text-xs ${isError ? 'text-red-600' : 'text-emerald-600'}`}>{message}</p>
      ) : null}
    </div>
  )
}

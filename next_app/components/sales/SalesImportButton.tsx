'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, UploadCloud, X } from 'lucide-react'

export function SalesImportButton() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1-12

  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)

  const years = [currentYear, currentYear - 1, currentYear - 2]
  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  async function handleImport() {
    setPending(true)
    setMessage('')
    setIsError(false)

    try {
      const response = await fetch('/api/gas/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ year, month }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.message || '売上データの取込に失敗しました。')
      }

      setMessage(payload?.message || '売上データを取り込みました。')
      setIsOpen(false) // 成功時はモーダルを閉じる
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
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen(true)
          setMessage('')
          setIsError(false)
        }}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        <UploadCloud className="h-4 w-4" />
        売上データ取込
      </button>

      {/* 完了・エラーメッセージ表示（ボタン下） */}
      {message && !isOpen ? (
        <p className={`absolute right-0 mt-1 whitespace-nowrap text-xs ${isError ? 'text-red-600' : 'text-emerald-600'} font-medium`}>
          {message}
        </p>
      ) : null}

      {/* ポップアップモーダル */}
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl transition-all">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-lg font-bold text-gray-900">売上データ取込 (月指定)</h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={pending}
                className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-500">
                指定された年月の商品別売上データをPOSから自動取得し、データベースに送信します。
              </p>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500">対象年</span>
                  <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    disabled={pending}
                    className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500">対象月</span>
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    disabled={pending}
                    className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {m}月
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* モーダル内のエラーメッセージ */}
            {message && isError ? (
              <p className="mt-3 text-xs text-red-600 font-medium bg-red-50 p-2.5 rounded-xl border border-red-100">
                {message}
              </p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={pending}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {pending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    取込中...
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" />
                    取込実行
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

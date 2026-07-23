'use client'

import { useState } from 'react'
import { Calendar, Loader2, RefreshCcw, X, Download } from 'lucide-react'

// Next.js API ルート経由でGASを呼び出すため、直接URLは不要

type HistoryRow = {
  productCode: string
  productName: string
  taskContent: string
  storeName: string
  taskDateTime: string
  quantity: number
  cost: number
  totalCost: number
}

export function SalesHistoryModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<HistoryRow[]>([])
  
  // デフォルトは今日
  const getToday = () => {
    const d = new Date()
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  }
  
  const [startDate, setStartDate] = useState(getToday())
  const [endDate, setEndDate] = useState(getToday())

  const [targetStore, setTargetStore] = useState<{ name: string; id: string } | null>(null)

  const fetchHistory = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const url = new URL('/api/gas/history', window.location.origin)
      url.searchParams.append('startDate', startDate)
      url.searchParams.append('endDate', endDate)

      const res = await fetch(url.toString(), {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }

      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        setData(json.data)
        if (json.targetStore) {
          setTargetStore(json.targetStore)
        }
      } else {
        throw new Error(json.message || 'データ取得に失敗しました。')
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : '予期せぬエラーが発生しました。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
      >
        <RefreshCcw className="h-4 w-4" />
        リアルタイム入出庫履歴
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-500" />
                入出庫履歴（リアルタイム）
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50 px-6 py-3">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-600">期間:</label>
                <input
                  type="text"
                  placeholder="yyyy/MM/dd"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
                <span>〜</span>
                <input
                  type="text"
                  placeholder="yyyy/MM/dd"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <button
                onClick={fetchHistory}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                データ取得
              </button>
              
              <div className="ml-auto flex items-center gap-3">
                {targetStore && (
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 border border-sky-200">
                    対象店舗: {targetStore.name} ({targetStore.id})
                  </span>
                )}
                {data.length > 0 && (
                  <span className="text-sm text-gray-500 font-medium">
                    {data.length} 件のデータ
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {error && (
                <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
                  {error}
                </div>
              )}

              {isLoading ? (
                <div className="flex h-64 flex-col items-center justify-center text-gray-500 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
                  <p>POSポータルからデータを取得しています。しばらくお待ちください...</p>
                </div>
              ) : data.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-50 text-gray-900 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 font-semibold min-w-[200px]">商品名</th>
                        <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">個数</th>
                        <th className="px-4 py-3 font-semibold whitespace-nowrap">コード</th>
                        <th className="px-4 py-3 font-semibold whitespace-nowrap">日時</th>
                        <th className="px-4 py-3 font-semibold whitespace-nowrap">作業内容</th>
                        <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">原価</th>
                        <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">原価合計</th>
                        <th className="px-4 py-3 font-semibold whitespace-nowrap">店舗</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {data.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-2 text-xs font-medium text-gray-900">{row.productName}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-right font-medium text-gray-900">{row.quantity}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-400">{row.productCode}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-xs">{row.taskDateTime}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-xs text-sky-700 font-medium">{row.taskContent}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-right text-xs">¥{row.cost.toLocaleString()}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-right text-xs font-medium">¥{row.totalCost.toLocaleString()}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-xs">{row.storeName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-gray-400">
                  「データ取得」ボタンをクリックして履歴を読み込んでください。
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

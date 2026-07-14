'use client'

import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

type TrendDataRow = {
  date: string
  fullDate: string
  quantity: number
  amount: number
}

type ProductSalesTrendsModalProps = {
  isOpen: boolean
  onClose: () => void
  janCode?: string | null
  productName: string
}

export function ProductSalesTrendsModal({
  isOpen,
  onClose,
  janCode,
  productName,
}: ProductSalesTrendsModalProps) {
  const [days, setDays] = useState<'7' | '30'>('30')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TrendDataRow[]>([])

  useEffect(() => {
    if (!isOpen) return

    const fetchTrends = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const url = new URL('/api/sales/trends', window.location.origin)
        if (janCode) {
          url.searchParams.append('janCode', janCode)
        } else {
          url.searchParams.append('productName', productName)
        }
        url.searchParams.append('days', days)

        const res = await fetch(url.toString())
        if (!res.ok) {
          throw new Error('売上推移データの取得に失敗しました。')
        }
        const result = await res.json()
        if (result.success && Array.isArray(result.data)) {
          setData(result.data)
        } else {
          throw new Error(result.error || 'データ形式が不正です。')
        }
      } catch (err: any) {
        console.error(err)
        setError(err.message || '予期せぬエラーが発生しました。')
      } finally {
        setIsLoading(false)
      }
    }

    fetchTrends()
  }, [isOpen, janCode, productName, days])

  if (!isOpen) return null

  // 指標の計算
  const totalQty = data.reduce((sum, r) => sum + r.quantity, 0)
  const totalAmount = data.reduce((sum, r) => sum + r.amount, 0)
  const avgQty = data.length > 0 ? (totalQty / data.length).toFixed(1) : '0.0'

  const formatYen = (val: number) => `¥${val.toLocaleString('ja-JP')}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col rounded-3xl bg-white shadow-xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{productName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              JAN: {janCode || '未登録'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 期間コントロールタブと主要指標 (KPI) */}
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex rounded-xl bg-white p-1 border border-gray-200 self-start">
            <button
              onClick={() => setDays('30')}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                days === '30' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              過去30日間
            </button>
            <button
              onClick={() => setDays('7')}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                days === '7' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              過去7日間
            </button>
          </div>

          {/* 指標グリッド */}
          <div className="grid grid-cols-3 gap-6">
            <div className="text-left">
              <span className="text-[10px] font-bold text-gray-400 block tracking-wider uppercase">期間販売数</span>
              <span className="text-lg font-extrabold text-gray-950 mt-0.5 block">{totalQty.toLocaleString('ja-JP')} <span className="text-xs font-medium text-gray-500">個</span></span>
            </div>
            <div className="text-left">
              <span className="text-[10px] font-bold text-gray-400 block tracking-wider uppercase">期間売上高</span>
              <span className="text-lg font-extrabold text-gray-950 mt-0.5 block">{formatYen(totalAmount)}</span>
            </div>
            <div className="text-left">
              <span className="text-[10px] font-bold text-gray-400 block tracking-wider uppercase">1日平均</span>
              <span className="text-lg font-extrabold text-gray-950 mt-0.5 block">{avgQty} <span className="text-xs font-medium text-gray-500">個</span></span>
            </div>
          </div>
        </div>

        {/* メインのグラフ領域 */}
        <div className="flex-1 overflow-auto p-6 flex flex-col justify-center">
          {error && (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center text-gray-400 gap-3 py-20">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              <p className="text-xs">売上データを集計しています...</p>
            </div>
          ) : data.length > 0 ? (
            <div className="w-full h-80 flex flex-col justify-between">
              <div className="mb-2">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">売上個数 推移グラフ</h4>
              </div>
              <div className="w-full h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorQty" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                    />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload as TrendDataRow
                          return (
                            <div className="rounded-2xl border border-gray-100 bg-white/95 p-3 shadow-xl backdrop-blur-sm text-xs">
                              <p className="font-bold text-gray-900">{item.fullDate}</p>
                              <div className="mt-1.5 space-y-0.5 text-gray-600">
                                <p>販売数量: <span className="font-bold text-indigo-600">{item.quantity} 個</span></p>
                                <p>売上金額: <span className="font-bold text-gray-900">{formatYen(item.amount)}</span></p>
                              </div>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="quantity"
                      stroke="#4f46e5"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorQty)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 text-sm">
              過去の売上データが存在しません。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

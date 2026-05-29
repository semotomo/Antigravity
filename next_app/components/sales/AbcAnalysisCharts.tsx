'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts'
import type { AbcAnalysisRow } from '@/lib/queries/abc'

type AbcAnalysisChartsProps = {
  data: AbcAnalysisRow[]
}

const COLORS = {
  A: '#10B981', // Emerald (Aランク)
  B: '#0284C7', // Sky (Bランク)
  C: '#F97316', // Orange (Cランク)
}

function formatYen(value: number) {
  return `¥${value.toLocaleString('ja-JP')}`
}

export function AbcAnalysisCharts({ data }: AbcAnalysisChartsProps) {
  const [isMounted, setIsMounted] = useState(false)

  // Next.js (SSR) での Recharts のハイドレーションエラーを確実に防止する安全設計
  useEffect(() => {
    setIsMounted(true)
  }, [])

  if (!isMounted) {
    return (
      <div className="flex h-96 w-full items-center justify-center rounded-3xl border border-gray-200 bg-white text-sm text-gray-500 shadow-sm animate-pulse">
        グラフデータを読み込み中...
      </div>
    )
  }

  // 1. 売上貢献度 TOP15 商品の抽出
  const top15 = [...data]
    .sort((a, b) => b.total_sales_amount - a.total_sales_amount)
    .slice(0, 15)

  // 2. ランク別売上シェアの算出
  const rankSummary = {
    A: { name: 'Aランク', value: 0, color: COLORS.A },
    B: { name: 'Bランク', value: 0, color: COLORS.B },
    C: { name: 'Cランク', value: 0, color: COLORS.C },
  }

  let totalSales = 0
  let totalProfit = 0
  data.forEach((row) => {
    totalSales += row.total_sales_amount
    totalProfit += row.estimated_profit
    if (row.rank === 'A' || row.rank === 'B' || row.rank === 'C') {
      rankSummary[row.rank].value += row.total_sales_amount
    }
  })

  const pieData = Object.values(rankSummary).filter((item) => item.value > 0)

  // カスタムツールチップ (BarChart用)
  const CustomBarTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload as AbcAnalysisRow
      return (
        <div className="rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
          <p className="font-bold text-gray-900 text-sm max-w-[240px] truncate">{item.label}</p>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">ランク:</span>
              <span
                className="font-bold"
                style={{ color: COLORS[item.rank as keyof typeof COLORS] }}
              >
                {item.rank}ランク
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">売上金額:</span>
              <span className="font-semibold text-gray-900">{formatYen(item.total_sales_amount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">販売数量:</span>
              <span className="font-semibold text-gray-700">{item.total_quantity.toLocaleString('ja-JP')} 個</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">粗利見込:</span>
              <span className="font-semibold text-green-600">{formatYen(item.estimated_profit)}</span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  // カスタムツールチップ (PieChart用)
  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0]
      const share = totalSales > 0 ? (item.value / totalSales) * 100 : 0
      return (
        <div className="rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
          <p className="font-bold text-gray-900 text-sm">{item.name}</p>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">売上総額:</span>
              <span className="font-bold text-gray-900">{formatYen(item.value)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">売上シェア:</span>
              <span className="font-bold text-sky-600">{share.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr,0.7fr]">
      {/* 1. 売上貢献度 TOP15 横棒グラフ */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
        <div className="mb-4">
          <h3 className="text-base font-bold text-gray-900">売上高 TOP 15 商品</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            選択した期間・店舗において売上が最も高かった上位15商品の売上規模とランク別分布です。
          </p>
        </div>
        <div className="relative w-full h-[400px]">
          {top15.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
              データがありません
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={top15}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E5E7EB" />
                <XAxis
                  type="number"
                  tickFormatter={(val) => `¥${(val / 1000).toLocaleString('ja-JP')}k`}
                  tick={{ fill: '#6B7280', fontSize: 10 }}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  dataKey="label"
                  type="category"
                  width={140}
                  tickFormatter={(val) => (val.length > 16 ? `${val.slice(0, 15)}...` : val)}
                  tick={{ fill: '#374151', fontSize: 10, fontWeight: 500 }}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#F3F4F6', opacity: 0.6 }} />
                <Bar dataKey="total_sales_amount" radius={[0, 8, 8, 0]} barSize={16}>
                  {top15.map((entry, index) => {
                    const color = COLORS[entry.rank as keyof typeof COLORS] || COLORS.C
                    return <Cell key={`cell-${index}`} fill={color} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. ランク別売上シェア ドーナツチャート */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col justify-between">
        <div className="mb-4">
          <h3 className="text-base font-bold text-gray-900">ランク別売上シェア</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            A・B・C各ランクの総売上高に対する貢献度比率です。
          </p>
        </div>

        <div className="relative w-full h-[260px] flex items-center justify-center">
          {pieData.length === 0 ? (
            <div className="text-sm text-gray-400">データがありません</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={75}
                    outerRadius={95}
                    paddingAngle={3}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span className="text-xs font-semibold text-gray-600">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* ドーナツの中央に総売上をリッチに表示 */}
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">総売上高</span>
                <span className="mt-0.5 text-lg font-extrabold text-gray-900">
                  {formatYen(totalSales)}
                </span>
                <span className="mt-0.5 text-[9px] font-medium text-green-600">
                  粗利 {formatYen(totalProfit)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* 補足解説カード */}
        <div className="mt-6 rounded-2xl bg-gray-50 p-4 border border-gray-100">
          <h4 className="text-xs font-bold text-gray-800">💡 ABC分析の豆知識</h4>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            売上の大部分（約70〜80%）は、上位の一部商品（Aランク、約20%）によって生み出されます。Aランク商品の欠品は売上損失に直結するため、最優先で在庫を確保しましょう。
          </p>
        </div>
      </div>
    </div>
  )
}

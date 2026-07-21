'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
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
  target?: 'amount' | 'quantity'
}

const COLORS = {
  A: '#10B981', // Emerald (Aランク)
  B: '#0284C7', // Sky (Bランク)
  C: '#F97316', // Orange (Cランク)
}

function formatYen(value: number) {
  return `¥${value.toLocaleString('ja-JP')}`
}

export function AbcAnalysisCharts({ data, target = 'quantity' }: AbcAnalysisChartsProps) {
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

  const isAmount = target === 'amount'

  // 1. 貢献度 TOP15 商品の抽出 (金額か数量かに基づくソート)
  const top15 = [...data]
    .sort((a, b) => {
      if (isAmount) {
        return b.total_sales_amount - a.total_sales_amount
      } else {
        return b.total_quantity - a.total_quantity
      }
    })
    .slice(0, 15)

  // 2. カテゴリ別シェアの算出 (金額か数量かに基づく集計)
  const categoryValueMap = new Map<string, number>()
  let totalAggregate = 0
  let totalProfit = 0

  data.forEach((row) => {
    const val = isAmount ? row.total_sales_amount : row.total_quantity
    totalAggregate += val
    totalProfit += row.estimated_profit
    const cat = row.category || '未分類'
    categoryValueMap.set(cat, (categoryValueMap.get(cat) ?? 0) + val)
  })

  // 配列化して値順にソート
  const sortedCategories = Array.from(categoryValueMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  // 主要カテゴリ上位5件を抽出し、残りは「その他」にまとめる
  const maxCategories = 5
  let pieData: Array<{ name: string; value: number; color: string }> = []
  
  const categoryColors = [
    '#10B981', // Emerald
    '#0284C7', // Sky / Blue
    '#EC4899', // Pink
    '#F59E0B', // Amber
    '#8B5CF6', // Purple
    '#9CA3AF', // Gray (その他)
  ]

  if (sortedCategories.length <= maxCategories) {
    pieData = sortedCategories.map((item, idx) => ({
      name: item.name,
      value: item.value,
      color: categoryColors[idx % categoryColors.length],
    }))
  } else {
    const topCategories = sortedCategories.slice(0, maxCategories - 1)
    const othersValue = sortedCategories.slice(maxCategories - 1).reduce((sum, item) => sum + item.value, 0)
    
    pieData = topCategories.map((item, idx) => ({
      name: item.name,
      value: item.value,
      color: categoryColors[idx % categoryColors.length],
    }))
    
    pieData.push({
      name: 'その他',
      value: othersValue,
      color: categoryColors[maxCategories - 1],
    })
  }

  // カスタムツールチップ (ComposedChart/Pareto用)
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
            <div className={`flex justify-between gap-4 ${isAmount ? 'bg-indigo-50/50 p-1 rounded font-bold' : ''}`}>
              <span className="text-gray-500">売上金額:</span>
              <span className="font-semibold text-gray-900">{formatYen(item.total_sales_amount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">累積構成比:</span>
              <span className="font-semibold text-indigo-600">{(item.cumulativeSalesShare * 100).toFixed(1)}%</span>
            </div>
            <div className={`flex justify-between gap-4 ${!isAmount ? 'bg-indigo-50/50 p-1 rounded font-bold' : ''}`}>
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
      const share = totalAggregate > 0 ? (item.value / totalAggregate) * 100 : 0
      return (
        <div className="rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
          <p className="font-bold text-gray-900 text-sm">{item.name}</p>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">{isAmount ? '売上総額' : '販売総数'}:</span>
              <span className="font-bold text-gray-900">
                {isAmount ? formatYen(item.value) : `${item.value.toLocaleString('ja-JP')} 個`}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">構成シェア:</span>
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
      {/* 1. 貢献度 TOP15 パレート図 */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-gray-900">
              {isAmount ? '売上高パレート図' : '販売数パレート図'} (TOP 15 商品)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              各商品の{isAmount ? '売上高' : '販売数量'}（棒グラフ：左軸）と累積構成比（折れ線グラフ：右軸）を重ね合わせた図です。
            </p>
          </div>
        </div>
        <div className="relative w-full h-[400px]">
          {top15.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
              データがありません
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={top15}
                margin={{ top: 15, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis
                  dataKey="label"
                  tickFormatter={(val) => (val.length > 10 ? `${val.slice(0, 9)}...` : val)}
                  tick={{ fill: '#374151', fontSize: 9, fontWeight: 500 }}
                  axisLine={{ stroke: '#E5E7EB' }}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                {/* 左軸：売上金額または数量 */}
                <YAxis
                  yAxisId="left"
                  type="number"
                  tickFormatter={(val) => 
                    isAmount 
                      ? `¥${(val / 1000).toLocaleString('ja-JP')}k` 
                      : `${val.toLocaleString('ja-JP')}個`
                  }
                  tick={{ fill: '#6B7280', fontSize: 9 }}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                {/* 右軸：累積構成比 */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(val) => `${(val * 100).toFixed(0)}%`}
                  tick={{ fill: '#8B5CF6', fontSize: 9 }}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#F3F4F6', opacity: 0.6 }} />
                
                {/* 棒グラフ */}
                <Bar yAxisId="left" dataKey={isAmount ? 'total_sales_amount' : 'total_quantity'} radius={[6, 6, 0, 0]} barSize={24}>
                  {top15.map((entry, index) => {
                    const color = COLORS[entry.rank as keyof typeof COLORS] || COLORS.C
                    return <Cell key={`cell-${index}`} fill={color} />
                  })}
                </Bar>

                {/* 累積構成比の折れ線グラフ */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulativeSalesShare"
                  stroke="#8B5CF6"
                  strokeWidth={3}
                  dot={{ r: 3, fill: '#8B5CF6', strokeWidth: 1 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. カテゴリ別シェア ドーナツチャート */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col justify-between">
        <div className="mb-4">
          <h3 className="text-base font-bold text-gray-900">
            {isAmount ? 'カテゴリ別売上シェア' : 'カテゴリ別販売数シェア'}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            各商品カテゴリの総{isAmount ? '売上高' : '販売数'}に対する貢献度比率です（上位順）。
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
              {/* ドーナツの中央に総数をリッチに表示 */}
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {isAmount ? '総売上高' : '総販売数量'}
                </span>
                <span className="mt-0.5 text-lg font-extrabold text-gray-900">
                  {isAmount ? formatYen(totalAggregate) : `${totalAggregate.toLocaleString('ja-JP')} 個`}
                </span>
                <span className="mt-0.5 text-[9px] font-medium text-green-600">
                  粗利見込 {formatYen(totalProfit)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* 補足解説カード */}
        <div className="mt-6 rounded-2xl bg-gray-50 p-4 border border-gray-100">
          <h4 className="text-xs font-bold text-gray-800">💡 シェアについて</h4>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            どのカテゴリ群が店舗の主力事業（数量・金額ベース）になっているかを可視化しています。
            {isAmount 
              ? '金額ベースで高いシェアを持つカテゴリは店舗の収益基盤となるため、品揃えに注意しましょう。' 
              : '数量ベースで高いシェアを持つカテゴリは顧客の来店・購買頻度が高いため、欠品を起こさないよう管理しましょう。'}
          </p>
        </div>
      </div>
    </div>
  )
}

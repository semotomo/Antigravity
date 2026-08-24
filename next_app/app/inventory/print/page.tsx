import type { Metadata } from 'next'
import Link from 'next/link'

import { requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { getInventoryPrintData } from '@/lib/inventory/management'
import { getProductStoreName } from '@/lib/productStores'
import { createClient } from '@/lib/supabase/server'
import { PrintToolbar } from './PrintToolbar'
import './print.css'

export const metadata: Metadata = { title: '棚卸し印刷 | Kennel Dashboard' }

type PrintParams = { [key: string]: string | string[] | undefined }

function param(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

function quantity(value: number | null) {
  return value === null ? '未入力' : value.toLocaleString('ja-JP', { maximumFractionDigits: 3 })
}

export default async function InventoryPrintPage({ searchParams }: { searchParams: Promise<PrintParams> }) {
  const resolved = await searchParams
  const storeValue = Number(param(resolved.store))
  if (storeValue !== 6 && storeValue !== 7) throw new Error('印刷対象店舗が不正です。')
  const storeId: 6 | 7 = storeValue
  const mode = param(resolved.mode) === 'result' ? 'result' : 'blank'
  const sortValue = param(resolved.sort)
  const sort = sortValue === 'name' ? 'name' : 'category'
  const sessionId = param(resolved.session) || null

  const supabase = await createClient()
  await requireInventoryStoreAccess(supabase, storeId)
  const data = await getInventoryPrintData(supabase, { storeId, sessionId, mode, sort })
  const isCalculated = mode === 'result' && data.status === 'finalized'
  const title = mode === 'blank'
    ? '棚卸し記入用リスト'
    : isCalculated ? '計算済み結果リスト' : '入力済み数量リスト'
  const baseParams = `store=${storeId}&session=${data.sessionId}&mode=${mode}`
  const csvHref = `/api/inventory/export?${baseParams}&sort=${sort}`

  return (
    <main className={`print-page ${mode === 'result' ? 'result-mode' : 'blank-mode'}`}>
      <PrintToolbar csvHref={csvHref} />
      <nav className="sort-links" aria-label="印刷の並び順">
        <span>並び順:</span>
        {([['category', 'カテゴリ'], ['name', '商品名']] as const).map(([value, label]) => (
          <Link key={value} className={sort === value ? 'active' : ''} href={`/inventory/print?${baseParams}&sort=${value}`}>{label}</Link>
        ))}
      </nav>

      <header className="print-header">
        <div>
          <h1>{title}</h1>
          <p>{getProductStoreName(storeId)} / 棚卸し日 {formatDate(data.startedAt)}</p>
        </div>
        <div className="summary">全 {data.items.length.toLocaleString('ja-JP')} 商品</div>
      </header>

      <table>
        <thead>
          <tr>
            <th className="jan">JAN</th>
            <th className="product">商品名</th>
            <th className="category">カテゴリ</th>
            {mode === 'blank' ? <th className="entry">数量記入欄</th> : null}
            {mode === 'result' && !isCalculated ? <th className="number">入力数量</th> : null}
            {isCalculated ? <>
              <th className="number">実在庫</th><th className="number">販売</th><th className="number">返品</th>
              <th className="number">移動入</th><th className="number">移動出</th><th className="number">使用</th>
              <th className="number">調整</th><th className="number">現在庫</th>
            </> : null}
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={`${item.janCode}:${item.productName}`} className={`${item.calculatedQuantity !== null && item.calculatedQuantity < 0 ? 'negative' : ''} ${item.isLargeAdjustment ? 'large-difference' : ''}`}>
              <td className="jan">{item.janCode}</td>
              <td className="product">{item.productName}{!item.isActive ? <span className="status">停止</span> : null}{item.excluded ? <span className="status">除外</span> : null}</td>
              <td className="category">{item.category || ''}</td>
              {mode === 'blank' ? <td className="entry" aria-label="数量記入欄">&nbsp;</td> : null}
              {mode === 'result' && !isCalculated ? <td className="number">{quantity(item.countedQuantity)}</td> : null}
              {isCalculated ? <>
                <td className="number">{quantity(item.physicalQuantity)}</td>
                <td className="number">{quantity(item.salesQuantity)}</td>
                <td className="number">{quantity(item.returnQuantity)}</td>
                <td className="number">{quantity(item.transferInQuantity)}</td>
                <td className="number">{quantity(item.transferOutQuantity)}</td>
                <td className="number">{quantity(item.usageQuantity)}</td>
                <td className="number">{quantity(item.adjustmentDelta)}</td>
                <td className="number current">{quantity(item.calculatedQuantity)}</td>
              </> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

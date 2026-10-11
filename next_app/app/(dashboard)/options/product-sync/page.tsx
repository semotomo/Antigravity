import Link from 'next/link'
import { ProductSyncNotifications } from '@/components/products/ProductSyncNotifications'

export const metadata = { title: '商品同期管理 | Kennel Dashboard' }

export default function ProductSyncManagementPage() {
  // 各取得Actionで本人とDBのmanager権限を確認し、管理店舗だけを表示する。
  return <div className="mx-auto max-w-5xl space-y-5 py-4">
    <div>
      <h1 className="text-balance text-2xl font-bold text-slate-900">商品同期管理</h1>
      <p className="mt-2 text-pretty text-sm text-slate-600">商品マスタ全体の同期と実行記録を管理します。個別の商品編集・売上・入出庫履歴の取得とは別の設定です。</p>
    </div>
    <ProductSyncNotifications storeId={null} />
    <Link href="/products" className="inline-block text-sm text-indigo-700 underline">商品一覧へ戻る</Link>
  </div>
}

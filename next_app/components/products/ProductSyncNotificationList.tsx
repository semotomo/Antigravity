import type { ProductSyncNotification } from '@/lib/product-sync/notifications'

const formatDate = (value: string) => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(value))

export function ProductSyncNotificationList({ notifications, unresolvedCount }: { notifications: ProductSyncNotification[]; unresolvedCount: number }) {
  if (!notifications.length) return null
  return (
    <section aria-label="商品マスタ同期の通知" className="mb-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-800">商品マスタ同期の通知</h2>
      {notifications.some(notice => !notice.resolvedAt && notice.outcome === 'unknown') ? <p className="text-sm text-slate-600">この画面を再表示すると、商品を送信せずに前回の同期状態を確認します。</p> : null}
      {unresolvedCount > 50 ? <p className="text-sm text-amber-900">未解消の通知が{unresolvedCount}件あります。最新50件を表示しています。</p> : null}
      {notifications.map(notice => (
        <div key={notice.id} role={notice.resolvedAt ? 'status' : 'alert'} className={`rounded-xl border p-3 text-sm ${notice.resolvedAt ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
          <p className="font-semibold">{notice.store} · {notice.source === 'cron' ? '自動同期' : notice.source === 'manual' ? '手動同期' : '状態確認で検出'} · {formatDate(notice.createdAt)} · {notice.resolvedAt ? notice.resolutionOutcome === 'rejected' ? '未適用確認済み' : '適用確認済み' : notice.outcome === 'unknown' ? '結果確認が必要' : '同期を拒否'}</p>
          <p className="mt-1">{notice.resolvedAt ? '当時の通知: ' : ''}{notice.message}</p>
          {notice.resolvedAt ? <p className="mt-1">{formatDate(notice.resolvedAt)}に{notice.resolutionOutcome === 'rejected' ? '前回の同期が未適用で、今後も適用されない状態' : notice.outcome === 'unknown' ? '同じ同期の適用済み状態' : '後続の同期成功'}を確認しました。以前の失敗記録は保持しています。</p> :
            <p className="mt-1">次の対応: {notice.nextStep}</p>}
        </div>
      ))}
    </section>
  )
}

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PosProductEditModal } from '@/components/products/PosProductEditModal'
import type { ProductListRow } from '@/lib/products'
import { configurePreviewScenario, type PreviewScenario } from './mock-actions'

const PRODUCT = {
  id: 90001, store_id: 7, jan_code: '0000000000000', product_name: '合成テスト商品',
  cost_price: 75, selling_price: 126, category: '合成分類', markup_rate: null,
  product_group: '合成グループA', brand: null, is_active: true, supplier_name: '合成仕入先A',
  updated_at: '2026-10-03T00:00:00Z', tags: '本店',
} as ProductListRow

function Preview() {
  const [scenario, setScenario] = useState<PreviewScenario>('normal')
  const [open, setOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [newSaveEnabled, setNewSaveEnabled] = useState(true)
  const savingEnabled = !['normal', 'network-error', 'conflict'].includes(scenario)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 text-gray-900">
      <h1 className="text-balance text-2xl font-bold">POS商品編集の表示検証</h1>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">検証用・合成データ・本番非接続</p>
      <p className="text-pretty text-sm text-gray-600">シナリオを選び、モーダルを開いて「POSから読み込む」から操作してください。保存シナリオも合成状態だけで動き、本番には接続しません。未完了操作は開き直しても同じIDで復旧確認します。ページ全体の再読込では合成サーバー状態は失われるため、復旧失敗と入力凍結を確認できます。</p>
      <label className="block space-y-2">
        <span className="text-sm font-medium">検証シナリオ</span>
        <select value={scenario} disabled={open} onChange={event => setScenario(event.target.value as PreviewScenario)} className="w-full rounded-xl border border-gray-300 p-3 focus:outline-2 focus:outline-sky-600">
          <option value="normal">正常：読込 → 編集 → 変更確認</option>
          <option value="network-error">通信失敗：読込成功 → 変更確認失敗</option>
          <option value="conflict">競合：変更確認失敗 → 再取得で最新値表示</option>
          <option value="save-normal">合成保存：確認 → 明示保存 → 照合・DB反映完了</option>
          <option value="prepare-response-lost">準備応答消失：入力固定 → 状態確認 → 同じ操作で続行</option>
          <option value="prepare-before-ledger">RPC前の準備失敗：固定入力で準備だけ再試行</option>
          <option value="prepare-unregistered">dispatch未登録：固定入力で準備だけ再試行</option>
          <option value="save-response-lost">保存応答消失：状態確認 → POS結果照合（再送なし）</option>
          <option value="db-pending">DB反映待ち：POS確認済み → DB反映だけ再開</option>
          <option value="save-rejected">送信前拒否：拒否確定 → 明示close → 最新値から再編集</option>
          <option value="prepared-expired">準備期限切れ：未送信取消 → 明示close → 再読込</option>
          <option value="cancel-response-lost">取消応答消失：storage保持 → 読取り確認 → 明示解除</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={newSaveEnabled} disabled={open} onChange={event => setNewSaveEnabled(event.target.checked)} />
        新規の合成POS送信を有効にする（OFFでも既存操作の照合・DB復旧は許可）
      </label>
      <button type="button" disabled={open} className="rounded-xl bg-sky-700 px-4 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50" onClick={() => {
        configurePreviewScenario(scenario)
        setCompleted(false)
        setNonce(value => value + 1)
        setOpen(true)
      }}>検証モーダルを開く</button>
      {completed ? <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">合成の完了通知を受信しました。本番の更新はありません。</p> : null}
      {open ? <PosProductEditModal key={nonce} product={PRODUCT} storeId={7} savingEnabled={savingEnabled && newSaveEnabled} onSaved={() => setCompleted(true)} onClose={() => setOpen(false)} /> : null}
    </main>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Preview container is missing')
createRoot(container).render(<Preview />)

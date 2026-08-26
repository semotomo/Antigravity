import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('棚卸し同期は既存GAS設定名を優先し、旧誤設定名も移行互換として扱う', () => {
  const service = source('next_app/lib/inventory/recalculationService.ts')

  assert.match(service, /process\.env\.GAS_WEBAPP_URL/)
  assert.match(service, /process\.env\.GAS_WEB_APP_URL/)
  assert.match(service, /GAS_WEBAPP_URLが設定されていません/)
})

test('POS同期失敗は入力数量を保持したまま段階別メッセージを返す', () => {
  const service = source('next_app/lib/inventory/recalculationService.ts')
  const actions = source('next_app/app/actions/inventory.ts')

  assert.match(service, /class InventorySynchronizationError/)
  assert.match(service, /入力済みの棚卸し数量は保存されています/)
  assert.match(service, /POS履歴の取得/)
  assert.match(service, /POS snapshotの保存/)
  assert.match(service, /確定前チェック/)
  assert.match(actions, /error instanceof InventorySynchronizationError/)
})

test('確定前チェックはDB進捗だけを確認し、GAS/POS履歴を取得しない', () => {
  const actions = source('next_app/app/actions/inventory.ts')
  const reviewAction = actions.match(
    /export async function prepareInventoryFinalizationAction[\s\S]*?\n}\n\nexport async function finalizeInventorySessionAction/,
  )?.[0] ?? ''

  assert.match(reviewAction, /getInventoryFinalizationReadiness/)
  assert.doesNotMatch(reviewAction, /await prepareInventoryFinalization\(/)
  assert.doesNotMatch(reviewAction, /fetchGasHistoryRows|createInventoryPosSnapshot/)
})

test('実確定時に最新POS履歴を1回取得し、同じsnapshotで確定する', () => {
  const actions = source('next_app/app/actions/inventory.ts')
  const board = source('next_app/components/inventory/InventoryBoard.tsx')
  const finalizeAction = actions.match(
    /export async function finalizeInventorySessionAction[\s\S]*?\n}\n\nexport async function correctFinalizedInventoryCountAction/,
  )?.[0] ?? ''
  const finalizeClient = board.match(
    /const finalizeSession = async \(\) => \{[\s\S]*?\n  }\n\n  const handleSave/,
  )?.[0] ?? ''

  assert.match(finalizeAction, /const review = await prepareInventoryFinalization/)
  assert.match(finalizeAction, /if \(!review\.canFinalize\)/)
  assert.match(finalizeAction, /snapshotId: review\.snapshotId/)
  assert.match(finalizeAction, /calculatedAsOf: review\.calculatedAsOf/)
  assert.match(finalizeAction, /const finalization = await finalizeInventorySession/)
  assert.equal((finalizeAction.match(/prepareInventoryFinalization/g) ?? []).length, 1)
  assert.doesNotMatch(finalizeAction, /recalculateInventorySession/)
  assert.match(finalizeAction, /status: 'finalized'/)
  assert.match(finalizeClient, /await finalizeInventorySessionAction/)
  assert.doesNotMatch(finalizeClient, /refreshInventoryBalanceAction/)
  assert.doesNotMatch(finalizeClient, /syncWarning/)
})

test('数量保存中は確定前チェックを開始せず、確定中のPOS取得を利用者へ明示する', () => {
  const board = source('next_app/components/inventory/InventoryBoard.tsx')
  const dialog = source('next_app/components/inventory/InventoryFinalizeDialog.tsx')
  const page = source('next_app/app/(dashboard)/inventory/page.tsx')

  assert.match(board, /const finalizationPending = finalizing \|\| savingItemId !== null/)
  assert.match(board, /disabled=\{finalizationPending\}/)
  assert.match(board, /inventory-finalization-notice/)
  assert.match(board, /最新の販売・返品履歴を反映して棚卸しを確定しました/)
  assert.match(dialog, /確定前チェックではPOSへ接続しません/)
  assert.match(dialog, /確定時に最新の販売・返品履歴を取得/)
  assert.match(page, /export const maxDuration = 300/)
})

test('再同期は差分加減算ではなくcounted_at以降の全量再集計とbalance上書きを維持する', () => {
  const migration = source('supabase/migrations/20260823223000_inventory_phase2_recalc_lint_fix.sql')

  assert.match(migration, /pos\.event_at > item\.counted_at/i)
  assert.match(migration, /INSERT INTO public\.inventory_balances/i)
  assert.match(migration, /ON CONFLICT \(store_id, product_id\) DO UPDATE/i)
  assert.doesNotMatch(migration, /calculated_quantity\s*=\s*inventory_balances\.calculated_quantity\s*[-+]/i)
})

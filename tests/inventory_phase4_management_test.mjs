import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const migrationPath = 'supabase/migrations/20260824090000_inventory_phase4_management.sql'

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('商品停止RPCはmanager・store_id + JAN・理由を強制し、POS同期より手動停止を優先する', () => {
  const migration = source(migrationPath)
  const productAction = source('next_app/app/actions/products.ts')

  assert.match(migration, /inventory_product_status_changes/i)
  assert.match(migration, /manually_inactive/i)
  assert.match(migration, /FUNCTION public\.set_inventory_product_status/i)
  assert.match(migration, /private\.can_access_store\([\s\S]*ARRAY\['manager'\]/i)
  assert.match(migration, /product\.store_id = p_store_id[\s\S]*product\.jan_code = BTRIM\(p_jan_code\)/i)
  assert.match(migration, /BTRIM\(p_reason\)[\s\S]*RAISE EXCEPTION/i)
  assert.match(migration, /enforce_inventory_manual_inactive/i)
  assert.match(migration, /INSERT INTO public\.inventory_product_status_changes/i)
  assert.match(productAction, /delete updatePayload\.is_active/i)
})

test('停止監査はappend-onlyかつ店舗RLSで、停止商品も棚卸し明細から削除しない', () => {
  const migration = source(migrationPath)

  assert.match(migration, /prevent_inventory_product_status_changes_mutation/i)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /private\.can_access_store\(store_id\)/i)
  assert.doesNotMatch(migration, /DELETE FROM public\.inventory_session_items/i)
})

test('確定前previewは残高を更新せず、確定・除外・訂正・調整は認証付きRPCで提供する', () => {
  const migration = source(migrationPath)

  assert.match(migration, /FUNCTION public\.preview_inventory_finalization/i)
  const previewBody = migration.match(/FUNCTION public\.preview_inventory_finalization[\s\S]*?\$\$;/i)?.[0] ?? ''
  assert.doesNotMatch(previewBody, /INSERT INTO public\.inventory_balances|UPDATE public\.inventory_balances|DELETE FROM public\.inventory_balances/i)
  for (const functionName of [
    'set_inventory_item_exclusion',
    'correct_finalized_inventory_count',
    'add_inventory_adjustment',
    'get_inventory_overview',
    'get_inventory_print_data',
  ]) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${functionName}`, 'i'))
  }
  assert.match(migration, /change_kind[\s\S]*'post_finalize_correction'/i)
  assert.match(migration, /INSERT INTO public\.inventory_adjustments/i)
})

test('確定後訂正と手動調整は理由・楽観ロック・冪等キー・店舗JAN照合を強制する', () => {
  const migration = source(migrationPath)

  assert.match(migration, /p_expected_row_version/i)
  assert.match(migration, /inventory item was updated by another user/i)
  assert.match(migration, /touch_inventory_session_from_item_change/i)
  assert.match(migration, /p_idempotency_key/i)
  assert.match(migration, /ON CONFLICT \(store_id, idempotency_key\) DO NOTHING/i)
  assert.match(migration, /product\.store_id = p_store_id[\s\S]*product\.jan_code = BTRIM\(p_jan_code\)/i)
})

test('Phase 4画面は停止・印刷・確定前確認・現在庫・訂正・調整・再同期を提供する', () => {
  const board = source('next_app/components/inventory/InventoryBoard.tsx')
  const overview = source('next_app/components/inventory/InventoryOverview.tsx')
  const finalizeDialog = source('next_app/components/inventory/InventoryFinalizeDialog.tsx')

  assert.match(board, /商品を停止/)
  assert.match(board, /停止を解除/)
  assert.match(board, /印刷/)
  assert.match(board, /確定前チェック/)
  assert.match(finalizeDialog, /棚卸しを確定/)
  assert.match(overview, /現在庫/)
  assert.match(overview, /数量を訂正/)
  assert.match(overview, /手動調整/)
  assert.match(overview, /最新履歴で再計算/)
  assert.match(overview, /マイナス/)
})

test('印刷画面は認証済み全件データとA4記入用・結果用レイアウトを使う', () => {
  const printPage = source('next_app/app/inventory/print/page.tsx')
  const printStyles = source('next_app/app/inventory/print/print.css')

  assert.match(printPage, /getInventoryPrintData/i)
  assert.match(printPage, /requireInventoryStoreAccess/i)
  assert.match(printPage, /棚卸し記入用リスト/)
  assert.match(printPage, /計算済み結果リスト/)
  assert.match(printPage, /JAN/)
  assert.match(printStyles, /@page[\s\S]*A4/i)
  assert.match(printStyles, /thead[\s\S]*table-header-group/i)
  assert.match(printStyles, /break-inside:\s*avoid/i)
})

test('Phase 4 RPCはPUBLIC/anonを拒否しauthenticatedだけへ限定する', () => {
  const migration = source(migrationPath)
  for (const functionName of [
    'set_inventory_product_status',
    'set_inventory_item_exclusion',
    'preview_inventory_finalization',
    'correct_finalized_inventory_count',
    'add_inventory_adjustment',
    'get_inventory_overview',
    'get_inventory_print_data',
  ]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]*FROM PUBLIC`, 'i'))
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]*FROM anon`, 'i'))
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}[\\s\\S]*TO authenticated`, 'i'))
  }
})

test('Phase 4の本番安全資料は読み取りpreflight・rollback付きruntime・非破壊rollbackを固定する', () => {
  const preflight = source('docs/inventory_management/phase4_preflight.sql')
  const postapply = source('docs/inventory_management/phase4_postapply.sql')
  const runtimeTest = source('docs/inventory_management/phase4_runtime_test.sql')
  const rollback = source('docs/inventory_management/phase4_rollback.sql')

  assert.match(preflight, /SET TRANSACTION READ ONLY/i)
  assert.match(preflight, /inventory_product_settings/i)
  assert.match(preflight, /waiting_locks/i)
  assert.match(postapply, /inventory_product_status_changes/i)
  assert.match(postapply, /authenticated_execute_count/i)
  assert.match(runtimeTest, /^BEGIN;/im)
  assert.match(runtimeTest, /SET LOCAL ROLE authenticated/i)
  assert.match(runtimeTest, /store 6 access denial failed/i)
  assert.match(runtimeTest, /preview changed inventory balances/i)
  assert.match(runtimeTest, /phase4_runtime_test_passed/i)
  assert.match(runtimeTest, /ROLLBACK;\s*$/i)
  assert.match(rollback, /Phase 4 rollback blocked/i)
  assert.doesNotMatch(rollback, /DROP TABLE|DELETE FROM|TRUNCATE/i)
})

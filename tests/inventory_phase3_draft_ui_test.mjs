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

const migrationPath = 'supabase/migrations/20260823233000_inventory_phase3_drafts.sql'

test('棚卸し開始RPCは店舗権限を再検証し、停止商品を含むstore_id別snapshotを1回だけ作る', () => {
  const migration = source(migrationPath)

  assert.match(migration, /FUNCTION public\.start_inventory_session/i)
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/i)
  assert.match(migration, /private\.can_access_store\([\s\S]*ARRAY\['manager', 'staff'\]/i)
  assert.match(migration, /pg_advisory_xact_lock/i)
  assert.match(migration, /status IN \('draft', 'finalizing'\)/i)
  assert.match(migration, /INSERT INTO public\.inventory_session_items/i)
  assert.match(migration, /FROM public\.products AS product/i)
  assert.match(migration, /product\.store_id = p_store_id/i)
  assert.doesNotMatch(migration, /product\.is_active\s*=\s*TRUE/i)
})

test('数量保存RPCはstore_id + JAN、楽観ロック、0数量、追加と置換の時刻規則を強制する', () => {
  const migration = source(migrationPath)

  assert.match(migration, /FUNCTION public\.save_inventory_count/i)
  assert.match(migration, /p_jan_code[\s\S]*p_expected_row_version/i)
  assert.match(migration, /session_id = p_session_id[\s\S]*store_id = p_store_id[\s\S]*jan_snapshot = BTRIM\(p_jan_code\)/i)
  assert.match(migration, /FOR UPDATE/i)
  assert.match(migration, /p_quantity < 0/i)
  assert.match(migration, /p_mode = 'add'[\s\S]*v_previous_counted_at/i)
  assert.match(migration, /p_quantity > 99999999999\.999 - v_previous_quantity/i)
  assert.match(migration, /p_mode = 'replace'[\s\S]*v_now/i)
  assert.match(migration, /v_new_quantity > 99999999999\.999/i)
  assert.match(migration, /INSERT INTO public\.inventory_count_changes/i)
  assert.match(migration, /'initial_count'[\s\S]*'add'[\s\S]*'replace'/i)
})

test('workspace RPCは進捗と停止状態を返し、NULL未入力と数量0を別扱いにする', () => {
  const migration = source(migrationPath)

  assert.match(migration, /FUNCTION public\.get_inventory_workspace/i)
  assert.match(migration, /counted_quantity IS NOT NULL/i)
  assert.match(migration, /counted_quantity IS NULL[\s\S]*excluded_at IS NULL/i)
  assert.match(migration, /JOIN public\.products AS product[\s\S]*product\.store_id = item\.store_id/i)
  assert.match(migration, /'isActive'/i)
  assert.match(migration, /'items'[\s\S]*jsonb_agg/i)
})

test('Phase 3 RPCはPUBLICとanonを拒否しauthenticatedだけへ限定する', () => {
  const migration = source(migrationPath)

  for (const functionName of [
    'start_inventory_session',
    'get_inventory_workspace',
    'save_inventory_count',
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]*FROM PUBLIC`, 'i'),
    )
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]*FROM anon`, 'i'),
    )
    assert.match(
      migration,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}[\\s\\S]*TO authenticated`, 'i'),
    )
  }
})

test('Server Actionとworkspace APIは入力検証・認証・DB店舗権限を毎回確認する', () => {
  const actions = source('next_app/app/actions/inventory.ts')
  const route = source('next_app/app/api/inventory/workspace/route.ts')

  assert.match(actions, /startInventorySessionAction/i)
  assert.match(actions, /saveInventoryCountAction/i)
  assert.match(actions, /requireInventoryStoreAccess/i)
  assert.match(actions, /parseInventoryStartRequest/i)
  assert.match(actions, /parseInventoryCountRequest/i)
  assert.doesNotMatch(actions, /SUPABASE_SERVICE_ROLE_KEY|service_role/i)

  assert.match(route, /export async function GET/i)
  assert.match(route, /requireInventoryStoreAccess/i)
  assert.match(route, /parseInventoryWorkspaceRequest/i)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|service_role/i)
})

test('棚卸し画面は数量入力・停止商品・進捗・自動下書き保存を表示する', () => {
  const board = source('next_app/components/inventory/InventoryBoard.tsx')

  assert.match(board, /JanCodeScannerField/i)
  assert.match(board, /棚卸し済み/i)
  assert.match(board, /未棚卸し/i)
  assert.match(board, /進捗率/i)
  assert.match(board, /停止商品/i)
  assert.match(board, /在庫0/i)
  assert.match(board, /下書きに自動保存/i)
  assert.match(board, /content-visibility-auto/i)
  assert.match(board, /catch \(saveError\)/i)
})

test('同一商品再読取は追加・数量置換・キャンセルの3択を表示する', () => {
  const dialog = source('next_app/components/inventory/InventoryCountDialog.tsx')

  assert.match(dialog, /この商品は登録済みです。数量を追加しますか？/)
  assert.match(dialog, />追加</)
  assert.match(dialog, />数量を置き換える</)
  assert.match(dialog, />キャンセル</)
  assert.match(dialog, /showModal\(\)/)
})

test('PCとスマホの棚卸し導線は設定オプション直上にあり、主要タブを増やさない', () => {
  const sideNav = source('next_app/components/layout/SideNav.tsx')
  const moreMenu = source('next_app/components/layout/SalesMoreMenu.tsx')
  const bottomNav = source('next_app/components/layout/BottomNav.tsx')

  assert.match(sideNav, /棚卸し・在庫管理/)
  assert.ok(sideNav.indexOf('棚卸し・在庫管理') < sideNav.indexOf('設定オプション'))
  assert.match(moreMenu, /棚卸し・在庫管理/)
  assert.ok(moreMenu.indexOf('棚卸し・在庫管理') < moreMenu.indexOf('設定オプション'))
  assert.doesNotMatch(bottomNav, /棚卸し・在庫管理/)
})

test('Phase 3 preflightは読み取り専用、runtime testはrollbackし、rollback SQLは追加RPCだけを除去する', () => {
  const preflight = source('docs/inventory_management/phase3_preflight.sql')
  const postapply = source('docs/inventory_management/phase3_postapply.sql')
  const runtimeTest = source('docs/inventory_management/phase3_runtime_test.sql')
  const rollback = source('docs/inventory_management/phase3_rollback.sql')

  assert.match(preflight, /SET TRANSACTION READ ONLY/i)
  assert.doesNotMatch(preflight, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i)
  assert.match(postapply, /ARRAY\['search_path=""'\]::TEXT\[\]/i)
  assert.match(postapply, /authenticated_execute_count[\s\S]*anon_denied_count/i)
  assert.match(runtimeTest, /BEGIN;/i)
  assert.match(runtimeTest, /ROLLBACK;/i)
  assert.match(runtimeTest, /store 7 only runtime test user/i)
  assert.match(runtimeTest, /store 6 access denial failed/i)
  assert.match(runtimeTest, /'initial'[\s\S]*'add'[\s\S]*'replace'/i)
  for (const functionName of [
    'start_inventory_session',
    'get_inventory_workspace',
    'save_inventory_count',
  ]) {
    assert.match(rollback, new RegExp(`DROP FUNCTION IF EXISTS public\\.${functionName}`, 'i'))
  }
  assert.doesNotMatch(rollback, /DROP TABLE|DELETE FROM|TRUNCATE/i)
})

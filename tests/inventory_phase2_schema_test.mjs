import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const migrationPath = path.join(
  projectRoot,
  'supabase/migrations/20260823213000_inventory_phase2_functions.sql',
)
const lintFixMigrationPath = path.join(
  projectRoot,
  'supabase/migrations/20260823223000_inventory_phase2_recalc_lint_fix.sql',
)
const routePath = path.join(
  projectRoot,
  'next_app/app/api/inventory/recalculate/route.ts',
)
const authPath = path.join(projectRoot, 'next_app/lib/inventory/auth.ts')
const servicePath = path.join(projectRoot, 'next_app/lib/inventory/recalculationService.ts')
const preflightPath = path.join(
  projectRoot,
  'docs/inventory_management/phase2_preflight.sql',
)
const rollbackPath = path.join(
  projectRoot,
  'docs/inventory_management/phase2_rollback.sql',
)
const runtimeTestPath = path.join(
  projectRoot,
  'docs/inventory_management/phase2_runtime_test.sql',
)

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

test('POS snapshot RPCは認証・店舗権限を再検証し、商品をstore_id + JANでDB解決する', () => {
  const migration = read(migrationPath)

  assert.match(migration, /FUNCTION public\.save_inventory_pos_snapshot/i)
  assert.match(migration, /SECURITY DEFINER/i)
  assert.match(migration, /SET search_path = ''/i)
  assert.match(migration, /auth\.uid\(\)/i)
  assert.match(migration, /private\.can_access_store\([\s\S]*ARRAY\['manager', 'staff'\]/i)
  assert.match(migration, /jsonb_array_elements\([\s\S]*WITH ORDINALITY/i)
  assert.match(migration, /public\.products[\s\S]*store_id[\s\S]*jan_code/i)
  assert.match(migration, /ROW_NUMBER\(\)[\s\S]*PARTITION BY[\s\S]*signature_hash/i)
  assert.doesNotMatch(migration, /matchedProductId|matched_product_id'\s*\)/i)
})

test('再計算RPCは計数時刻から全量集計してbalanceを上書きする', () => {
  const migration = read(migrationPath)

  assert.match(migration, /FUNCTION public\.recalculate_inventory_session/i)
  assert.match(migration, /pg_advisory_xact_lock/i)
  assert.match(migration, /date_trunc\('minute'[\s\S]*counted_at/i)
  assert.match(migration, /FROM public\.transfers/i)
  assert.match(migration, /SUM\(ABS\(transfer\.quantity\)\)/i)
  assert.match(migration, /FROM public\.inventory_adjustments/i)
  assert.match(
    migration,
    /physical_quantity[\s\S]*- sales_quantity[\s\S]*\+ return_quantity[\s\S]*\+ transfer_in_quantity[\s\S]*- transfer_out_quantity[\s\S]*- usage_quantity[\s\S]*\+ adjustment_delta/i,
  )
  assert.match(migration, /INSERT INTO public\.inventory_balances/i)
  assert.match(migration, /ON CONFLICT \(store_id, product_id\) DO UPDATE/i)
  assert.match(migration, /source_fingerprint/i)
})

test('同一入力runを再利用し、append-only履歴へ重複runを増やさない', () => {
  const migration = read(migrationPath)

  assert.match(
    migration,
    /WHERE[\s\S]*session_id[\s\S]*snapshot_id[\s\S]*source_fingerprint/i,
  )
  assert.match(migration, /IF v_run_id IS NULL[\s\S]*INSERT INTO public\.inventory_calculation_runs/i)
})

test('確定RPCは楽観ロック・未入力・曖昧を検査して再計算と確定を1 transactionにする', () => {
  const migration = read(migrationPath)

  assert.match(migration, /FUNCTION public\.finalize_inventory_session/i)
  assert.match(migration, /FOR UPDATE/i)
  assert.match(migration, /p_expected_row_version/i)
  assert.match(migration, /counted_at IS NULL[\s\S]*excluded_at IS NULL/i)
  assert.match(migration, /public\.recalculate_inventory_session\(/i)
  assert.match(migration, /v_unmatched_count > 0 OR v_ambiguous_count > 0/i)
  assert.match(migration, /status = 'finalized'[\s\S]*finalized_at[\s\S]*finalized_by/i)
})

test('lint修正migrationは一時tableを使わず同じ再計算RPCを直接UPSERTする', () => {
  const migration = read(lintFixMigrationPath)

  assert.match(migration, /FUNCTION public\.recalculate_inventory_session/i)
  assert.match(migration, /INSERT INTO public\.inventory_balances/i)
  assert.match(migration, /FROM public\.inventory_session_items AS item/i)
  assert.match(migration, /ON CONFLICT \(store_id, product_id\) DO UPDATE/i)
  assert.doesNotMatch(migration, /CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE|inventory_recalc_results/i)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.recalculate_inventory_session[\s\S]*FROM PUBLIC/i,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.recalculate_inventory_session[\s\S]*TO authenticated/i,
  )
})

test('Phase 2 RPCはPUBLICとanonを拒否しauthenticatedだけへ限定する', () => {
  const migration = read(migrationPath)

  for (const functionName of [
    'get_inventory_recalculation_context',
    'save_inventory_pos_snapshot',
    'record_inventory_pos_snapshot_failure',
    'recalculate_inventory_session',
    'finalize_inventory_session',
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

test('Route Handlerは入力検証・同一origin・セッション・店舗権限を毎回確認する', () => {
  const route = read(routePath)
  const auth = read(authPath)

  assert.match(route, /export async function POST/i)
  assert.match(route, /request\.json\(\)/i)
  assert.match(route, /isSameOriginInventoryRequest/i)
  assert.match(route, /parseInventoryRecalculationRequest/i)
  assert.match(route, /requireInventoryStoreAccess/i)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|service_role/i)

  assert.match(auth, /supabase\.auth\.getUser\(\)/i)
  assert.match(auth, /from\('user_store_access'\)/i)
  assert.match(auth, /eq\('user_id', user\.id\)/i)
  assert.match(auth, /eq\('store_id', storeId\)/i)
})

test('同期serviceはPOSだけをsnapshot化し、保存後に1 snapshotだけで再計算する', () => {
  const service = read(servicePath)

  assert.match(service, /fetchGasHistoryRows/i)
  assert.match(service, /normalizePosSnapshot/i)
  assert.match(service, /save_inventory_pos_snapshot/i)
  assert.match(service, /recalculate_inventory_session/i)
  assert.doesNotMatch(service, /realtime_history_cache|refreshHistorySnapshot|SUPABASE_SERVICE_ROLE_KEY/i)
})

test('Phase 2 preflightは読み取り専用で依存関係と競合を検査する', () => {
  const preflight = read(preflightPath)

  assert.match(preflight, /SET TRANSACTION READ ONLY/i)
  assert.match(preflight, /extensions\.digest/i)
  assert.match(preflight, /products_id_store_id_jan_code_key/i)
  assert.match(preflight, /FROM pg_locks/i)
  assert.doesNotMatch(preflight, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i)
})

test('Phase 2 rollbackは正本データを削除せず追加RPCだけを明示的に除去する', () => {
  const rollback = read(rollbackPath)

  for (const functionName of [
    'get_inventory_recalculation_context',
    'save_inventory_pos_snapshot',
    'record_inventory_pos_snapshot_failure',
    'recalculate_inventory_session',
    'finalize_inventory_session',
  ]) {
    assert.match(rollback, new RegExp(`DROP FUNCTION IF EXISTS public\\.${functionName}`, 'i'))
  }
  assert.doesNotMatch(rollback, /DROP TABLE|DELETE FROM|TRUNCATE/i)
})

test('実DB runtime testはauthenticated権限と店舗越境を検査し必ずrollbackする', () => {
  const runtimeTest = read(runtimeTestPath)

  assert.match(runtimeTest, /SET LOCAL ROLE authenticated/i)
  assert.match(runtimeTest, /save_inventory_pos_snapshot/i)
  assert.match(runtimeTest, /recalculate_inventory_session/i)
  assert.match(runtimeTest, /finalize_inventory_session/i)
  assert.match(runtimeTest, /store access denied|42501/i)
  assert.match(runtimeTest, /ROLLBACK;\s*$/i)
  assert.doesNotMatch(runtimeTest, /\bCOMMIT\b/i)
})

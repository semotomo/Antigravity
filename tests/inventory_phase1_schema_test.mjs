import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')
const migrationPath = path.join(
  projectRoot,
  'supabase/migrations/20260823163000_inventory_phase1_schema.sql',
)
const preflightPath = path.join(
  projectRoot,
  'docs/inventory_management/phase1_preflight.sql',
)
const rollbackPath = path.join(
  projectRoot,
  'docs/inventory_management/phase1_rollback.sql',
)

function migrationSource() {
  return fs.readFileSync(migrationPath, 'utf8')
}

function preflightSource() {
  return fs.readFileSync(preflightPath, 'utf8')
}

function rollbackSource() {
  return fs.readFileSync(rollbackPath, 'utf8')
}

const inventoryTables = [
  'user_store_access',
  'inventory_sessions',
  'inventory_session_items',
  'inventory_count_changes',
  'inventory_adjustments',
  'inventory_product_settings',
  'pos_inventory_snapshots',
  'pos_inventory_snapshot_rows',
  'inventory_calculation_runs',
  'inventory_balances',
]

test('店舗権限はDB管理テーブルとprivate helperを正本にする', () => {
  const migration = migrationSource()

  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS private/i)
  assert.match(migration, /CREATE TABLE public\.user_store_access/i)
  assert.match(migration, /PRIMARY KEY \(user_id, store_id\)/i)
  assert.match(migration, /CHECK \(store_id IN \(6, 7\)\)/i)
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.can_access_store/i)
  assert.match(migration, /SECURITY DEFINER/i)
  assert.match(migration, /SET search_path = ''/i)
  assert.match(migration, /public\.user_store_access/i)
  assert.match(migration, /auth\.uid\(\)/i)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION private\.can_access_store\(INTEGER, TEXT\[\]\) FROM PUBLIC/i,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION private\.can_access_store\(INTEGER, TEXT\[\]\) FROM anon/i,
  )
  assert.doesNotMatch(migration, /user_metadata|raw_user_meta_data|current_store_view/i)
})

test('棚卸し正本・監査・POS snapshot・投影テーブルをすべて作成する', () => {
  const migration = migrationSource()

  for (const table of inventoryTables) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`, 'i'))
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'),
    )
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, 'i'),
    )
  }
})

test('セッション・商品・JANは複合制約で店舗越境を拒否する', () => {
  const migration = migrationSource()

  assert.match(migration, /UNIQUE \(id, store_id, jan_code\)/i)
  assert.match(
    migration,
    /COMMENT ON CONSTRAINT products_id_store_id_jan_code_key ON public\.products IS[\s\S]*inventory_management_phase1/i,
  )
  assert.match(
    migration,
    /FOREIGN KEY \(session_id, store_id\)[\s\S]*REFERENCES public\.inventory_sessions \(id, store_id\)/i,
  )
  assert.match(
    migration,
    /FOREIGN KEY \(product_id, store_id, jan_snapshot\)[\s\S]*REFERENCES public\.products \(id, store_id, jan_code\)/i,
  )
  assert.match(migration, /UNIQUE \(session_id, store_id, jan_snapshot\)/i)
  assert.match(migration, /CHECK \(BTRIM\(jan_snapshot\) <> ''\)/i)
})

test('在庫0と未棚卸し、理由付き除外、active session一意をDBで区別する', () => {
  const migration = migrationSource()

  assert.match(migration, /counted_quantity IS NULL[\s\S]*counted_at IS NULL/i)
  assert.match(migration, /counted_quantity >= 0/i)
  assert.match(migration, /exclusion_reason IS NOT NULL/i)
  assert.match(migration, /BTRIM\(exclusion_reason\) <> ''/i)
  assert.match(migration, /WHERE status IN \('draft', 'finalizing'\)/i)
})

test('監査履歴・手動調整・POS snapshot行は追記専用にする', () => {
  const migration = migrationSource()

  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.prevent_inventory_history_mutation/i)
  for (const table of [
    'inventory_count_changes',
    'inventory_adjustments',
    'pos_inventory_snapshots',
    'pos_inventory_snapshot_rows',
    'inventory_calculation_runs',
  ]) {
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER prevent_${table}_mutation[\\s\\S]*ON public\\.${table}`, 'i'),
    )
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER prevent_${table}_truncate[\\s\\S]*BEFORE TRUNCATE ON public\\.${table}`, 'i'),
    )
  }
  assert.match(migration, /CHECK \(quantity_delta <> 0\)/i)
  assert.match(migration, /CHECK \(BTRIM\(reason\) <> ''\)/i)
})

test('現在庫投影は基本式と一致し、再計算runを参照する', () => {
  const migration = migrationSource()

  assert.match(
    migration,
    /calculated_quantity = physical_quantity\s*- sales_quantity\s*\+ return_quantity\s*\+ transfer_in_quantity\s*- transfer_out_quantity\s*- usage_quantity\s*\+ adjustment_delta/i,
  )
  assert.match(
    migration,
    /FOREIGN KEY \(calculation_run_id, store_id\)[\s\S]*REFERENCES public\.inventory_calculation_runs \(id, store_id\)/i,
  )
  assert.match(migration, /UNIQUE \(session_id, snapshot_id, source_fingerprint\)/i)
})

test('anonとauthenticatedの直接DMLを拒否し、店舗内SELECTだけ許可する', () => {
  const migration = migrationSource()

  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT SELECT ON TABLE[\s\S]*TO authenticated/i)
  assert.doesNotMatch(migration, /GRANT ALL ON TABLE[\s\S]*TO service_role/i)
  assert.match(migration, /TO authenticated[\s\S]*private\.can_access_store\(store_id/i)
  assert.doesNotMatch(migration, /FOR ALL[\s\S]{0,100}USING \(TRUE\)/i)
  assert.doesNotMatch(migration, /TO anon[\s\S]{0,100}(USING|WITH CHECK)/i)
})

test('本番preflight SQLは読み取り専用で既存状態だけを監査する', () => {
  const preflight = preflightSource()

  assert.match(preflight, /SET TRANSACTION READ ONLY/i)
  assert.match(preflight, /FROM public\.products/i)
  assert.match(preflight, /FROM auth\.users/i)
  assert.match(preflight, /FROM pg_constraint/i)
  assert.match(preflight, /FROM pg_locks/i)
  assert.doesNotMatch(
    preflight,
    /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/im,
  )
})

test('rollbackはデータ存在時に停止しPhase 1所有オブジェクトだけを戻す', () => {
  const rollback = rollbackSource()

  assert.match(rollback, /SELECT EXISTS \(SELECT 1 FROM public\.%I LIMIT 1\)/i)
  assert.match(rollback, /Phase 1 rollback blocked/i)
  assert.match(rollback, /inventory_management_phase1/i)
  assert.match(rollback, /DROP CONSTRAINT products_id_store_id_jan_code_key/i)
  assert.doesNotMatch(rollback, /DROP SCHEMA/i)
})

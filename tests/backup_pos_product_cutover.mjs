import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 対象project/SQLは固定。CLI認証の秘密値や行データは標準出力へ出さない。
const projectRef = 'wpxewebmezghoulnasre'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const linkedRoot = path.basename(path.dirname(root)) === '.codex-worktrees' ? path.resolve(root, '../..') : root
const cli = process.argv[2]
if (process.argv.length !== 3 || !cli || !path.isAbsolute(cli) || path.basename(cli) !== 'supabase.exe' || !fs.existsSync(cli)) {
  throw Error('既存Supabase CLIの絶対パスを1つ指定してください。')
}
if (fs.readFileSync(path.join(linkedRoot, 'supabase/.temp/project-ref'), 'utf8').trim() !== projectRef) {
  throw Error('linked projectが対象と一致しません。')
}
const result = spawnSync(cli, ['db', 'query', '--linked', '--project-ref', projectRef, '--output', 'json',
  '--file', path.join(root, 'supabase/backup_pos_product_cutover.sql')], {
  cwd: linkedRoot, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, timeout: 120_000, windowsHide: true,
})
if (result.status !== 0) throw Error('読取り専用backup queryに失敗しました。CLIの認証/接続を確認してください。')
const start = result.stdout.indexOf('{')
const end = result.stdout.lastIndexOf('}')
if (start < 0 || end < start) throw Error('backup応答を取得できませんでした。')
const response = JSON.parse(result.stdout.slice(start, end + 1))
if (!Array.isArray(response.rows) || response.rows.length !== 1) throw Error('backupの応答件数が不正です。')
const backup = response.rows[0].backup
const tables = ['products', 'product_aliases', 'products_master', 'stores', 'user_store_access', 'sync_history', 'transfers',
  'inventory_adjustments', 'inventory_balances', 'inventory_calculation_runs', 'inventory_count_changes',
  'inventory_product_settings', 'inventory_product_status_changes', 'inventory_session_items', 'inventory_sessions',
  'pos_inventory_snapshot_rows', 'pos_inventory_snapshots'].sort()
if (backup?.format !== 'kennel-pos-cutover-v1' || backup.database !== 'postgres'
  || !Array.isArray(backup.columns) || !Array.isArray(backup.functions) || !Array.isArray(backup.migrations)
  || JSON.stringify(Object.keys(backup.tables ?? {}).sort()) !== JSON.stringify(tables)) throw Error('backupの対象/定義が不正です。')
for (const table of tables) {
  if (!Array.isArray(backup.tables[table]) || backup.tables[table].length !== backup.counts[table]) throw Error('backup件数が一致しません。')
}
if (!backup.tables.products.length || !backup.tables.user_store_access.length) throw Error('必要な本番データが空です。')
if (backup.tables.products.some(row => ![6, 7].includes(row.store_id))) throw Error('未知店舗の商品を検出しました。')
const payload = JSON.stringify({ projectRef, ...backup }, null, 2)
const sha256 = createHash('sha256').update(payload).digest('hex')
const outputDir = path.join(root, 'local_exports')
fs.mkdirSync(outputDir, { recursive: true })
const outputPath = path.join(outputDir, `pos-product-cutover-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`)
fs.writeFileSync(outputPath, payload, { encoding: 'utf8', flag: 'wx' })
fs.writeFileSync(`${outputPath}.sha256`, `${sha256}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ outputPath, sha256, bytes: Buffer.byteLength(payload), counts: backup.counts,
  columns: backup.columns.length, functions: backup.functions.length, policies: backup.policies.length, migrations: backup.migrations.length }))

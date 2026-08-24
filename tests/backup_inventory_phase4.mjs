import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function findSupabaseCli() {
  if (process.env.SUPABASE_CLI_PATH && fs.existsSync(process.env.SUPABASE_CLI_PATH)) {
    return process.env.SUPABASE_CLI_PATH
  }
  const npxRoot = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  if (!fs.existsSync(npxRoot)) {
    throw new Error('SUPABASE_CLI_PATHを指定してください。')
  }
  for (const cacheDir of fs.readdirSync(npxRoot)) {
    const candidate = path.join(
      npxRoot,
      cacheDir,
      'node_modules',
      '@supabase',
      'cli-windows-x64',
      'bin',
      'supabase.exe',
    )
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('ログイン済みSupabase CLIを見つけられませんでした。')
}

const supabaseCli = findSupabaseCli()

function query(sql) {
  const result = spawnSync(
    supabaseCli,
    ['db', 'query', '--linked', '--output', 'json', sql],
    { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    throw new Error(`Supabase backup query failed: ${(result.stderr || result.stdout).slice(0, 500)}`)
  }
  const start = result.stdout.indexOf('{')
  const end = result.stdout.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Supabase queryのJSON応答を取得できませんでした。')
  const parsed = JSON.parse(result.stdout.slice(start, end + 1))
  if (!Array.isArray(parsed.rows)) throw new Error('Supabase queryのrows応答が不正です。')
  return parsed.rows
}

async function fetchAll({ table, columns = '*', orderBy }) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const page = query(
      `SELECT ${columns} FROM public.${table} ORDER BY ${orderBy} LIMIT 1000 OFFSET ${offset}`,
    )
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

const tableQueries = [
  {
    table: 'products',
    columns: 'id, store_id, jan_code, product_name, is_active, updated_at',
    orderBy: 'store_id, id',
  },
  { table: 'inventory_product_settings', orderBy: 'store_id, product_id' },
  { table: 'inventory_sessions', orderBy: 'store_id, id' },
  { table: 'inventory_session_items', orderBy: 'store_id, session_id, id' },
  { table: 'inventory_count_changes', orderBy: 'store_id, session_id, id' },
  { table: 'inventory_adjustments', orderBy: 'store_id, id' },
  { table: 'pos_inventory_snapshots', orderBy: 'store_id, id' },
  { table: 'pos_inventory_snapshot_rows', orderBy: 'store_id, snapshot_id, row_no' },
  { table: 'inventory_calculation_runs', orderBy: 'store_id, id' },
  { table: 'inventory_balances', orderBy: 'store_id, product_id' },
]

const entries = []
for (const tableQuery of tableQueries) {
  entries.push([tableQuery.table, await fetchAll(tableQuery)])
}
const tables = Object.fromEntries(entries)
const exportedAt = new Date().toISOString()
const payload = JSON.stringify({ exportedAt, tables }, null, 2)
const sha256 = crypto.createHash('sha256').update(payload).digest('hex')
const timestamp = exportedAt.replace(/[:.]/g, '-')
const outputDir = path.join(projectRoot, 'local_exports')
const outputPath = path.join(outputDir, `inventory-phase4-${timestamp}.json`)
const checksumPath = `${outputPath}.sha256`

fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(outputPath, payload, 'utf8')
fs.writeFileSync(checksumPath, `${sha256}  ${path.basename(outputPath)}\n`, 'utf8')

console.log(
  JSON.stringify({
    outputPath,
    checksumPath,
    sha256,
    counts: Object.fromEntries(
      Object.entries(tables).map(([table, rows]) => [table, rows.length]),
    ),
  }),
)

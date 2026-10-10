import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 生成専用。DB接続や適用は行わず、承認済み原文と履歴を一つのtransactionへ束ねる。
export const PROJECT_REF = 'wpxewebmezghoulnasre'
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRATIONS = [
  '20260908120000_pos_product_operation_ledger.sql',
  '20260908121000_pos_product_operation_functions.sql',
  '20260910090000_product_master_sync_fence.sql',
  '20260910120000_pos_product_edit_apply.sql',
  '20261004120000_pos_product_edit_dispatch.sql',
  '20261005120000_pos_product_operation_cancellation.sql',
  '20261005121000_product_master_sync_notifications.sql',
  '20261005122000_product_master_write_cutover.sql',
  '20261005123000_product_master_sync_gateway.sql',
  '20261008120000_product_master_sync_excluded_code.sql',
]
export const NEW_TABLES = [
  'pos_product_operations', 'pos_product_operation_locks', 'pos_product_operation_events',
  'product_master_store_versions', 'product_master_sync_runs', 'pos_product_edit_intents',
  'pos_product_edit_receipts', 'pos_product_links', 'pos_product_edit_dispatches',
  'pos_product_edit_dispatch_receipts', 'pos_product_operation_cancellations',
  'product_master_sync_notifications', 'product_master_sync_requests',
]
export const BACKUP_TABLES = [
  'products', 'product_aliases', 'products_master', 'stores', 'user_store_access', 'sync_history',
  'transfers', 'inventory_adjustments', 'inventory_balances', 'inventory_calculation_runs',
  'inventory_count_changes', 'inventory_product_settings', 'inventory_product_status_changes',
  'inventory_session_items', 'inventory_sessions', 'pos_inventory_snapshot_rows', 'pos_inventory_snapshots',
].sort()
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const md5 = value => createHash('md5').update(value).digest('hex')
export const fail = code => { throw Error(code) }
export const sqlText = value => `'${String(value).replaceAll("'", "''")}'`
export const functionKey = row => `${row.schema}.${row.name}(${row.arguments})`

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail('CUTOVER_INVALID_NUMBER')
  return JSON.stringify(value)
}

export function rowHash(rows) {
  if (!Array.isArray(rows)) fail('CUTOVER_INVALID_ROWS')
  // 行順を除外し、全列・重複行を含めた各行のhash集合を比較する。
  return sha256(JSON.stringify(rows.map(row => sha256(canonicalJson(row))).sort()))
}

export function loadVerifiedBackup(input) {
  if (!input || !path.isAbsolute(input)) fail('CUTOVER_BACKUP_PATH_INVALID')
  const payload = fs.readFileSync(input, 'utf8')
  const checksum = fs.readFileSync(`${input}.sha256`, 'utf8').trim()
  if (!/^[0-9a-f]{64}$/.test(checksum) || sha256(payload) !== checksum) fail('CUTOVER_BACKUP_CHECKSUM_INVALID')
  let backup
  try { backup = JSON.parse(payload) } catch { fail('CUTOVER_BACKUP_JSON_INVALID') }
  if (backup?.projectRef !== PROJECT_REF || backup.format !== 'kennel-pos-cutover-v1' || backup.database !== 'postgres' ||
      !Array.isArray(backup.functions) || !Array.isArray(backup.migrations) || backup.migrations.length !== 19 ||
      canonicalJson(Object.keys(backup.tables ?? {}).sort()) !== canonicalJson(BACKUP_TABLES)) fail('CUTOVER_BACKUP_SCOPE_INVALID')
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.tables[table]) || backup.tables[table].length !== backup.counts?.[table]) fail('CUTOVER_BACKUP_COUNTS_INVALID')
  }
  const versions = backup.migrations.map(row => row.version)
  if (versions.some(version => !/^\d{14}$/.test(version)) || new Set(versions).size !== 19 ||
      MIGRATIONS.some(file => versions.includes(file.slice(0, 14)))) fail('CUTOVER_BACKUP_HISTORY_INVALID')
  if (new Set(backup.functions.map(functionKey)).size !== backup.functions.length ||
      backup.functions.some(row => typeof row.definition !== 'string')) fail('CUTOVER_BACKUP_FUNCTIONS_INVALID')
  const targets = backup.tables.products.filter(row => row.id === 4779)
  if (targets.length !== 1 || targets[0].store_id !== 7 || targets[0].jan_code !== '4582107173062' ||
      targets[0].product_name !== '95ミツヤ もみじ焼き' || targets[0].selling_price !== 199 ||
      targets[0].cost_price !== 95 || targets[0].is_active !== true) fail('CUTOVER_TARGET_BASELINE_INVALID')
  return { backup, checksum, target: targets[0] }
}

// SQL本文の文字列・コメント・dollar quoteを除き、外側のtransaction制御だけを検査する。
export function outerSql(source) {
  let output = '', index = 0
  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index + 2)
      index = end < 0 ? source.length : end; output += '\n'; continue
    }
    if (source.startsWith('/*', index)) {
      let depth = 1; index += 2
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2 }
        else if (source.startsWith('*/', index)) { depth--; index += 2 }
        else index++
      }
      if (depth) fail('CUTOVER_SQL_COMMENT_INVALID')
      output += ' '; continue
    }
    if (source[index] === "'" || source[index] === '"') {
      const quote = source[index++]; let closed = false
      while (index < source.length) {
        if (source[index] === quote) {
          if (source[index + 1] === quote) { index += 2; continue }
          index++; closed = true; break
        }
        if (quote === "'" && source[index] === '\\') index += 2
        else index++
      }
      if (!closed) fail('CUTOVER_SQL_QUOTE_INVALID')
      output += ' '; continue
    }
    const tag = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
    if (tag) {
      const end = source.indexOf(tag, index + tag.length)
      if (end < 0) fail('CUTOVER_SQL_DOLLAR_QUOTE_INVALID')
      index = end + tag.length; output += ' '; continue
    }
    output += source[index++]
  }
  return output
}

export function readMigrationSources() {
  const versions = new Set(), tags = new Set()
  return MIGRATIONS.map(file => {
    const match = file.match(/^(\d{14})_([a-z0-9_]+)\.sql$/)
    if (!match || versions.has(match[1])) fail('CUTOVER_VERSION_DUPLICATE')
    versions.add(match[1])
    const bytes = fs.readFileSync(path.join(ROOT, 'supabase/migrations', file)), source = bytes.toString('utf8')
    if (!source || source.charCodeAt(0) === 0xFEFF || !Buffer.from(source).equals(bytes)) fail('CUTOVER_SOURCE_ENCODING_INVALID')
    const outer = outerSql(source)
    if (/\b(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|VACUUM|CALL)\b|\b(?:START|PREPARE)\s+TRANSACTION\b|\bALTER\s+SYSTEM\b|\bCONCURRENTLY\b|^\s*\\/im.test(outer)) {
      fail('CUTOVER_SOURCE_TRANSACTION_UNSAFE')
    }
    const tag = `$kennel_migration_${match[1]}$`
    if (tags.has(tag) || source.includes(tag)) fail('CUTOVER_HISTORY_TAG_DUPLICATE')
    tags.add(tag)
    return { file, version: match[1], name: match[2], source, tag, sha256: sha256(bytes), bytes: bytes.length }
  })
}

function generate(input) {
  const verified = loadVerifiedBackup(input), sources = readMigrationSources()
  const guardTag = '$kennel_cutover_preflight$', historyTag = '$kennel_prior_history$', targetTag = '$kennel_target_baseline$'
  const history = JSON.stringify([...verified.backup.migrations].sort((a, b) => a.version.localeCompare(b.version)))
  const target = JSON.stringify(verified.target)
  for (const tag of [guardTag, historyTag, targetTag]) {
    if (sources.some(row => row.source.includes(tag)) || history.includes(tag) || target.includes(tag)) fail('CUTOVER_GUARD_TAG_DUPLICATE')
  }
  const requiredTables = BACKUP_TABLES.map(name => sqlText('public.' + name)).join(',')
  const newTables = NEW_TABLES.map(name => sqlText('public.' + name)).join(',')
  const historyVersions = sources.map(row => sqlText(row.version)).join(',')
  const guard = `DO ${guardTag}
BEGIN
  IF current_database() <> 'postgres' OR
     (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations') <> 3 OR
     NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='version' AND data_type='text' AND is_nullable='NO') OR
     NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='statements' AND udt_name='_text') OR
     NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='name' AND data_type='text') THEN
    RAISE EXCEPTION 'CUTOVER_HISTORY_SCHEMA_INVALID';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 19 OR
     (SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m) IS DISTINCT FROM ${historyTag}${history}${historyTag}::jsonb OR
     EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${historyVersions})) THEN
    RAISE EXCEPTION 'CUTOVER_PRIOR_HISTORY_CHANGED';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('private.can_access_store(integer,text[])') IS NULL OR
     to_regprocedure('public.set_inventory_product_status(integer,text,boolean,text)') IS NULL OR
     EXISTS(SELECT 1 FROM unnest(ARRAY[${requiredTables}]) name WHERE to_regclass(name) IS NULL) OR
     (SELECT count(*) FROM public.stores WHERE id IN (6,7)) <> 2 OR
     (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) <> 3 THEN
    RAISE EXCEPTION 'CUTOVER_REQUIRED_BASELINE_MISSING';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[${newTables}]) name WHERE to_regclass(name) IS NOT NULL) THEN
    RAISE EXCEPTION 'CUTOVER_NEW_RELATION_ALREADY_EXISTS';
  END IF;
  IF (SELECT count(*) FROM public.products WHERE id=4779) <> 1 OR
     NOT EXISTS(SELECT 1 FROM public.products p WHERE id=4779 AND store_id=7 AND jan_code='4582107173062'
       AND product_name='95ミツヤ もみじ焼き' AND selling_price=199 AND cost_price=95 AND is_active=true
       AND to_jsonb(p)=${targetTag}${target}${targetTag}::jsonb) THEN
    RAISE EXCEPTION 'CUTOVER_TARGET_CHANGED';
  END IF;
END ${guardTag};`
  const statements = sources.map(row => `-- ${row.file} SHA-256 ${row.sha256}\n${row.source}\n` +
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (` +
    `${sqlText(row.version)},${sqlText(row.name)},ARRAY[${row.tag}${row.source}${row.tag}]::text[]);`).join('\n\n')
  const sql = `-- 対象project: ${PROJECT_REF}。承認済み10本だけ。エラー時は全transactionをrollbackする。\n` +
    `BEGIN;\nSET LOCAL TIME ZONE 'UTC';\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='90s';\n` +
    `LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n` +
    `LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;\n${guard}\n\n${statements}\n\nCOMMIT;\n`
  const outer = outerSql(sql)
  if ((outer.match(/\bBEGIN\b/g) ?? []).length !== 1 || (outer.match(/\bCOMMIT\b/g) ?? []).length !== 1 ||
      (outer.match(/INSERT INTO supabase_migrations\.schema_migrations/g) ?? []).length !== 10) fail('CUTOVER_BUNDLE_BOUNDARY_INVALID')
  const outputDir = path.join(ROOT, 'local_exports')
  fs.mkdirSync(outputDir, { recursive: true })
  const base = path.join(outputDir, `pos-product-cutover-apply-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
  const manifest = { format: 'kennel-pos-cutover-apply-v1', projectRef: PROJECT_REF, backupPath: input,
    backupSha256: verified.checksum, sqlPath: `${base}.sql`, sqlSha256: sha256(sql),
    priorVersions: verified.backup.migrations.map(row => row.version).sort(),
    migrations: sources.map(({ source, tag, ...row }) => row), bytes: Buffer.byteLength(sql),
    transactionCount: 1, targetProductId: 4779 }
  fs.writeFileSync(`${base}.sql`, sql, { encoding: 'utf8', flag: 'wx' })
  fs.writeFileSync(`${base}.sql.sha256`, manifest.sqlSha256 + '\n', { encoding: 'utf8', flag: 'wx' })
  fs.writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ sqlPath: manifest.sqlPath, manifestPath: `${base}.manifest.json`, sha256: manifest.sqlSha256,
    bytes: manifest.bytes, migrations: sources.length, priorHistoryCount: 19, transactionCount: 1, databaseConnected: false }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) fail('CUTOVER_PREPARE_ARGUMENTS_INVALID')
    generate(process.argv[2])
  } catch (error) {
    console.error(JSON.stringify({ success: false, code: /^CUTOVER_[A-Z_]+$/.test(error?.message) ? error.message : 'CUTOVER_PREPARE_FAILED' }))
    process.exitCode = 1
  }
}

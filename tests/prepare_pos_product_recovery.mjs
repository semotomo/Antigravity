import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BACKUP_TABLES, NEW_TABLES, PROJECT_REF, ROOT, sha256, sqlText, outerSql } from './prepare_pos_product_cutover.mjs'

// 今回の承認範囲だけ。退避はREAD ONLY、適用SQLの生成はDBへ接続しない。解除RPCは生成しない。
const TABLES = [...BACKUP_TABLES, ...NEW_TABLES].sort()
const SOURCES = [
  ['20261010120000_pos_product_edit_not_sent.sql', '8244ead443b37cb3fed580aa51941e6906253b99ae39662c30575b99b394c758'],
  ['20261010210000_pos_product_edit_legacy_closure.sql', '891ef303df9982dbcf879644c21df2bb2104e9f87d0a876ccfb85d35e6dd5c07'],
]
const OP_ID = 'eb967ccc-57b6-454c-b722-74c7a7c5885d'
const fail = code => { throw Error(code) }
const exportDir = path.join(ROOT, 'local_exports')
function save(file, payload) {
  fs.mkdirSync(exportDir, { recursive: true })
  fs.writeFileSync(file, payload, { encoding: 'utf8', flag: 'wx' })
  fs.writeFileSync(file + '.sha256', sha256(payload) + '\n', { encoding: 'utf8', flag: 'wx' })
}
function validate(backup) {
  if (backup?.projectRef !== PROJECT_REF || backup.format !== 'kennel-pos-cutover-v1' || backup.database !== 'postgres'
    || JSON.stringify(Object.keys(backup.tables ?? {}).sort()) !== JSON.stringify(TABLES)
    || !Array.isArray(backup.functions) || !Array.isArray(backup.columns) || !Array.isArray(backup.migrations)
    || backup.migrations.length !== 29) fail('RECOVERY_BACKUP_SCOPE_INVALID')
  for (const name of TABLES) if (!Array.isArray(backup.tables[name]) || backup.tables[name].length !== backup.counts?.[name]) {
    fail('RECOVERY_BACKUP_COUNTS_INVALID')
  }
  const op = backup.tables.pos_product_operations.find(row => row.id === OP_ID)
  const product = backup.tables.products.find(row => row.id === 4779)
  if (!op || op.store_id !== 7 || op.product_id_snapshot !== 4779 || op.jan_code !== '4582107173062'
    || op.status !== 'uncertain' || op.row_version !== 2 || op.send_attempts !== 1 || op.verified_fingerprint !== null
    || !product || product.store_id !== 7 || product.jan_code !== op.jan_code
    || product.product_name !== '95ミツヤ もみじ焼き' || product.selling_price !== 199 || product.cost_price !== 95
    || backup.tables.pos_product_edit_dispatch_receipts.some(row => row.operation_id === OP_ID)
    || backup.tables.pos_product_edit_receipts.some(row => row.operation_id === OP_ID)
    || backup.tables.pos_product_operation_locks.filter(row => row.operation_id === OP_ID).length !== 3
    || backup.tables.pos_product_operations.some(row => row.id !== OP_ID && !['completed', 'rejected'].includes(row.status))) {
    fail('RECOVERY_TARGET_OR_QUIESCENCE_INVALID')
  }
  return { op, product }
}
function backup(cli) {
  if (!path.isAbsolute(cli ?? '') || path.basename(cli) !== 'supabase.exe' || !fs.existsSync(cli)) fail('RECOVERY_CLI_INVALID')
  const linkedRoot = path.resolve(ROOT, '../..')
  if (fs.readFileSync(path.join(linkedRoot, 'supabase/.temp/project-ref'), 'utf8').trim() !== PROJECT_REF) fail('RECOVERY_PROJECT_MISMATCH')
  const base = fs.readFileSync(path.join(ROOT, 'supabase/backup_pos_product_cutover.sql'), 'utf8')
  const marker = '), relations AS MATERIALIZED ('
  if (base.split(marker).length !== 2) fail('RECOVERY_BACKUP_SQL_MARKER_INVALID')
  const extra = NEW_TABLES.map(name => `  UNION ALL SELECT ${sqlText(name)}, COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.${name} t`).join('\n')
  const sql = base.replace(marker, extra + '\n' + marker)
  const queryPath = path.join(exportDir, `pos-product-recovery-backup-${randomUUID()}.sql`)
  save(queryPath, sql)
  const result = spawnSync(cli, ['db', 'query', '--linked', '--project-ref', PROJECT_REF, '--output', 'json', '--file', queryPath],
    { cwd: linkedRoot, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, timeout: 120_000, windowsHide: true })
  if (result.status !== 0) fail('RECOVERY_BACKUP_QUERY_FAILED')
  const start = result.stdout.indexOf('{'), end = result.stdout.lastIndexOf('}')
  if (start < 0 || end < start) fail('RECOVERY_BACKUP_RESPONSE_INVALID')
  const response = JSON.parse(result.stdout.slice(start, end + 1))
  if (response.rows?.length !== 1) fail('RECOVERY_BACKUP_RESPONSE_INVALID')
  const data = { projectRef: PROJECT_REF, ...response.rows[0].backup }
  validate(data)
  const payload = JSON.stringify(data, null, 2)
  const outputPath = path.join(exportDir, `pos-product-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`)
  save(outputPath, payload)
  console.log(JSON.stringify({ outputPath, sha256: sha256(payload), bytes: Buffer.byteLength(payload), counts: data.counts,
    migrations: data.migrations.length, readOnly: true, operationUnchanged: true }))
}
function prepare(input) {
  if (!path.isAbsolute(input ?? '')) fail('RECOVERY_BACKUP_PATH_INVALID')
  const payload = fs.readFileSync(input, 'utf8'), checksum = fs.readFileSync(input + '.sha256', 'utf8').trim()
  if (!/^[0-9a-f]{64}$/.test(checksum) || sha256(payload) !== checksum) fail('RECOVERY_BACKUP_CHECKSUM_INVALID')
  const data = JSON.parse(payload), { product } = validate(data)
  const sources = SOURCES.map(([file, hash]) => {
    const source = fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8')
    if (sha256(source) !== hash || /\b(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|VACUUM|CALL)\b|\bCONCURRENTLY\b|^\s*\\/im.test(outerSql(source))) fail('RECOVERY_MIGRATION_SOURCE_CHANGED')
    return { file, source, hash, version: file.slice(0, 14), name: file.slice(15, -4), tag: '$recovery_' + file.slice(0, 14) + '$' }
  })
  if (sources.some(s => s.source.includes(s.tag) || data.migrations.some(row => row.version === s.version))) fail('RECOVERY_MIGRATION_HISTORY_INVALID')
  const jsonTag = (label, value) => {
    const text = JSON.stringify(value), tag = '$recovery_' + label + '$'
    if (text.includes(tag)) fail('RECOVERY_GUARD_TAG_INVALID')
    return tag + text + tag + '::jsonb'
  }
  const checks = NEW_TABLES.map(name => `    OR (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.${name} t)
      IS DISTINCT FROM ${jsonTag(name, data.tables[name])}`).join('\n')
  const guard = `DO $recovery_guard$
BEGIN
  IF current_database()<>'postgres' OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>29
    OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m)
      IS DISTINCT FROM ${jsonTag('history', [...data.migrations].sort((a,b)=>a.version.localeCompare(b.version)))}
    OR to_regclass('public.pos_product_edit_not_sent_proofs') IS NOT NULL
    OR to_regclass('public.pos_product_edit_legacy_closures') IS NOT NULL THEN
    RAISE EXCEPTION 'RECOVERY_PRIOR_HISTORY_CHANGED';
  END IF;
  IF (SELECT to_jsonb(p) FROM public.products p WHERE id=4779) IS DISTINCT FROM ${jsonTag('product', product)}
${checks} THEN RAISE EXCEPTION 'RECOVERY_TARGET_OR_LEDGER_CHANGED'; END IF;
END $recovery_guard$;`
  const body = sources.map(s => `-- ${s.file} SHA-256 ${s.hash}\n${s.source}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES(${sqlText(s.version)},${sqlText(s.name)},ARRAY[${s.tag}${s.source}${s.tag}]::text[]);`).join('\n\n')
  const sql = `-- 承認済みproject ${PROJECT_REF}、移行2本のみ。旧操作解除や商品保存を呼ばない。
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE ${NEW_TABLES.map(name=>'public.'+name).join(',')} IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
${guard}
${body}
COMMIT;
`
  const outer = outerSql(sql)
  if ((outer.match(/\bBEGIN\b/g) ?? []).length !== 1 || (outer.match(/\bCOMMIT\b/g) ?? []).length !== 1
    || (outer.match(/INSERT INTO supabase_migrations\.schema_migrations/g) ?? []).length !== 2
    || /\b(?:SELECT|PERFORM|CALL)\s+public\.close_legacy_pos_product_edit\b/i.test(outer)) fail('RECOVERY_BUNDLE_BOUNDARY_INVALID')
  const base = path.join(exportDir, `pos-product-recovery-apply-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
  save(base + '.sql', sql)
  const manifest = { projectRef: PROJECT_REF, backupPath: input, backupSha256: checksum, sqlPath: base + '.sql', sqlSha256: sha256(sql),
    migrations: sources.map(({ source, tag, ...rest }) => rest), priorHistoryCount: 29, transactionCount: 1, operationMutation: false }
  fs.writeFileSync(base + '.manifest.json', JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ manifestPath: base + '.manifest.json', sqlPath: manifest.sqlPath, sha256: manifest.sqlSha256,
    migrations: 2, transactionCount: 1, databaseConnected: false, operationMutation: false }))
}
try {
  if (process.argv.length !== 4) fail('RECOVERY_ARGUMENTS_INVALID')
  if (process.argv[2] === '--backup') backup(process.argv[3])
  else if (process.argv[2] === '--prepare') prepare(process.argv[3])
  else fail('RECOVERY_ARGUMENTS_INVALID')
} catch (error) {
  console.error(JSON.stringify({ success: false, code: /^RECOVERY_[A-Z_]+$/.test(error?.message) ? error.message : 'RECOVERY_PREPARATION_FAILED' }))
  process.exitCode = 1
}

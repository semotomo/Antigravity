import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// 本番接続を持たない型付きデータ復元試験。保存された関数/trigger/権限DDLは実行しない。
const input = process.argv[2]
if (process.argv.length !== 3 || !input || !path.isAbsolute(input)) throw Error('backupの絶対パスを指定してください。')
const payload = fs.readFileSync(input, 'utf8')
assert.equal(createHash('sha256').update(payload).digest('hex'), fs.readFileSync(`${input}.sha256`, 'utf8').trim())
const backup = JSON.parse(payload)
assert.equal(backup.projectRef, 'wpxewebmezghoulnasre')
assert.equal(backup.format, 'kennel-pos-cutover-v1')
const identifier = name => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw Error('未知の識別子です。')
  return `"${name}"`
}
const columnType = value => {
  if (!/^(?:smallint|integer|bigint|text|boolean|real|double precision|uuid|date|json|jsonb|bytea|(?:time|timestamp)(?:\(\d+\))? (?:with|without) time zone|character varying(?:\(\d+\))?|numeric(?:\(\d+(?:,\d+)?\))?)(?:\[\])?$/.test(value)) {
    throw Error('未対応の列型です。自動復元SQLを生成しません。')
  }
  return value
}
const db = new PGlite()
const counts = {}
try {
  await db.exec("SET TIME ZONE 'UTC'")
  for (const [table, rows] of Object.entries(backup.tables)) {
    const columns = backup.columns.filter(c => c.schema === 'public' && c.table === table).sort((a, b) => a.position - b.position)
    assert.ok(columns.length)
    assert.equal(rows.length, backup.counts[table])
    const definitions = columns.map(c => `${identifier(c.name)} ${columnType(c.type)}${c.notNull ? ' NOT NULL' : ''}`)
    for (const key of backup.constraints.filter(c => c.schema === 'public' && c.table === table && c.kind === 'p')) {
      definitions.push(`PRIMARY KEY (${key.keys.map(position => identifier(columns.find(c => c.position === position).name)).join(',')})`)
    }
    await db.exec(`CREATE TABLE public.${identifier(table)} (${definitions.join(',')})`)
    await db.query(`INSERT INTO public.${identifier(table)} SELECT * FROM jsonb_populate_recordset(NULL::public.${identifier(table)}, $1::jsonb)`, [JSON.stringify(rows)])
    const result = await db.query(`SELECT count(*)::integer AS count, NOT EXISTS (
      (SELECT to_jsonb(t) FROM public.${identifier(table)} t EXCEPT ALL SELECT jsonb_array_elements($1::jsonb))
      UNION ALL (SELECT jsonb_array_elements($1::jsonb) EXCEPT ALL SELECT to_jsonb(t) FROM public.${identifier(table)} t)
    ) AS exact FROM public.${identifier(table)}`, [JSON.stringify(rows)])
    assert.equal(result.rows[0].count, rows.length)
    assert.equal(result.rows[0].exact, true, table)
    counts[table] = rows.length
  }
  console.log(JSON.stringify({ sha256Verified: true, typedTablesVerified: Object.keys(counts).length, counts,
    scope: '型・NOT NULL・主キー・全行全列一致。関数/RLS/外部FKを含む全DB復元試験ではない。' }))
} finally {
  await db.close()
}

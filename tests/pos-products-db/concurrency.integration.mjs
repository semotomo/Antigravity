import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import * as validation from '../../next_app/lib/pos-products/validation.ts'

// 通常の npm test とは分離。既存の4 fixturesと同じ合成DDL・実migrationを通常PGへ適用する。
// 接続先を推測せず、専用loopback clusterとUUID生成済みの所有DBだけを操作する。
const { Client } = pg
const controlDatabase = 'kennel_pos_product_concurrency_control_test'
const databasePrefix = 'kennel_pos_concurrency_test_'
const manager6 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const manager7 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const staff6 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const other6 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const migration = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value)
const normalizePath = value => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()

function configuration(env) {
  const host = env.POS_PRODUCT_TEST_PG_HOST
  const portText = env.POS_PRODUCT_TEST_PG_PORT
  const user = env.POS_PRODUCT_TEST_PG_USER
  const database = env.POS_PRODUCT_TEST_PG_CONTROL_DB
  const dataDirectory = env.POS_PRODUCT_TEST_PG_DATA_DIRECTORY
  assert.ok(host === '127.0.0.1' || host === '::1', 'explicit literal loopback host required')
  assert.match(portText ?? '', /^[1-9]\d{0,4}$/, 'explicit test PG port required')
  assert.ok(Number(portText) <= 65535, 'invalid test PG port')
  assert.match(user ?? '', /^kennel_[a-z0-9_]*test[a-z0-9_]*$/, 'explicit test-only PG user required')
  assert.equal(database, controlDatabase, 'only the dedicated control database is allowed')
  assert.match(dataDirectory ?? '', /^(?:[A-Za-z]:[\\/]|\/).*[/\\]kennel-pos-pg-[a-f0-9]{32}[/\\]data$/, 'dedicated cluster data directory required')
  return { host, port: Number(portText), user, database, dataDirectory,
    password: env.POS_PRODUCT_TEST_PG_PASSWORD ?? '', ssl: false,
    connectionTimeoutMillis: 5000, query_timeout: 18000,
    options: '-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000' }
}

test('接続設定は明示の専用loopback clusterのみ許可し、汎用PG環境変数にfallbackしない', () => {
  const safe = { POS_PRODUCT_TEST_PG_HOST: '127.0.0.1', POS_PRODUCT_TEST_PG_PORT: '60259',
    POS_PRODUCT_TEST_PG_USER: 'kennel_pg_test_admin', POS_PRODUCT_TEST_PG_CONTROL_DB: controlDatabase,
    POS_PRODUCT_TEST_PG_DATA_DIRECTORY: 'C:\\temp\\kennel-pos-pg-' + 'a'.repeat(32) + '\\data' }
  assert.equal(configuration(safe).port, 60259)
  assert.equal(configuration({ ...safe, POS_PRODUCT_TEST_PG_HOST: '::1' }).host, '::1')
  for (const change of [{ POS_PRODUCT_TEST_PG_HOST: 'localhost' }, { POS_PRODUCT_TEST_PG_HOST: 'db.example.invalid' },
    { POS_PRODUCT_TEST_PG_HOST: '127.0.0.1.example.invalid' }, { POS_PRODUCT_TEST_PG_PORT: '0' },
    { POS_PRODUCT_TEST_PG_PORT: '65536' }, { POS_PRODUCT_TEST_PG_USER: 'postgres' },
    { POS_PRODUCT_TEST_PG_CONTROL_DB: 'postgres' }, { POS_PRODUCT_TEST_PG_CONTROL_DB: 'production' },
    { POS_PRODUCT_TEST_PG_DATA_DIRECTORY: 'C:\\production\\data' }]) assert.throws(() => configuration({ ...safe, ...change }))
  for (const key of Object.keys(safe)) { const missing = { ...safe }; delete missing[key]; assert.throws(() => configuration(missing)) }
  assert.throws(() => configuration({ PGHOST: safe.POS_PRODUCT_TEST_PG_HOST, PGUSER: safe.POS_PRODUCT_TEST_PG_USER,
    PGPORT: safe.POS_PRODUCT_TEST_PG_PORT, PGDATABASE: controlDatabase, DATABASE_URL: 'postgres://localhost/production' }))
})

const rpcValue = async (client, sql, args) => (await client.query(sql, args)).rows[0].result
async function begin(client, service = true) {
  await client.query('BEGIN')
  if (service) await client.query('SET LOCAL ROLE service_role')
}
async function rpc(client, sql, args) {
  await begin(client)
  try { const result = await rpcValue(client, sql, args); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error }
}
function pending(promise) {
  const state = { settled: false }
  state.result = promise.then(value => { state.settled = true; return { ok: true, value } },
    error => { state.settled = true; return { ok: false, error } })
  return state
}
async function success(state) {
  const result = await state.result
  if (!result.ok) throw result.error
  return result.value
}
async function failure(state, code, message) {
  const result = await state.result
  assert.equal(result.ok, false, 'blocked action must fail without retry')
  assert.equal(result.error.code, code)
  if (message) assert.match(result.error.message, message)
  return result.error
}

async function blocked(h, waiter, blocker, action) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const row = (await h.observer.query(`SELECT wait_event_type, pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity WHERE pid=$1`, [waiter.processID])).rows[0]
    if (row?.wait_event_type === 'Lock' && row.blockers.includes(blocker.processID)) {
      h.barriers++
      return
    }
    if (action.settled) {
      const outcome = await action.result
      assert.fail('action completed before the required lock barrier: ' + (outcome.ok ? 'success' : outcome.error.code))
    }
    await delay(25)
  }
  assert.fail('lock barrier was not observed within 5 seconds')
}
async function waitPast(h, deadlineMs) {
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) {
    if (await now(h.observer) > deadlineMs + 25) return
    await delay(40)
  }
  assert.fail('database clock did not pass the synthetic expiry')
}
const now = async client => Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms')).rows[0].ms)

async function setup(client) {
  // 既存dispatch/sync/apply fixturesの合成スキーマを共有し、本番テーブルを読まない。
  await client.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
    CREATE TABLE public.stores(id integer PRIMARY KEY); INSERT INTO public.stores VALUES(6),(7);
    INSERT INTO auth.users VALUES('${manager6}'),('${manager7}'),('${staff6}'),('${other6}');
    CREATE TABLE public.products(id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, store_id integer NOT NULL REFERENCES public.stores(id),
      jan_code text NOT NULL, product_name text, category text, product_group text, supplier_name text,
      cost_price integer, selling_price integer, markup_rate real, is_active boolean DEFAULT true, tags text,
      brand text, updated_at timestamptz DEFAULT clock_timestamp(), UNIQUE(store_id,jan_code), UNIQUE(id,store_id));
    CREATE TABLE public.harness_transaction_markers(id text PRIMARY KEY);
    GRANT SELECT,INSERT ON public.harness_transaction_markers TO service_role;`)
  // 本番で確認済みの列型を、合成DDLでも厳密に一致させる。
  assert.deepEqual((await client.query(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products'
      AND column_name IN ('product_name','cost_price','selling_price','markup_rate') ORDER BY column_name`)).rows, [
    { column_name: 'cost_price', data_type: 'integer' }, { column_name: 'markup_rate', data_type: 'real' },
    { column_name: 'product_name', data_type: 'text' }, { column_name: 'selling_price', data_type: 'integer' },
  ])
  await client.query(await migration('20260823163000_inventory_phase1_schema.sql'))
  const alias = await migration('20260328173000_phase1_additive.sql')
  const from = alias.indexOf('CREATE TABLE IF NOT EXISTS public.product_aliases')
  const to = alias.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_alias_source_unique')
  assert.ok(from >= 0 && to > from, 'alias fixture migration boundaries changed')
  await client.query(alias.slice(from, to))
  await client.query(`ALTER TABLE public.product_aliases ADD COLUMN store_id integer NOT NULL REFERENCES public.stores(id);
    CREATE UNIQUE INDEX alias_store_unique ON public.product_aliases(alias_name,source_system,store_id);
    INSERT INTO public.user_store_access(user_id,store_id,role) VALUES
      ('${manager6}',6,'manager'),('${manager7}',7,'manager'),('${staff6}',6,'staff'),('${other6}',6,'manager');
    ALTER TABLE public.inventory_product_settings ADD COLUMN manually_inactive boolean NOT NULL DEFAULT false;`)
  const manual = await migration('20260824090000_inventory_phase4_management.sql')
  const manualFrom = manual.indexOf('CREATE OR REPLACE FUNCTION private.enforce_inventory_manual_inactive()')
  const manualTo = manual.indexOf('-- 商品行が別端末')
  assert.ok(manualFrom >= 0 && manualTo > manualFrom, 'manual inactive fixture migration boundaries changed')
  await client.query(manual.slice(manualFrom, manualTo))
  for (const name of ['20260908120000_pos_product_operation_ledger.sql', '20260908121000_pos_product_operation_functions.sql',
    '20260910090000_product_master_sync_fence.sql', '20260910120000_pos_product_edit_apply.sql', '20261004120000_pos_product_edit_dispatch.sql',
    '20261005120000_pos_product_operation_cancellation.sql']) {
    await client.query(await migration(name))
  }
}

async function harness(t, action) {
  const config = configuration(process.env)
  const admin = new Client({ ...config, application_name: 'kennel-pos-concurrency-control' })
  const clients = []
  const name = databasePrefix + randomUUID().replaceAll('-', '')
  const nonce = 'kennel-concurrency-owned:' + randomUUID()
  assert.match(name, /^kennel_pos_concurrency_test_[a-f0-9]{32}$/)
  assert.ok(Buffer.byteLength(name) < 64)
  let created = false, owner
  try {
    await admin.connect()
    const identity = (await admin.query(`SELECT current_database() AS database, current_user AS username,
      current_setting('data_directory') AS data_directory, current_setting('server_version') AS version,
      current_setting('server_version_num')::int AS version_num, oid, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]
    assert.equal(identity.database, controlDatabase)
    assert.equal(identity.username, config.user)
    assert.equal(normalizePath(identity.data_directory), normalizePath(config.dataDirectory), 'cluster identity mismatch; no database may be created')
    assert.ok(identity.version_num >= 170000, 'normal PostgreSQL 17 or newer required')
    assert.equal(identity.rolsuper, true, 'synthetic isolated cluster admin required')
    owner = identity.oid
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const existing = (await admin.query('SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1', [role])).rows[0]
      if (!existing) await admin.query(`CREATE ROLE ${role} NOLOGIN ${role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`)
      else assert.deepEqual(existing, { rolcanlogin: false, rolsuper: false, rolbypassrls: role === 'service_role' }, 'unexpected synthetic role attributes')
    }
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [name])).rows[0].n, 0)
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
    created = true
    await admin.query(`COMMENT ON DATABASE "${name}" IS '${nonce}'`)
    const connect = async label => {
      const client = new Client({ ...config, database: name, application_name: 'kennel-pos-concurrency-' + label })
      clients.push(client)
      await client.connect()
      assert.equal((await client.query('SELECT current_database() AS database')).rows[0].database, name)
      return client
    }
    const observer = await connect('observer')
    await setup(observer)
    const a = await connect('A'), b = await connect('B')
    assert.notEqual(a.processID, b.processID, 'two independent action backends required')
    assert.notEqual(observer.processID, a.processID)
    assert.notEqual(observer.processID, b.processID)
    const h = { a, b, observer, barriers: 0 }
    await action(h)
    t.diagnostic(`PostgreSQL ${identity.version}; distinct action backends; confirmed lock barriers=${h.barriers}`)
  } finally {
    // transactionを終え全child接続を閉じてから、名前/nonce/owner一致を再検査する。FORCEや他backend停止はしない。
    for (const client of clients) {
      if (client._connected && !client._ending) {
        try { await client.query('ROLLBACK') } finally { await client.end() }
      } else await client.end()
    }
    try {
      if (created) {
        const owned = (await admin.query(`SELECT datname,datdba,shobj_description(oid,'pg_database') AS marker
          FROM pg_database WHERE datname=$1`, [name])).rows[0]
        assert.deepEqual(owned, { datname: name, datdba: owner, marker: nonce }, 'refuse to drop a database with changed ownership')
        assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [name])).rows[0].n, 0,
          'refuse to drop a database with remaining connections')
        await admin.query(`DROP DATABASE "${name}"`)
        assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [name])).rows[0].n, 0)
        t.diagnostic('owned UUID test database dropped; control database preserved')
      }
    } finally { await admin.end() }
  }
}
const integration = (name, action) => test(name, { timeout: 45000 }, t => harness(t, action))
const opArgs = op => [op.actor_id, op.store_id, op.id, op.payload_hash, op.row_version]
const prepareSql = 'SELECT public.prepare_pos_product_edit($1,$2,$3,$4,$5) AS result'
const claimSql = 'SELECT public.claim_pos_product_operation($1,$2,$3,$4,$5) AS result'
const consumeSql = 'SELECT public.consume_pos_product_edit_dispatch($1,$2,$3,$4) AS result'
const applySql = 'SELECT public.apply_pos_product_edit($1,$2,$3,$4,$5) AS result'
const cancelSql = 'SELECT public.cancel_pos_product_edit($1,$2,$3,$4) AS result'
const recoveryStateSql = 'SELECT public.get_pos_product_edit_recovery_state($1,$2,$3,$4) AS result'
const cancellationArgs = x => [x.actor, x.command.storeId, x.product.id, x.command.operationId]
const syncSql = 'SELECT public.apply_product_master_sync($1,$2,$3::jsonb) AS result'
const prepareArgs = x => [x.actor, JSON.stringify(x.command), x.before.identity.posProductId, hash(x.expectedText), JSON.stringify(x.catalog)]
const consumeArgs = x => [x.actor, x.command.storeId, x.op.id, hash(x.dispatchText)]
const count = async (h, table, operation) => (await h.observer.query(`SELECT count(*)::int AS n FROM public.${table}${operation ? ' WHERE operation_id=$1' : ''}`,
  operation ? [operation] : [])).rows[0].n
const product = async (h, id) => (await h.observer.query('SELECT * FROM public.products WHERE id=$1', [id])).rows[0]
const operation = async (h, id) => (await h.observer.query('SELECT * FROM public.pos_product_operations WHERE id=$1', [id])).rows[0]

let sequence = 10000000
async function fixture(h, store = 6, jan = String(++sequence)) {
  const actor = store === 6 ? manager6 : manager7
  const p = (await h.observer.query(`INSERT INTO public.products(store_id,jan_code,product_name,category,product_group,supplier_name,cost_price,selling_price,brand)
    VALUES($1,$2,'旧名','分類','分類','仕入先',50,100,'保持') RETURNING *`, [store, jan])).rows[0]
  const reviewedAt = await now(h.observer)
  const before = {
    identity: { posProductId: 'pos-' + store + '-' + jan, officeId: store === 7 ? '11053' : '11054', groupId: store === 7 ? '11098' : '11099',
      salesKind: 'retail', productCode: '', manufacturerCode: jan, exclusiveStore: true },
    fields: { name: '旧名', groupId: 'g1', price: '100', cost: '50', supplierId: 's1' },
    settings: { nameKana: 'キュウメイ', abbreviation: '旧略称', taxId: '0', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'a'.repeat(64) },
    groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '別分類' }], suppliers: [{ id: 's1', name: '仕入先' }],
  }
  const fields = { ...before.fields, name: '新名' }
  const fingerprintValue = f => ({ version: 'pos-product-edit.v1', storeId: store, productId: p.id, janCode: jan,
    identity: before.identity, fields: f, settings: before.settings })
  const beforeText = JSON.stringify(fingerprintValue(before.fields)), expectedText = JSON.stringify(fingerprintValue(fields))
  const command = validation.parsePosProductCommand({ kind: 'update', operationId: randomUUID(), storeId: store,
    productId: p.id, expectedFingerprint: hash(beforeText), fields })
  const catalog = { groupId: 'g1', groupName: '分類', supplierId: 's1', supplierName: '仕入先', previousPosName: '旧名' }
  return { actor, product: p, command, catalog, before, beforeText, expectedText, reviewedAt }
}
async function prepare(h, x) { x.op = await rpc(h.a, prepareSql, prepareArgs(x)); return x.op }
async function register(h, x, expiry = x.reviewedAt + 110000) {
  x.dispatchText = canonical({ operationId: x.op.id, actorId: x.actor, storeId: x.command.storeId, janCode: x.product.jan_code,
    before: x.before, patch: { goodsName: '新名' }, expiresAt: expiry })
  await rpc(h.a, 'SELECT public.register_pos_product_edit_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
    [...opArgs(x.op), x.dispatchText, x.beforeText, x.expectedText, x.reviewedAt])
}
async function claim(h, x) { const result = await rpc(h.a, claimSql, opArgs(x.op)); assert.equal(result.claimed, true); x.op = result.operation }
const syncRow = (x, jan = x.product.jan_code) => ({ store_id: x.command.storeId, jan_code: jan, product_name: '同期商品', category: '分類',
  product_group: '分類', selling_price: 999, cost_price: 499, markup_rate: 0.5005, is_active: true, tags: x.command.storeId === 6 ? 'わんわん' : '本店' })
const syncArgs = (run, rows) => [run.id, run.storeId, JSON.stringify(rows)]
const syncBegin = (h, store = 6) => rpc(h.a, 'SELECT public.begin_product_master_sync($1) AS result', [store])
const snapshot = async h => ({ products: (await h.observer.query('SELECT * FROM public.products ORDER BY id')).rows,
  versions: (await h.observer.query('SELECT * FROM public.product_master_store_versions ORDER BY store_id')).rows,
  runs: (await h.observer.query('SELECT * FROM public.product_master_sync_runs ORDER BY id')).rows })

integration('同一operationの同時受付はロック後に同一固定recordへ合流する', async h => {
  const x = await fixture(h)
  await begin(h.a); const first = await rpcValue(h.a, prepareSql, prepareArgs(x))
  await begin(h.b); const second = pending(rpcValue(h.b, prepareSql, prepareArgs(x)))
  await blocked(h, h.b, h.a, second)
  await h.a.query('COMMIT')
  assert.deepEqual(await success(second), first)
  await h.b.query('COMMIT')
  assert.equal(await count(h, 'pos_product_operations'), 1)
  assert.equal(await count(h, 'pos_product_operation_events', first.id), 1)
  assert.equal(await count(h, 'pos_product_edit_intents', first.id), 1)
  assert.equal(await count(h, 'pos_product_operation_locks', first.id), 3)
})

integration('別operationの同一JAN受付は待機後に拒否し、部分recordも予約も残さない', async h => {
  const x = await fixture(h), y = { ...x, command: { ...x.command, operationId: randomUUID() } }
  await begin(h.a); const first = await rpcValue(h.a, prepareSql, prepareArgs(x))
  await begin(h.b); const second = pending(rpcValue(h.b, prepareSql, prepareArgs(y)))
  await blocked(h, h.b, h.a, second); await h.a.query('COMMIT')
  await failure(second, '55P03', /resource busy/); await h.b.query('ROLLBACK')
  assert.equal(await count(h, 'pos_product_operations'), 1)
  assert.equal(await operation(h, y.command.operationId), undefined)
  assert.equal(await count(h, 'pos_product_operation_events', y.command.operationId), 0)
  assert.equal(await count(h, 'pos_product_edit_intents', y.command.operationId), 0)
  assert.equal(await count(h, 'pos_product_operation_locks', y.command.operationId), 0)
  assert.equal(await count(h, 'pos_product_operation_locks', first.id), 3)
})

integration('別店舗の同一JAN・別POS実体は他店舗の未commit中でも独立に受付できる', async h => {
  const x = await fixture(h, 6), y = await fixture(h, 7, x.product.jan_code)
  await begin(h.a); const first = await rpcValue(h.a, prepareSql, prepareArgs(x))
  await begin(h.b)
  // 待機すればfailする短いlock_timeoutを併用し、A未commitのままB完了を確認する。
  await h.b.query("SET LOCAL lock_timeout='1s'")
  const second = await rpcValue(h.b, prepareSql, prepareArgs(y)); await h.b.query('COMMIT')
  assert.equal(await operation(h, first.id), undefined)
  assert.equal((await operation(h, second.id)).store_id, 7)
  await h.a.query('COMMIT')
  assert.equal(await count(h, 'pos_product_operations'), 2)
  assert.equal(await count(h, 'pos_product_operation_locks'), 6)
})

integration('claimとconsumeは競合待機後もtrue各1回・attempt/receipt各1件だけ', async h => {
  const x = await fixture(h); await prepare(h, x); await register(h, x)
  await begin(h.a); const first = await rpcValue(h.a, claimSql, opArgs(x.op))
  await begin(h.b); const second = pending(rpcValue(h.b, claimSql, opArgs(x.op)))
  await blocked(h, h.b, h.a, second); await h.a.query('COMMIT')
  assert.equal(first.claimed, true); const resumed = await success(second)
  assert.equal(resumed.claimed, false); assert.deepEqual(resumed.operation, first.operation)
  await h.b.query('COMMIT'); x.op = first.operation
  await begin(h.a); const accepted = await rpcValue(h.a, consumeSql, consumeArgs(x))
  await begin(h.b); const duplicate = pending(rpcValue(h.b, consumeSql, consumeArgs(x)))
  await blocked(h, h.b, h.a, duplicate); await h.a.query('COMMIT')
  assert.equal(accepted.accepted, true); assert.deepEqual(await success(duplicate), { ...accepted, accepted: false })
  await h.b.query('COMMIT')
  assert.equal((await operation(h, x.op.id)).send_attempts, 1)
  assert.equal(await count(h, 'pos_product_operation_events', x.op.id), 2)
  assert.equal(await count(h, 'pos_product_edit_dispatch_receipts', x.op.id), 1)
})

integration('claimはoperation行ロック待機中の期限経過を拒否し、送信回数を増やさない', async h => {
  const x = await fixture(h)
  // immutable期限を直接改変しない。所有合成DBの新規行defaultだけ短縮する。
  await h.observer.query("ALTER TABLE public.pos_product_operations ALTER COLUMN dispatch_expires_at SET DEFAULT clock_timestamp()+interval '3 seconds'")
  await prepare(h, x)
  await h.observer.query("ALTER TABLE public.pos_product_operations ALTER COLUMN dispatch_expires_at SET DEFAULT clock_timestamp()+interval '15 minutes'")
  await begin(h.a, false); await h.a.query('SELECT id FROM public.pos_product_operations WHERE id=$1 FOR UPDATE', [x.op.id])
  await begin(h.b); const waiting = pending(rpcValue(h.b, claimSql, opArgs(x.op)))
  await blocked(h, h.b, h.a, waiting); await waitPast(h, Date.parse(x.op.dispatch_expires_at))
  await h.a.query('COMMIT'); await failure(waiting, '22023', /expired/); await h.b.query('ROLLBACK')
  const unchanged = await operation(h, x.op.id)
  assert.equal(unchanged.status, 'prepared'); assert.equal(unchanged.send_attempts, 0)
  assert.equal(await count(h, 'pos_product_operation_events', x.op.id), 1)
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 3)
})

integration('consumeは商品行ロック待機後にも期限を再検査しreceiptを作らない', async h => {
  const x = await fixture(h); await prepare(h, x)
  const expiry = await now(h.observer) + 3000
  await register(h, x, expiry); await claim(h, x)
  await begin(h.a, false); await h.a.query('SELECT id FROM public.products WHERE id=$1 FOR UPDATE', [x.product.id])
  await begin(h.b); const waiting = pending(rpcValue(h.b, consumeSql, consumeArgs(x)))
  await blocked(h, h.b, h.a, waiting); await waitPast(h, expiry)
  // 公開consumeの拒否理由は秘匿された固定メッセージ。期限経過と未作成receiptを併せて検証する。
  await h.a.query('COMMIT'); await failure(waiting, '22023', /^POS_PRODUCT_EDIT_DISPATCH_REJECTED$/); await h.b.query('ROLLBACK')
  const unchanged = await operation(h, x.op.id)
  assert.equal(unchanged.status, 'dispatching'); assert.equal(unchanged.send_attempts, 1)
  assert.equal(await count(h, 'pos_product_edit_dispatch_receipts', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 3)
})

for (const step of ['claim', 'consume']) integration(`${step}はmanager行ロック待機中の権限剥奪を再評価して拒否する`, async h => {
  const x = await fixture(h); await prepare(h, x); await register(h, x)
  if (step === 'consume') await claim(h, x)
  await begin(h.a, false); await h.a.query("UPDATE public.user_store_access SET role='staff' WHERE user_id=$1 AND store_id=6", [manager6])
  await begin(h.b); const waiting = pending(rpcValue(h.b, step === 'claim' ? claimSql : consumeSql, step === 'claim' ? opArgs(x.op) : consumeArgs(x)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  await failure(waiting, '42501', /manager access denied/); await h.b.query('ROLLBACK')
  const unchanged = await operation(h, x.op.id)
  assert.equal(unchanged.status, step === 'claim' ? 'prepared' : 'dispatching')
  assert.equal(unchanged.send_attempts, step === 'claim' ? 0 : 1)
  assert.equal(await count(h, 'pos_product_edit_dispatch_receipts', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 3)
})

integration('編集受付commit後に待機中の旧CSV同期を全transaction拒否する', async h => {
  const x = await fixture(h), run = await syncBegin(h), before = await product(h, x.product.id)
  await begin(h.a); await rpcValue(h.a, prepareSql, prepareArgs(x))
  await begin(h.b); await h.b.query("INSERT INTO public.harness_transaction_markers VALUES('stale-sync')")
  const waiting = pending(rpcValue(h.b, syncSql, syncArgs(run, [syncRow(x), syncRow(x, '10000099')])))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  await failure(waiting, '40001', /stale sync/); await h.b.query('ROLLBACK')
  assert.deepEqual(await product(h, x.product.id), before)
  assert.equal(await count(h, 'products'), 1); assert.equal(await count(h, 'harness_transaction_markers'), 0)
  assert.equal((await h.observer.query('SELECT state FROM public.product_master_sync_runs WHERE id=$1', [run.id])).rows[0].state, 'pending')
  await assert.rejects(syncBegin(h), error => error.code === '55000')
})

integration('同期transaction rollback後は待機中の編集が元のbaselineだけを固定する', async h => {
  const x = await fixture(h), run = await syncBegin(h), before = await snapshot(h)
  await begin(h.a); const applied = await rpcValue(h.a, syncSql, syncArgs(run, [syncRow(x)])); assert.equal(applied.success, true)
  await begin(h.b); const waiting = pending(rpcValue(h.b, prepareSql, prepareArgs(x)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('ROLLBACK')
  const accepted = await success(waiting); await h.b.query('COMMIT')
  assert.equal(accepted.status, 'prepared')
  const after = await snapshot(h)
  assert.deepEqual(after.products, before.products); assert.deepEqual(after.runs, before.runs)
  assert.equal(BigInt(after.versions[0].revision), BigInt(before.versions[0].revision) + 1n)
  const baseline = (await h.observer.query('SELECT baseline FROM public.pos_product_edit_intents WHERE operation_id=$1', [accepted.id])).rows[0].baseline
  assert.equal(baseline.product_name, '旧名'); assert.equal(baseline.selling_price, 100)
})

integration('旧writerの商品先行lockと同期の店舗先行lockがdeadlockしても両transactionを全rollbackできる', async h => {
  const x = await fixture(h), run = await syncBegin(h), before = await snapshot(h)
  await begin(h.b, false); await h.b.query('SELECT id FROM public.products WHERE id=$1 FOR UPDATE', [x.product.id])
  await h.b.query("INSERT INTO public.harness_transaction_markers VALUES('legacy-writer')")
  await begin(h.a); await h.a.query("INSERT INTO public.harness_transaction_markers VALUES('sync-writer')")
  const syncing = pending(rpcValue(h.a, syncSql, syncArgs(run, [syncRow(x)])))
  await blocked(h, h.a, h.b, syncing)
  const legacy = pending(h.b.query("UPDATE public.products SET product_name='旧writer更新' WHERE id=$1", [x.product.id]))
  const outcomes = await Promise.all([syncing.result, legacy.result])
  assert.equal(outcomes.filter(result => result.ok).length, 1)
  assert.equal(outcomes.filter(result => !result.ok && result.error.code === '40P01').length, 1)
  await h.a.query('ROLLBACK'); await h.b.query('ROLLBACK')
  assert.deepEqual(await snapshot(h), before)
  assert.equal(await count(h, 'harness_transaction_markers'), 0)
})

integration('旧writerがcommitしたbaseline変更を待機中DB反映が上書きせず、予約とPOS確認状態を保持する', async h => {
  const x = await fixture(h); await prepare(h, x); await register(h, x); await claim(h, x)
  await rpc(h.a, consumeSql, consumeArgs(x))
  x.op = await rpc(h.a, 'SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(x.op), 'dispatch_returned', null])
  x.op = await rpc(h.a, 'SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(x.op), 'pos_verified', hash(x.expectedText)])
  await begin(h.a, false); await h.a.query("UPDATE public.products SET selling_price=777 WHERE id=$1", [x.product.id])
  await begin(h.b); await h.b.query("INSERT INTO public.harness_transaction_markers VALUES('edit-apply')")
  const waiting = pending(rpcValue(h.b, applySql, opArgs(x.op)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  await failure(waiting, '40001', /local product changed/); await h.b.query('ROLLBACK')
  assert.equal((await product(h, x.product.id)).selling_price, 777)
  assert.equal((await operation(h, x.op.id)).status, 'pos_confirmed')
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 3)
  assert.equal(await count(h, 'pos_product_edit_receipts', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_links'), 0); assert.equal(await count(h, 'product_aliases'), 0)
  assert.equal(await count(h, 'harness_transaction_markers'), 0)
})

integration('未作成取消のcommitを待つprepareはtombstoneで拒否され、遅延した操作/予約を作らない', async h => {
  const x = await fixture(h), original = await product(h, x.product.id)
  await begin(h.a); const cancelled = await rpcValue(h.a, cancelSql, cancellationArgs(x))
  assert.equal(cancelled.operation, null)
  await begin(h.b); const waiting = pending(rpcValue(h.b, prepareSql, prepareArgs(x)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  await failure(waiting, '22023', /CANCELLATION_REJECTED/); await h.b.query('ROLLBACK')
  assert.equal(await operation(h, x.command.operationId), undefined)
  assert.equal(await count(h, 'pos_product_operation_locks', x.command.operationId), 0)
  assert.equal(await count(h, 'pos_product_operation_cancellations', x.command.operationId), 1)
  assert.deepEqual(await product(h, x.product.id), original)
})

integration('旧prepare_operationも同じID advisoryを待ち、取消後INSERTをtriggerで拒否する', async h => {
  const x = await fixture(h)
  await begin(h.a); await rpcValue(h.a, cancelSql, cancellationArgs(x))
  await begin(h.b); const waiting = pending(rpcValue(h.b, 'SELECT public.prepare_pos_product_operation($1,$2,$3,$4) AS result', prepareArgs(x).slice(0,4)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  await failure(waiting, '22023', /CANCELLATION_REJECTED/); await h.b.query('ROLLBACK')
  assert.equal(await operation(h, x.command.operationId), undefined)
  assert.equal(await count(h, 'pos_product_operation_events', x.command.operationId), 0)
})

integration('先行prepareのcommitを待つ取消は同じpreparedを監査付きで一度だけ解除する', async h => {
  const x = await fixture(h)
  await begin(h.a); x.op = await rpcValue(h.a, prepareSql, prepareArgs(x))
  await begin(h.b); const waiting = pending(rpcValue(h.b, cancelSql, cancellationArgs(x)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  const cancelled = await success(waiting); await h.b.query('COMMIT')
  assert.equal(cancelled.operation.status, 'rejected'); assert.equal(cancelled.operation.send_attempts, 0)
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_operation_events', x.op.id), 2)
  assert.equal(await count(h, 'pos_product_operation_cancellations', x.op.id), 1)
})

integration('実行権consumeの行ロックを待つ取消は消費後の操作を解除せず、receipt/予約/監査を保つ', async h => {
  const x = await fixture(h); await prepare(h, x); await register(h, x); await claim(h, x)
  await begin(h.a); assert.equal((await rpcValue(h.a, consumeSql, consumeArgs(x))).accepted, true)
  await begin(h.b); const waiting = pending(rpcValue(h.b, cancelSql, cancellationArgs(x)))
  await blocked(h, h.b, h.a, waiting); await h.a.query('COMMIT')
  await failure(waiting, '22023', /CANCELLATION_REJECTED/); await h.b.query('ROLLBACK')
  assert.equal((await operation(h, x.op.id)).status, 'dispatching')
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 3)
  assert.equal(await count(h, 'pos_product_edit_dispatch_receipts', x.op.id), 1)
  assert.equal(await count(h, 'pos_product_operation_cancellations', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_operation_events', x.op.id), 2)
})

integration('先行DB反映の店舗lockを読取り救済/取消が共有し、完了後は取消せずterminalだけ確認する', async h => {
  const x = await fixture(h); await prepare(h, x); await register(h, x); await claim(h, x)
  await rpc(h.a, consumeSql, consumeArgs(x))
  x.op = await rpc(h.a, 'SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(x.op), 'dispatch_returned', null])
  x.op = await rpc(h.a, 'SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(x.op), 'pos_verified', hash(x.expectedText)])
  await begin(h.a); const completed = await rpcValue(h.a, applySql, opArgs(x.op))
  await begin(h.b); const reading = pending(rpcValue(h.b, recoveryStateSql, cancellationArgs(x)))
  await blocked(h, h.b, h.a, reading); await h.a.query('COMMIT')
  assert.equal((await success(reading)).operation.status, 'completed'); await h.b.query('COMMIT')
  await assert.rejects(rpc(h.b, cancelSql, cancellationArgs(x)), error => error.code === '22023')
  // RPCのJSON表現同士で全列比較する。pgのDate/bigint変換による表現差や精度欠落を避ける。
  const unchanged = (await h.observer.query('SELECT to_jsonb(op) AS value FROM public.pos_product_operations AS op WHERE id=$1',[x.op.id])).rows[0].value
  assert.deepEqual(unchanged, completed)
  assert.equal(await count(h, 'pos_product_operation_locks', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_operation_cancellations', x.op.id), 0)
  assert.equal(await count(h, 'pos_product_edit_receipts', x.op.id), 1)
})

const masterRequestBeginSql = 'SELECT public.begin_product_master_sync_request($1,$2,$3) AS result'
const masterRequestStatusSql = 'SELECT public.get_product_master_sync_request($1,$2) AS result'
const masterRequestArgs = async (h, id, store = 6) => [store, id, new Date(await now(h.observer) + 100000).toISOString()]

integration('新版同期の同UUID並行開始は店舗lock後に一件だけ開始権を得る', async h => {
  await h.observer.query(await migration('20261005123000_product_master_sync_gateway.sql'))
  const id = randomUUID(), args = await masterRequestArgs(h, id)
  await begin(h.a); const first = await rpcValue(h.a, masterRequestBeginSql, args)
  await begin(h.b); const replay = pending(rpcValue(h.b, masterRequestBeginSql, args))
  await blocked(h, h.b, h.a, replay); await h.a.query('COMMIT')
  const denied = await success(replay); await h.b.query('COMMIT')
  assert.equal(first.accepted, true); assert.equal(first.id, id)
  assert.equal(denied.accepted, false); assert.equal(denied.code, 'PRODUCT_SYNC_STALE')
  assert.equal(await count(h, 'product_master_sync_runs'), 1)
  assert.equal(await count(h, 'product_master_sync_requests'), 1)
})

integration('未作成同期の状態確認と遅延開始は直列化し、tombstone後のCSV取得を許可しない', async h => {
  await h.observer.query(await migration('20261005123000_product_master_sync_gateway.sql'))
  const missingId = randomUUID(), missingArgs = await masterRequestArgs(h, missingId)
  await begin(h.a); const sealed = await rpcValue(h.a, masterRequestStatusSql, [6, missingId])
  await begin(h.b); const delayed = pending(rpcValue(h.b, masterRequestBeginSql, missingArgs))
  await blocked(h, h.b, h.a, delayed); await h.a.query('COMMIT')
  assert.equal(sealed.found, false); assert.equal(sealed.terminal, true); assert.equal(sealed.outcome, 'rejected')
  assert.equal((await success(delayed)).accepted, false); await h.b.query('COMMIT')
  assert.equal(await count(h, 'product_master_sync_runs'), 0)
  // 逆順でも状態確認は開始commitを待ち、未作成との誤判定をしない。
  const startedId = randomUUID(), startedArgs = await masterRequestArgs(h, startedId)
  await begin(h.a); assert.equal((await rpcValue(h.a, masterRequestBeginSql, startedArgs)).accepted, true)
  await begin(h.b); const reading = pending(rpcValue(h.b, masterRequestStatusSql, [6, startedId]))
  await blocked(h, h.b, h.a, reading); await h.a.query('COMMIT')
  const observed = await success(reading); await h.b.query('COMMIT')
  assert.equal(observed.state, 'pending'); assert.equal(observed.terminal, false); assert.equal(observed.runId, startedId)
  assert.equal(await count(h, 'product_master_sync_runs'), 1)
})

integration('新版同期状態確認はapply待機後に再読し、期限超過でもcommit成功とrollback未適用を区別する', async h => {
  const x = await fixture(h)
  await h.observer.query(await migration('20261005123000_product_master_sync_gateway.sql'))
  for (const finish of ['COMMIT', 'ROLLBACK']) {
    const id = randomUUID(), run = await rpc(h.a, masterRequestBeginSql, await masterRequestArgs(h, id))
    const deadline = await now(h.observer) + 3000, before = await product(h, x.product.id)
    // 所有する合成DBの当該runだけ期限を短縮し、実DB時計の経過を確認する。
    await h.observer.query('UPDATE public.product_master_sync_runs SET expires_at=$2 WHERE id=$1', [id, new Date(deadline).toISOString()])
    await begin(h.a); const applied = await rpcValue(h.a, syncSql, syncArgs(run, [{ ...syncRow(x), product_name: finish + '同期' }]))
    assert.equal(applied.success, true)
    await begin(h.b); const reading = pending(rpcValue(h.b, masterRequestStatusSql, [6, id]))
    await blocked(h, h.b, h.a, reading); await waitPast(h, deadline); await h.a.query(finish)
    const observed = await success(reading); await h.b.query('COMMIT')
    assert.equal(observed.terminal, true); assert.equal(observed.runId, id)
    if (finish === 'COMMIT') {
      assert.equal(observed.state, 'applied'); assert.equal(observed.success, true); assert.equal(observed.syncResult.count, 1)
      assert.equal((await product(h, x.product.id)).product_name, finish + '同期')
    } else {
      assert.equal(observed.state, 'rejected'); assert.equal(observed.code, 'PRODUCT_SYNC_EXPIRED')
      assert.deepEqual(await product(h, x.product.id), before)
      await assert.rejects(rpc(h.a, syncSql, syncArgs(run, [syncRow(x)])), error => error.code === '55000' && error.message === 'sync expired')
      assert.deepEqual(await product(h, x.product.id), before)
    }
  }
})

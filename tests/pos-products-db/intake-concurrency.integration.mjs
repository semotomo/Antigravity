import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { setupIntakeDatabase, manager } from './intake-fixture.mjs'

// 専用runnerが作る合成loopback cluster以外へは接続しない。
const normalize = value => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()
function configuration(env) {
  assert.equal(env.POS_PRODUCT_INTAKE_TEST_HOST, '127.0.0.1')
  assert.match(env.POS_PRODUCT_INTAKE_TEST_PORT ?? '', /^[1-9]\d{0,4}$/)
  assert.ok(Number(env.POS_PRODUCT_INTAKE_TEST_PORT) <= 65535)
  assert.equal(env.POS_PRODUCT_INTAKE_TEST_USER, 'kennel_pg_intake_test')
  assert.equal(env.POS_PRODUCT_INTAKE_TEST_DATABASE, 'kennel_pos_intake_concurrency_control_test')
  assert.match(env.POS_PRODUCT_INTAKE_TEST_DATA_DIRECTORY ?? '', /^[A-Za-z]:[\\/].*[/\\]kennel-pos-pg-[a-f0-9]{32}[/\\]data$/)
  return { host: env.POS_PRODUCT_INTAKE_TEST_HOST, port: Number(env.POS_PRODUCT_INTAKE_TEST_PORT), user: env.POS_PRODUCT_INTAKE_TEST_USER,
    database: env.POS_PRODUCT_INTAKE_TEST_DATABASE, dataDirectory: env.POS_PRODUCT_INTAKE_TEST_DATA_DIRECTORY,
    ssl: false, connectionTimeoutMillis: 5000, query_timeout: 15000,
    options: '-c statement_timeout=12000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=20000' }
}
const enqueueSql = 'SELECT public.enqueue_pos_product_edit_intake($1,$2,$3,$4,$5,$6) AS result'
const claimSql = 'SELECT public.claim_pos_product_edit_intake($1,$2) AS result'
const value = async (client, sql, args) => (await client.query(sql, args)).rows[0].result
async function begin(client) { await client.query('BEGIN'); await client.query('SET LOCAL ROLE service_role') }
async function rpc(client, sql, args) {
  await begin(client)
  try { const result = await value(client, sql, args); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error }
}
const captured = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }))
async function blocked(observer, waiter, holder) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    if ((await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [holder, waiter])).rows[0].blocked) return
    await delay(20)
  }
  assert.fail('PostgreSQL lock barrier was not observed')
}

test('通常PostgreSQLの独立接続で受付・通常編集・同期・claim再配送を直列化する', async t => {
  const config = configuration(process.env), clients = [], owner = new pg.Client(config)
  try {
    await owner.connect(); clients.push(owner)
    const identity = (await owner.query("SELECT current_database() AS database,current_user AS username,current_setting('data_directory') AS directory,current_setting('server_version_num')::int AS version")).rows[0]
    assert.equal(identity.database, config.database); assert.equal(identity.username, config.user)
    assert.equal(normalize(identity.directory), normalize(config.dataDirectory)); assert.ok(identity.version >= 170000)
    owner.exec = sql => owner.query(sql)
    await setupIntakeDatabase(owner)
    const a = new pg.Client(config), b = new pg.Client(config), observer = new pg.Client(config)
    for (const client of [a, b, observer]) { await client.connect(); clients.push(client) }
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    assert.notEqual(aPid, bPid)
    let sequence = 70000000, barriers = 0
    const product = async () => (await owner.query("INSERT INTO public.products(store_id,jan_code,product_name,category,product_group,supplier_name,cost_price,selling_price) VALUES(6,$1,'旧名','分類','分類','仕入先',50,100) RETURNING *", [String(++sequence)])).rows[0]
    const args = (p, id = randomUUID()) => [manager, 6, p.id, id, '{"name":"新名"}', '{"name":"旧名"}']
    const cancel = q => rpc(a, 'SELECT public.cancel_pos_product_edit_intake($1,$2,$3) AS result', [manager, 6, q.operation_id])

    await t.test('同商品への別ID受付は先行commit後にBUSYとなり、受付は一件だけ', async () => {
      const p = await product(); await begin(a)
      const first = await value(a, enqueueSql, args(p)), waiting = captured(rpc(b, enqueueSql, args(p)))
      await blocked(observer, bPid, aPid); barriers++
      await a.query('COMMIT')
      const result = await waiting; assert.equal(result.ok, false); assert.match(result.error.message, /INTAKE_BUSY/)
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.pos_product_edit_intakes WHERE product_id=$1', [p.id])).rows[0].n, 1)
      await cancel(first)
    })
    await t.test('通常prepareの先行処理は受付transactionを待ち、commit後に保存準備を拒否', async () => {
      const p = await product(); await begin(a)
      const intake = await value(a, enqueueSql, args(p))
      const command = JSON.stringify({ kind: 'update', operationId: randomUUID(), storeId: 6, productId: p.id,
        expectedFingerprint: 'a'.repeat(64), fields: { name: '別名', groupId: 'g1', price: '100', cost: '50', supplierId: 's1' } })
      const waiting = captured(rpc(b, 'SELECT public.prepare_pos_product_edit($1,$2,$3,$4,$5) AS result', [manager, command, 'pos-' + p.jan_code,
        'b'.repeat(64), JSON.stringify({ groupId: 'g1', groupName: '分類', supplierId: 's1', supplierName: '仕入先', previousPosName: '旧名' })]))
      await blocked(observer, bPid, aPid); barriers++
      await a.query('COMMIT')
      const result = await waiting; assert.equal(result.ok, false); assert.match(result.error.message, /INTAKE_BUSY/)
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.pos_product_operations WHERE product_id_snapshot=$1', [p.id])).rows[0].n, 0)
      await cancel(intake)
    })
    await t.test('署名同期開始は受付commitを待ち、PENDING_EDITで終端拒否する', async () => {
      const p = await product(); await begin(a)
      const intake = await value(a, enqueueSql, args(p))
      const waiting = captured(rpc(b, "SELECT public.begin_product_master_sync_request($1,$2,clock_timestamp()+interval '60 seconds') AS result", [6, randomUUID()]))
      await blocked(observer, bPid, aPid); barriers++
      await a.query('COMMIT')
      const result = await waiting; assert.equal(result.ok, true); assert.equal(result.value.accepted, false)
      assert.equal(result.value.code, 'PRODUCT_SYNC_PENDING_EDIT')
      await cancel(intake)
    })
    await t.test('並行した同worker要求は最初の一件だけをclaimし、次の商品を取得しない', async () => {
      const first = await rpc(a, enqueueSql, args(await product())), second = await rpc(a, enqueueSql, args(await product())), worker = randomUUID()
      await begin(a)
      const claimed = await value(a, claimSql, [6, worker]), waiting = captured(rpc(b, claimSql, [6, worker]))
      await blocked(observer, bPid, aPid); barriers++
      await a.query('COMMIT')
      const result = await waiting; assert.equal(claimed.claimed, true); assert.equal(result.ok, true); assert.equal(result.value.claimed, false)
      assert.equal((await owner.query('SELECT status FROM public.pos_product_edit_intakes WHERE operation_id=$1', [second.operation_id])).rows[0].status, 'queued')
      await cancel(first); await cancel(second)
      assert.equal((await rpc(a, claimSql, [6, worker])).claimed, false)
    })
    await t.test('未受付取消が先に確定したら、待機中の遅延POSTは恒久証跡で拒否する', async () => {
      const p = await product(), id = randomUUID(); await begin(a)
      const receipt = await value(a, 'SELECT public.abandon_pos_product_edit_intake($1,$2,$3,$4) AS result', [manager, 6, p.id, id])
      const waiting = captured(rpc(b, enqueueSql, args(p, id)))
      await blocked(observer, bPid, aPid); barriers++
      await a.query('COMMIT')
      const result = await waiting; assert.equal(receipt.abandoned, true); assert.equal(result.ok, false); assert.match(result.error.message, /INTAKE_CONFLICT/)
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.pos_product_edit_intakes WHERE operation_id=$1', [id])).rows[0].n, 0)
    })
    await t.test('受付が先に確定したら、未受付取消は既存受付を消さない', async () => {
      const p = await product(), id = randomUUID(); await begin(a)
      const intake = await value(a, enqueueSql, args(p, id))
      const waiting = captured(rpc(b, 'SELECT public.abandon_pos_product_edit_intake($1,$2,$3,$4) AS result', [manager, 6, p.id, id]))
      await blocked(observer, bPid, aPid); barriers++
      await a.query('COMMIT')
      const result = await waiting; assert.equal(result.ok, false); assert.match(result.error.message, /ABANDON_REJECTED/)
      assert.equal((await owner.query('SELECT status FROM public.pos_product_edit_intakes WHERE operation_id=$1', [id])).rows[0].status, 'queued')
      await cancel(intake)
    })
    t.diagnostic(`PostgreSQL ${identity.version}; distinct backends=${aPid},${bPid}; confirmed lock barriers=${barriers}`)
  } finally {
    for (const client of clients) { await client.query('ROLLBACK').catch(() => undefined); await client.end().catch(() => undefined) }
  }
})

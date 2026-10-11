import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { setupIntakeDatabase, manager, other, staff } from './intake-fixture.mjs'

const db = new PGlite()
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value)
const enqueueSql = 'SELECT public.enqueue_pos_product_edit_intake($1,$2,$3,$4,$5,$6) AS result'
const claimSql = 'SELECT public.claim_pos_product_edit_intake($1,$2) AS result'
const prepareSql = 'SELECT public.prepare_pos_product_edit_intake($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result'
const finishSql = 'SELECT public.finish_pos_product_edit_intake($1,$2,$3) AS result'

before(async () => setupIntakeDatabase(db))
after(async () => db.close())
async function role(name, fn) { await db.exec('SET ROLE ' + name); try { return await fn() } finally { await db.exec('RESET ROLE') } }
const rpc = (sql, args) => role('service_role', async () => (await db.query(sql, args)).rows[0].result)
const opArgs = op => [op.actor_id, op.store_id, op.id, op.payload_hash, op.row_version]
let sequence = 60000000
async function product(store = 6, jan = String(++sequence)) {
  return (await db.query(`INSERT INTO public.products(store_id,jan_code,product_name,category,product_group,supplier_name,cost_price,selling_price,brand)
    VALUES($1,$2,'旧名','分類','分類','仕入先',50,100,'保持') RETURNING *`, [store, jan])).rows[0]
}
async function enqueue(p, patch = { name: '新名', price: '101' }, id = randomUUID(), actor = manager) {
  const columns = { name: 'product_name', price: 'selling_price', cost: 'cost_price' }
  const expected = Object.fromEntries(Object.keys(patch).map(key => [key, p[columns[key]] == null ? null : String(p[columns[key]])]))
  return rpc(enqueueSql, [actor, p.store_id, p.id, id, JSON.stringify(patch), JSON.stringify(expected)])
}
const pending = () => db.query("SELECT * FROM public.pos_product_edit_intakes WHERE status IN ('queued','working','needs_review') ORDER BY created_at")
async function cancel(intake, actor = manager) {
  return rpc('SELECT public.cancel_pos_product_edit_intake($1,$2,$3) AS result', [actor, intake.store_id, intake.operation_id])
}
async function lease(intake) {
  const result = await rpc(claimSql, [intake.store_id, randomUUID()])
  assert.equal(result.claimed, true)
  assert.equal(result.intake.operation_id, intake.operation_id)
  return result.intake
}
function prepared(intake, changes = {}) {
  const now = Date.now(), jan = intake.jan_code, store = intake.store_id
  const before = { identity: { posProductId: 'pos-' + jan, officeId: store === 6 ? '11054' : '11053', groupId: store === 6 ? '11099' : '11098',
    salesKind: 'retail', productCode: '', manufacturerCode: jan, exclusiveStore: true },
  fields: { name: '旧名', groupId: 'g1', price: '100', cost: '50', supplierId: 's1' },
  settings: { nameKana: 'キュウ', abbreviation: '旧', taxId: '0', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'c'.repeat(64) },
  groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '別分類' }], suppliers: [{ id: 's1', name: '仕入先' }] }
  const fields = { ...before.fields, ...intake.patch, ...changes }
  const fingerprint = fields => JSON.stringify({ version: 'pos-product-edit.v1', storeId: store, productId: intake.product_id,
    janCode: jan, identity: before.identity, fields, settings: before.settings })
  const beforeText = fingerprint(before.fields), expectedText = fingerprint(fields)
  const command = { kind: 'update', operationId: intake.operation_id, storeId: store, productId: intake.product_id, expectedFingerprint: hash(beforeText), fields }
  const patch = {}
  for (const [key, mapped] of [['name', 'goodsName'], ['groupId', 'goodsGroup'], ['price', 'gddGoodsPrice'], ['cost', 'gddGoodsCost'], ['supplierId', 'gddSupplierCd']]) {
    if (fields[key] !== before.fields[key]) patch[mapped] = fields[key] ?? ''
  }
  const dispatchText = canonical({ operationId: intake.operation_id, actorId: intake.actor_id, storeId: store, janCode: jan, before, patch, expiresAt: now + 110000 })
  return { commandText: JSON.stringify(command), posId: before.identity.posProductId, expectedText, beforeText, dispatchText,
    catalogText: JSON.stringify({ groupId: fields.groupId, groupName: fields.groupId === 'g1' ? '分類' : '別分類', supplierId: fields.supplierId,
      supplierName: fields.supplierId === null ? null : '仕入先', previousPosName: '旧名' }), reviewedAt: now, dispatchHash: hash(dispatchText) }
}
const prepareArgs = (intake, p) => [intake.operation_id, intake.lease_token, p.commandText, p.posId, hash(p.expectedText), p.catalogText,
  p.dispatchText, p.beforeText, p.expectedText, p.reviewedAt, p.dispatchHash]
const prepare = (intake, p = prepared(intake)) => rpc(prepareSql, prepareArgs(intake, p))

test('受付だけでは商品・棚卸し・POS台帳を変更せず、同IDの同patchは固定基準を返す', async () => {
  const p = await product(), before = (await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows
  const rev = (await db.query('SELECT revision FROM public.product_master_store_versions WHERE store_id=6')).rows[0].revision
  const id = randomUUID(), intake = await enqueue(p, { name: '新名', price: '0', cost: '0' }, id)
  assert.equal(intake.status, 'queued'); assert.equal(intake.lease_token, null)
  assert.deepEqual(intake.baseline, { product_name: '旧名', category: '分類', product_group: '分類', selling_price: 100, cost_price: 50, supplier_name: '仕入先' })
  assert.deepEqual(await enqueue(p, { name: '新名', price: '0', cost: '0' }, id), intake)
  assert.deepEqual((await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows, before)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pos_product_operations WHERE id=$1', [id])).rows[0].n, 0)
  assert.equal(Number((await db.query('SELECT revision FROM public.product_master_store_versions WHERE store_id=6')).rows[0].revision), Number(rev) + 1)
  await assert.rejects(enqueue(p, { name: '変更' }, id), /CONFLICT/)
  await assert.rejects(enqueue(p, { name: '新名' }), /BUSY/)
  await cancel(intake)
})

test('店舗・管理者・JANとpatchをDBで検査し、不正入力を一切受付しない', async () => {
  const p = await product()
  for (const patch of [{}, { supplierId: null }, { groupId: '' }, { price: '-1' }, { price: '1.5' }, { price: '0001' }, { cost: 1 }, { name: '' }, { name: ' x\n' }, { name: 'a'.repeat(201) }]) {
    await assert.rejects(enqueue(p, patch), /INVALID/)
  }
  await assert.rejects(enqueue(p, { name: '新名' }, randomUUID(), staff), /manager access denied/)
  await assert.rejects(rpc(enqueueSql, [manager, 7, p.id, randomUUID(), '{"name":"新名"}', '{"name":"旧名"}']), /UNAVAILABLE/)
  await assert.rejects(rpc(enqueueSql, [manager, 6, p.id, randomUUID(), '{"name":"a","name":"b"}', '{"name":"旧名"}']), /INVALID/)
  const invalid = await product(6, 'internal-code')
  await assert.rejects(enqueue(invalid), /UNAVAILABLE/)
  assert.equal((await pending()).rows.length, 0)
})

test('同JANの他店商品は別受付で、manager一覧は指定店舗・指定商品だけを返す', async () => {
  const jan = String(++sequence), p6 = await product(6, jan), p7 = await product(7, jan)
  const a = await enqueue(p6), b = await enqueue(p7)
  const list = await rpc('SELECT public.get_pos_product_edit_intakes($1,$2,$3) AS result', [manager, 6, [p6.id]])
  assert.equal(list.length, 1); assert.equal(list[0].operation_id, a.operation_id)
  assert.deepEqual(await rpc('SELECT public.get_pos_product_edit_intakes($1,$2,$3) AS result', [manager, 6, [p7.id]]), [])
  await assert.rejects(rpc('SELECT public.get_pos_product_edit_intakes($1,$2,$3) AS result', [staff, 6, [p6.id]]), /manager access denied/)
  assert.equal(await rpc('SELECT public.get_pos_product_edit_intake($1,$2,$3) AS result', [other, 6, a.operation_id]), null)
  assert.deepEqual(await rpc('SELECT public.get_pos_product_edit_intake($1,$2,$3) AS result', [manager, 6, a.operation_id]), a)
  await role('authenticated', async () => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [staff])
    assert.equal((await db.query('SELECT * FROM public.pos_product_edit_intakes')).rows.length, 0)
    await assert.rejects(db.query('UPDATE public.pos_product_edit_intakes SET status=\'cancelled\''), /permission denied/)
    await assert.rejects(db.query(enqueueSql, [manager, 6, p6.id, randomUUID(), '{"name":"x"}', '{"name":"旧名"}']), /permission denied/)
  })
  await cancel(a); await cancel(b)
})

test('受付前後の通常prepareとmaster同期をフェンスし、古いCSVを受付後に適用しない', async () => {
  const p = await product(), run = (await db.query('SELECT public.begin_product_master_sync($1) AS result', [6])).rows[0].result, intake = await enqueue(p)
  const x = prepared(intake)
  await assert.rejects(rpc('SELECT public.prepare_pos_product_edit($1,$2,$3,$4,$5) AS result', [manager, x.commandText, x.posId, hash(x.expectedText), x.catalogText]), /INTAKE_BUSY/)
  await assert.rejects(db.query('SELECT public.begin_product_master_sync($1) AS result', [6]), /pending product operation/)
  const result = await rpc('SELECT public.begin_product_master_sync_request($1,$2,clock_timestamp()+interval \'60 seconds\') AS result', [6, randomUUID()])
  assert.equal(result.accepted, false)
  assert.ok(['PRODUCT_SYNC_PENDING_EDIT', 'PRODUCT_SYNC_PENDING_SYNC'].includes(result.code))
  await cancel(intake)
  await assert.rejects(db.query('SELECT public.apply_product_master_sync($1,$2,$3) AS result', [run.id, 6, JSON.stringify([{ store_id: 6, jan_code: p.jan_code,
    product_name: '古いCSV', category: '分類', product_group: '分類', cost_price: 50, selling_price: 100, markup_rate: 0.5, is_active: true, tags: 'わんわん' }])]), /stale sync/)
  const unqueued = prepared({ ...intake, operation_id: randomUUID() })
  const op = await rpc('SELECT public.prepare_pos_product_edit($1,$2,$3,$4,$5) AS result', [manager, unqueued.commandText, unqueued.posId, hash(unqueued.expectedText), unqueued.catalogText])
  await assert.rejects(enqueue(p), /BUSY/)
  await rpc('SELECT public.cancel_pos_product_edit($1,$2,$3,$4) AS result', [manager, 6, p.id, op.id])
})

test('lease再取得は旧tokenを失効させ、bridgeはpatch・対象・基準・未変更項目を検査する', async () => {
  const p = await product(), initial = await enqueue(p), first = await lease(initial)
  const empty = await rpc(claimSql, [6, randomUUID()]); assert.equal(empty.claimed, false)
  await db.query("UPDATE public.pos_product_edit_intakes SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [initial.operation_id])
  const current = await lease(initial); assert.notEqual(current.lease_token, first.lease_token)
  await assert.rejects(prepare(first), /LEASE/)
  await assert.rejects(prepare(current, prepared(current, { groupId: 'g2' })), /CONFLICT/)
  await assert.rejects(prepare(current, prepared(current, { supplierId: null })), /CONFLICT/)
  await assert.rejects(prepare(current, prepared(current, { cost: '999' })), /CONFLICT/)
  const changedId = prepared(current); const command = JSON.parse(changedId.commandText); command.storeId = 7; changedId.commandText = JSON.stringify(command)
  await assert.rejects(prepare(current, changedId), /CONFLICT/)
  await db.query("UPDATE public.products SET selling_price=102 WHERE id=$1", [p.id])
  await assert.rejects(prepare(current), /CONFLICT/)
  await db.query("UPDATE public.products SET selling_price=100 WHERE id=$1", [p.id])
  await cancel(current)
})

test('bridgeの原子的claim後はlease失効でも送信権を再発行せず、結果不明の取消は拒否する', async () => {
  const p = await product(), intake = await lease(await enqueue(p)), x = prepared(intake), saved = await prepare(intake, x)
  assert.equal(saved.claimed, true); assert.equal(saved.operation.status, 'dispatching'); assert.equal(saved.operation.send_attempts, 1)
  const replay = await prepare(intake, x); assert.equal(replay.claimed, false)
  await db.query("UPDATE public.pos_product_edit_intakes SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [intake.operation_id])
  const currentClaim = await rpc(claimSql, [6, randomUUID()]); assert.equal(currentClaim.operation.send_attempts, 1)
  const current = currentClaim.intake
  assert.equal((await prepare(current, x)).claimed, false)
  await assert.rejects(cancel(current), /CANCEL_REJECTED/)
  const recovery = await rpc('SELECT public.get_pos_product_edit_intake_lease($1,$2,$3) AS result', [current.operation_id, 6, current.lease_token])
  assert.equal(recovery.operation.send_attempts, 1); assert.equal(recovery.receipt, null)
  const stopped = await rpc(finishSql, [current.operation_id, current.lease_token, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN'])
  assert.equal(stopped.status, 'needs_review')
  await assert.rejects(enqueue(p), /BUSY/)
  const op = await rpc('SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(saved.operation), 'outcome_unknown', null])
  assert.equal(op.send_attempts, 1)
})

test('権限剥奪後のworker準備を拒否し、未送信の要確認入力は監査付き取消できる', async () => {
  const p = await product(7), intake = await lease(await enqueue(p))
  await db.query('DELETE FROM public.user_store_access WHERE user_id=$1 AND store_id=7', [manager])
  await assert.rejects(prepare(intake), /manager access denied/)
  const failure = await rpc(finishSql, [intake.operation_id, intake.lease_token, 'POS_PRODUCT_EDIT_ACCESS_REVOKED'])
  assert.equal(failure.status, 'needs_review')
  await db.query('INSERT INTO public.user_store_access(user_id,store_id,role) VALUES($1,7,\'manager\')', [manager])
  const cancelled = await cancel(failure); assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(cancelled.patch, intake.patch)
  assert.ok((await db.query('SELECT * FROM public.pos_product_edit_intake_events WHERE operation_id=$1', [intake.operation_id])).rows.length >= 4)
  await assert.rejects(db.query('DELETE FROM public.pos_product_edit_intakes WHERE operation_id=$1', [intake.operation_id]), /append only/)
})

test('POS検証済みの既存applyだけで完了し、分類・仕入先・ブランド・棚卸し計数を保持する', async () => {
  // 先行試験の商品名を分け、別名の一意性保護を正しく満たすfixtureにする。
  await db.exec("UPDATE public.products SET product_name='先行_'||id::text WHERE store_id=7")
  const p = await product(7), intake = await lease(await enqueue(p)), x = prepared(intake)
  let op = (await prepare(intake, x)).operation
  const consumed = await rpc('SELECT public.consume_pos_product_edit_dispatch($1,$2,$3,$4) AS result', [manager, 7, op.id, x.dispatchHash]); assert.equal(consumed.accepted, true)
  assert.equal((await rpc('SELECT public.consume_pos_product_edit_dispatch($1,$2,$3,$4) AS result', [manager, 7, op.id, x.dispatchHash])).accepted, false)
  op = await rpc('SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(op), 'dispatch_returned', null])
  op = await rpc('SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result', [...opArgs(op), 'pos_verified', hash(x.expectedText)])
  const session = (await db.query('INSERT INTO public.inventory_sessions(store_id,started_by,updated_by) VALUES(7,$1,$1) RETURNING id', [manager])).rows[0].id
  await db.query(`INSERT INTO public.inventory_session_items(session_id,store_id,product_id,jan_snapshot,product_name_snapshot,
    counted_quantity,counted_at,counted_by,created_by,updated_by) VALUES($1,7,$2,$3,'旧名',8,'2026-10-12T01:00:00Z',$4,$4,$4)`, [session, p.id, p.jan_code, manager])
  const inventoryBefore = (await db.query('SELECT * FROM public.inventory_session_items ORDER BY id')).rows
  op = await rpc('SELECT public.apply_pos_product_edit($1,$2,$3,$4,$5) AS result', opArgs(op))
  const finished = await rpc(finishSql, [intake.operation_id, intake.lease_token, null]); assert.equal(finished.status, 'completed')
  const updated = (await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows[0]
  assert.equal(updated.product_name, '新名'); assert.equal(updated.selling_price, 101)
  for (const key of ['category', 'product_group', 'supplier_name', 'cost_price', 'brand', 'is_active']) assert.equal(updated[key], p[key])
  assert.deepEqual((await db.query('SELECT * FROM public.inventory_session_items ORDER BY id')).rows, inventoryBefore)
  assert.deepEqual(await rpc(finishSql, [intake.operation_id, intake.lease_token, null]), finished)
  const terminal = await rpc('SELECT public.get_pos_product_edit_intake_lease($1,$2,$3) AS result', [intake.operation_id, 7, intake.lease_token])
  assert.equal(terminal.intake.status, 'completed'); assert.equal(terminal.operation.send_attempts, 1)
  const listed = await rpc('SELECT public.get_pos_product_edit_intakes($1,$2,$3) AS result', [manager, 7, [p.id]])
  assert.equal(listed.length, 1); assert.equal(listed[0].status, 'completed')
})

test('同worker要求の再配送はlive・終端・lease交代・空結果後でも次の商品をclaimしない', async () => {
  const first = await enqueue(await product(7)), second = await enqueue(await product(7)), worker = randomUUID()
  const claim = await rpc(claimSql, [7, worker]); assert.equal(claim.intake.operation_id, first.operation_id)
  assert.equal((await rpc(claimSql, [7, worker])).claimed, false)
  await cancel(claim.intake)
  assert.equal((await rpc(claimSql, [7, worker])).claimed, false)
  const nextWorker = randomUUID(), next = await rpc(claimSql, [7, nextWorker]); assert.equal(next.intake.operation_id, second.operation_id)
  await db.query("UPDATE public.pos_product_edit_intakes SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [second.operation_id])
  const reassigned = await rpc(claimSql, [7, randomUUID()]); assert.equal(reassigned.claimed, true)
  const third = await enqueue(await product(7))
  assert.equal((await rpc(claimSql, [7, nextWorker])).claimed, false)
  await cancel(reassigned.intake); await cancel(third)
  const emptyWorker = randomUUID(); assert.equal((await rpc(claimSql, [7, emptyWorker])).claimed, false)
  const later = await enqueue(await product(7))
  assert.equal((await rpc(claimSql, [7, emptyWorker])).claimed, false)
  await cancel(later)
})

test('商品別一覧は取消後も最新一件を返し、次の受付と旧終端を重複表示しない', async () => {
  const p = await product(7), old = await enqueue(p), cancelled = await cancel(old)
  const list = () => rpc('SELECT public.get_pos_product_edit_intakes($1,$2,$3) AS result', [manager, 7, [p.id]])
  assert.deepEqual(await list(), [cancelled])
  const next = await enqueue(p, { price: '102' })
  assert.deepEqual(await list(), [next])
  const finished = await cancel(next); assert.deepEqual(await list(), [finished])
})

test('古い画面基準で受付し直さず、期待値の項目一致・nullable・金額の数値比較を検査する', async () => {
  const p = await product(7)
  await db.query('UPDATE public.products SET selling_price=126 WHERE id=$1', [p.id])
  await assert.rejects(enqueue(p, { price: '130' }), /CONFLICT/)
  for (const expected of [{}, { price: '126', name: '旧名' }, { price: 126 }, { price: null }, { price: 'NaN' }]) {
    await assert.rejects(rpc(enqueueSql, [manager, 7, p.id, randomUUID(), '{"price":"130"}', JSON.stringify(expected)]), /INVALID|CONFLICT/)
  }
  const id = randomUUID(), row = await rpc(enqueueSql, [manager, 7, p.id, id, '{"price":"130"}', '{"price":"126.00"}'])
  await db.query('UPDATE public.products SET selling_price=127 WHERE id=$1', [p.id])
  assert.deepEqual(await rpc(enqueueSql, [manager, 7, p.id, id, '{"price":"130"}', '{"price":"126"}']), row)
  await assert.rejects(rpc(enqueueSql, [manager, 7, p.id, id, '{"price":"130"}', '{"price":"127"}']), /CONFLICT/)
  await cancel(row)
})

test('送信前失敗だけを同IDで再queueでき、結果不明は台帳send1を保ったまま検証だけ再開する', async () => {
  const p = await product(7), intake = await lease(await enqueue(p))
  const failure = await rpc(finishSql, [intake.operation_id, intake.lease_token, 'POS_PRODUCT_EDIT_INSPECTION_FAILED'])
  const requeueSql = 'SELECT public.requeue_pos_product_edit_intake($1,$2,$3) AS result'
  await assert.rejects(rpc(requeueSql, [other, 7, failure.operation_id]), /manager access denied/)
  const retry = await rpc(requeueSql, [manager, 7, failure.operation_id])
  assert.equal(retry.status, 'queued'); assert.equal(retry.lease_token, null); assert.deepEqual(retry.patch, intake.patch)
  await assert.rejects(prepare(intake), /LEASE/)
  const current = await lease(retry), x = prepared(current), saved = await prepare(current, x)
  const unknown = await rpc(finishSql, [current.operation_id, current.lease_token, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN'])
  assert.equal(unknown.status, 'needs_review')
  assert.deepEqual(await rpc(finishSql, [current.operation_id, current.lease_token, null]), unknown)
  const recover = await rpc(requeueSql, [manager, 7, current.operation_id]), claimed = await rpc(claimSql, [7, randomUUID()])
  assert.equal(claimed.operation.send_attempts, 1); assert.equal(claimed.intake.operation_id, recover.operation_id)
  assert.equal((await prepare(claimed.intake, x)).claimed, false)
  await rpc(finishSql, [claimed.intake.operation_id, claimed.intake.lease_token, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN'])
  const conflict = await lease(await enqueue(await product(7)))
  await rpc(finishSql, [conflict.operation_id, conflict.lease_token, 'POS_PRODUCT_EDIT_CONFLICT'])
  await assert.rejects(rpc(requeueSql, [manager, 7, conflict.operation_id]), /REQUEUE_REJECTED/)
  await cancel(conflict)
  assert.equal(saved.operation.send_attempts, 1)
})

test('未受付入力の取消は恒久証跡を残し遅延POSTを拒否し、受付済みや他店舗は解除しない', async () => {
  const p = await product(6), id = randomUUID(), sql = 'SELECT public.abandon_pos_product_edit_intake($1,$2,$3,$4) AS result'
  const receipt = await rpc(sql, [manager, 6, p.id, id])
  assert.deepEqual(receipt, { operationId: id, storeId: 6, productId: p.id, abandoned: true })
  assert.deepEqual(await rpc(sql, [manager, 6, p.id, id]), receipt)
  await assert.rejects(enqueue(p, { price: '101' }, id), /CONFLICT/)
  await assert.rejects(rpc(sql, [other, 6, p.id, id]), /CANCELLATION_REJECTED/)
  await assert.rejects(rpc(sql, [manager, 7, p.id, randomUUID()]), /CANCELLATION_REJECTED/)
  await assert.rejects(rpc(sql, [staff, 6, p.id, randomUUID()]), /manager access denied/)
  const accepted = await enqueue(p)
  await assert.rejects(rpc(sql, [manager, 6, p.id, accepted.operation_id]), /ABANDON_REJECTED/)
  assert.equal((await rpc('SELECT public.get_pos_product_edit_intake($1,$2,$3) AS result', [manager, 6, accepted.operation_id])).status, 'queued')
  await cancel(accepted)
})

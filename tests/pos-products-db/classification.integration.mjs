import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { setupClassificationDatabase, product, snapshot, record, readSnapshot, enqueue, cancel, lease, prepared, prepare,
  rpc, asRole, manager, other, staff, confirm, classificationMigration } from './classification-fixture.mjs'
import { setupIntakeDatabase } from './intake-fixture.mjs'

const db = new PGlite()
before(async () => setupClassificationDatabase(db))
after(async () => db.close())

test('POS候補と現在選択を店舗・商品・JANへ固定し、確定商品を変更しない', async () => {
  const p = await product(db), before = (await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows[0]
  const saved = await record(db, p)
  assert.equal(saved.storeId, 6); assert.equal(saved.productId, p.id); assert.equal(saved.janCode, p.jan_code)
  assert.equal(saved.currentSupplierId, 's1'); assert.equal(p.supplier_name, null)
  assert.deepEqual(await readSnapshot(db, p), saved)
  assert.deepEqual((await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows[0], before)
  await assert.rejects(db.query('UPDATE public.pos_product_classification_snapshots SET current_group_id=$1 WHERE snapshot_id=$2', ['g2', saved.snapshotId]), /append only/)
  await assert.rejects(db.query('DELETE FROM public.pos_product_classification_snapshots WHERE snapshot_id=$1', [saved.snapshotId]), /append only/)
  await assert.rejects(db.exec('TRUNCATE public.pos_product_classification_snapshots CASCADE'), /append only/)
})

test('キャッシュは未知属性・資格情報・候補欠落・ID/同名重複・空分類を拒否する', async () => {
  const p = await product(db)
  const invalid = [
    { csrf: 'opaque' }, { cookie: 'opaque' }, { currentGroupId: '' }, { currentGroupId: 'missing' }, { currentSupplierId: 'missing' },
    { groups: [] }, { groups: [{ id: 'g1', name: '分類' }, { id: 'g1', name: '別分類' }] },
    { groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '分類' }] },
    { suppliers: [{ id: 's1', name: '仕入先' }, { id: 's2', name: '仕入先' }] },
    { groups: [{ id: 'g1', name: ' x ' }] }, { groups: [{ id: 'g1', name: 'x\n' }] },
    { suppliers: [{ id: 's1', name: '仕入先', token: 'opaque' }] }, { capturedAt: Date.now() + 60000 },
    { expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 1800000 }, { currentSupplierId: '' },
  ]
  for (const change of invalid) await assert.rejects(record(db, p, snapshot(p, change)), /CLASSIFICATION_INVALID/)
  const saved = await record(db, p, snapshot(p, { currentSupplierId: null }))
  assert.equal(saved.currentSupplierId, null)
})

test('snapshotID再配送は同じ内容だけ許可し、異なる内容やactorを拒否する', async () => {
  const p = await product(db), value = snapshot(p), id = randomUUID()
  const saved = await record(db, p, value, id)
  assert.deepEqual(await record(db, p, value, id), saved)
  await assert.rejects(record(db, p, { ...value, currentSupplierId: null }, id), /CONFLICT/)
  await assert.rejects(record(db, p, value, id, other), /CONFLICT/)
})

test('RLSとRPCは店舗managerだけを許可し、ブラウザ・service直接書込みを拒否する', async () => {
  assert.deepEqual((await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.pos_product_classification_snapshots'::regclass")).rows[0],
    { relrowsecurity: true, relforcerowsecurity: true })
  const p6 = await product(db), p7 = await product(db, 7), s6 = await record(db, p6), s7 = await record(db, p7)
  await assert.rejects(record(db, p6, snapshot(p6), randomUUID(), staff), /manager access denied/)
  await assert.rejects(readSnapshot(db, p7, other), /manager access denied/)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other])
  const visible = await asRole(db, 'authenticated', () => db.query('SELECT snapshot_id FROM public.pos_product_classification_snapshots'))
  assert(visible.rows.some(row => row.snapshot_id === s6.snapshotId)); assert(!visible.rows.some(row => row.snapshot_id === s7.snapshotId))
  await assert.rejects(asRole(db, 'authenticated', () => db.query('SELECT public.record_pos_product_classification_snapshot($1,$2,$3,$4,$5)', [manager, 6, p6.id, randomUUID(), JSON.stringify(snapshot(p6))])), /permission denied/)
  await assert.rejects(asRole(db, 'service_role', () => db.query('INSERT INTO public.pos_product_classification_snapshots(snapshot_id) VALUES($1)', [randomUUID()])), /permission denied/)
})

test('同JANの店舗snapshotは独立し、別店/別商品/JAN変更/期限切れは受付に使わない', async () => {
  const jan = '65009999', p6 = await product(db, 6, jan), p7 = await product(db, 7, jan), s6 = await record(db, p6), s7 = await record(db, p7)
  await assert.rejects(enqueue(db, p7, s6), /CLASSIFICATION_CONFLICT/)
  const a = await enqueue(db, p6, s6), b = await enqueue(db, p7, s7)
  await cancel(db, a); await cancel(db, b)
  const changed = await product(db), saved = await record(db, changed)
  await db.query('UPDATE public.products SET jan_code=$1 WHERE id=$2', ['65009998', changed.id])
  await assert.rejects(enqueue(db, changed, saved), /CLASSIFICATION_CONFLICT/)
  assert.equal(await readSnapshot(db, { ...changed, jan_code: '65009998' }), null)
  const expired = await product(db), old = await record(db, expired, snapshot(expired, { capturedAt: Date.now() - 1000, expiresAt: Date.now() + 300 }))
  await new Promise(resolve => setTimeout(resolve, 350))
  await assert.rejects(enqueue(db, expired, old), /CLASSIFICATION_CONFLICT/)
})

test('分類受付はDBがPOS選択baselineを生成し、仕入先DB nullを未設定と推測しない', async () => {
  const p = await product(db), saved = await record(db, p), id = randomUUID()
  const a = await enqueue(db, p, saved, { groupId: 'g2', supplierId: 's2', price: '120' }, id)
  assert.equal(a.baseline.supplier_name, null)
  assert.deepEqual(a.pos_choice_baseline, { groupId: 'g1', groupName: '分類', supplierId: 's1', supplierName: '仕入先',
    requested: { groupId: { id: 'g2', name: '別分類' }, supplierId: { id: 's2', name: '別仕入先' } } })
  assert.equal(a.catalog_snapshot_id, saved.snapshotId)
  assert.deepEqual(await enqueue(db, p, saved, a.patch, id), a)
  await assert.rejects(enqueue(db, p, saved, { groupId: 'g1' }, id), /CONFLICT/)
  await assert.rejects(enqueue(db, p, saved, a.patch, id, manager, { groupId: 'g1', supplierId: null, price: '100' }), /CONFLICT/)
  await assert.rejects(db.query('UPDATE public.pos_product_edit_intakes SET pos_choice_baseline=$1 WHERE operation_id=$2', ['{}', id]), /IMMUTABLE/)
  await cancel(db, a)
})

test('分類patchの未知ID・空分類・非明示解除・古い画面基準と任意snapshotを拒否する', async () => {
  const p = await product(db), saved = await record(db, p)
  for (const patch of [{ groupId: '' }, { groupId: 'missing' }, { supplierId: '' }, { supplierId: 'missing' }, { supplierId: 1 }, { token: 'opaque' }, { price: '110' }]) {
    await assert.rejects(enqueue(db, p, saved, patch), /INVALID|CONFLICT/)
  }
  await assert.rejects(enqueue(db, p, { ...saved, snapshotId: randomUUID() }), /CONFLICT/)
  await assert.rejects(enqueue(db, p, saved, { groupId: 'g2' }, randomUUID(), manager, { groupId: 'g2' }), /CONFLICT/)
  const a = await enqueue(db, p, saved, { supplierId: null })
  assert.equal(a.patch.supplierId, null)
  await cancel(db, a)
})

test('fresh分類照合は現在IDと希望ID/名称の変更・重複・候補不存在でclaim前に停止する', async () => {
  const p = await product(db), saved = await record(db, p), a = await lease(db, await enqueue(db, p, saved))
  const original = prepared(a, saved)
  const fieldChanges = { ...JSON.parse(original.beforeText).fields, supplierId: null }
  const invalid = [
    { fields: fieldChanges }, { groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '改名' }] },
    { groups: [{ id: 'g1', name: '分類' }, { id: 'g3', name: '別分類' }] },
    { groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '別分類' }, { id: 'g3', name: '別分類' }] },
    { suppliers: [{ id: 's1', name: '旧仕入先の改名' }, { id: 's2', name: '別仕入先' }] },
  ]
  for (const change of invalid) await assert.rejects(prepare(db, a, prepared(a, saved, change)), /CLASSIFICATION_CONFLICT/)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pos_product_operations WHERE id=$1', [a.operation_id])).rows[0].n, 0)
  await rpc(db, 'SELECT public.finish_pos_product_edit_intake($1,$2,$3) AS result', [a.operation_id, a.lease_token, 'POS_PRODUCT_EDIT_CONFLICT'])
  await cancel(db, a)
})

test('fresh分類成功は既存署名dispatchとconsumeを使い、二度目の保存権を発行しない', async () => {
  const p = await product(db), saved = await record(db, p), a = await lease(db, await enqueue(db, p, saved)), request = prepared(a, saved)
  const result = await prepare(db, a, request)
  assert.equal(result.claimed, true); assert.equal(result.operation.send_attempts, 1)
  const repeated = await prepare(db, a, request)
  assert.equal(repeated.claimed, false); assert.equal(repeated.operation.send_attempts, 1)
  const args = [manager, p.store_id, a.operation_id, request.dispatchHash]
  const consume = () => rpc(db, 'SELECT public.consume_pos_product_edit_dispatch($1,$2,$3,$4) AS result', args)
  assert.equal((await consume()).accepted, true); assert.equal((await consume()).accepted, false)
  await assert.rejects(cancel(db, a), /CANCEL_REJECTED/)
})

test('仕入先明示解除のdispatchは空文字、confirmed DB反映はnullで非対象値を保持する', async () => {
  const p = await product(db), saved = await record(db, p), a = await lease(db, await enqueue(db, p, saved, { supplierId: null })), request = prepared(a, saved)
  assert.equal(JSON.parse(request.dispatchText).patch.gddSupplierCd, '')
  const op = await confirm(db, a, request)
  assert.equal(op.status, 'completed')
  const after = (await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows[0]
  assert.equal(after.supplier_name, null); assert.equal(after.product_group, '分類'); assert.equal(after.selling_price, 100); assert.equal(after.brand, '保持')
})

test('分類・仕入先の確定反映はPOS名称をDBへ写し、価格・ブランドを保持する', async () => {
  const p = await product(db), saved = await record(db, p), a = await lease(db, await enqueue(db, p, saved)), request = prepared(a, saved)
  const op = await confirm(db, a, request)
  assert.equal(op.status, 'completed')
  const after = (await db.query('SELECT * FROM public.products WHERE id=$1', [p.id])).rows[0]
  assert.equal(after.category, '別分類'); assert.equal(after.product_group, '別分類'); assert.equal(after.supplier_name, '別仕入先')
  assert.equal(after.selling_price, 100); assert.equal(after.cost_price, 50); assert.equal(after.brand, '保持')
})

test('受付後にsnapshot期限が切れても同ID再配送とfresh証拠照合を維持する', async () => {
  const p = await product(db), saved = await record(db, p, snapshot(p, { capturedAt: Date.now() - 1000, expiresAt: Date.now() + 300 }))
  const id = randomUUID(), a = await enqueue(db, p, saved, { groupId: 'g2' }, id)
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(await readSnapshot(db, p), null)
  assert.deepEqual(await enqueue(db, p, saved, a.patch, id), a)
  const working = await lease(db, a)
  assert.equal((await confirm(db, working, prepared(working, saved))).status, 'completed')
})

test('prepareはactor権限剥奪とDB全baseline変更も引き続き拒否する', async () => {
  const p = await product(db), saved = await record(db, p), a = await lease(db, await enqueue(db, p, saved)), request = prepared(a, saved)
  await db.query('UPDATE public.products SET cost_price=51 WHERE id=$1', [p.id])
  await assert.rejects(prepare(db, a, request), /INTAKE_CONFLICT/)
  await db.query('UPDATE public.products SET cost_price=50 WHERE id=$1', [p.id])
  await db.query("UPDATE public.user_store_access SET role='staff' WHERE user_id=$1 AND store_id=6", [manager])
  await assert.rejects(prepare(db, a, request), /manager access denied/)
  await db.query("UPDATE public.user_store_access SET role='manager' WHERE user_id=$1 AND store_id=6", [manager])
  await rpc(db, 'SELECT public.finish_pos_product_edit_intake($1,$2,$3) AS result', [a.operation_id, a.lease_token, 'POS_PRODUCT_EDIT_CONFLICT'])
  await cancel(db, a)
})

test('旧6引数RPCは維持し、通常3項目受付に分類を混入させない', async () => {
  const p = await product(db)
  const sql = 'SELECT public.enqueue_pos_product_edit_intake($1,$2,$3,$4,$5,$6) AS result'
  await assert.rejects(rpc(db, sql, [manager, 6, p.id, randomUUID(), '{"groupId":"g2"}', '{"groupId":"g1"}']), /INTAKE_INVALID/)
  const a = await rpc(db, sql, [manager, 6, p.id, randomUUID(), '{"price":"101"}', '{"price":"100"}'])
  assert.equal(a.catalog_snapshot_id, null); assert.equal(a.pos_choice_baseline, null)
  const saved = snapshot(p), working = await lease(db, a)
  assert.equal((await prepare(db, working, prepared(working, saved))).claimed, true)
})

test('既存prepare/immutable guard全文hashが異なるDBではmigrationをtransaction全体で拒否する', async () => {
  for (const identity of ['public.prepare_pos_product_edit_intake(uuid,uuid,text,text,text,text,text,text,text,bigint,text)', 'private.guard_pos_product_edit_intake()']) {
    const isolated = new PGlite()
    try {
      await setupIntakeDatabase(isolated)
      const body = (await isolated.query('SELECT pg_get_functiondef($1::regprocedure) AS body', [identity])).rows[0].body
      await isolated.exec(body.replace(/\bBEGIN\r?\n/, 'BEGIN\n-- changed known source\n'))
      await assert.rejects(isolated.exec(await classificationMigration()), /CLASSIFICATION_SOURCE_MISMATCH/)
      await isolated.exec('ROLLBACK')
      assert.equal((await isolated.query("SELECT to_regclass('public.pos_product_classification_snapshots') AS found")).rows[0].found, null)
    } finally { await isolated.close() }
  }
})

import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { setupIntakeDatabase, manager, other, staff } from './intake-fixture.mjs'

export { manager, other, staff }
export const classificationMigration = () => readFile(new URL('../../supabase/migrations/20261013120000_pos_product_classification_snapshot.sql', import.meta.url), 'utf8')
export const hash = value => createHash('sha256').update(value, 'utf8').digest('hex')
export const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value)

// 既存fixtureは変更せず、合成DBのみに新migrationを重ねる。
export async function setupClassificationDatabase(db) {
  await setupIntakeDatabase(db)
  await db.exec(await classificationMigration())
}
export async function asRole(db, name, action) {
  await db.exec('SET ROLE ' + name)
  try { return await action() } finally { await db.exec('RESET ROLE') }
}
export const rpc = (db, sql, args) => asRole(db, 'service_role', async () => (await db.query(sql, args)).rows[0].result)
let sequence = 65000000
export async function product(db, store = 6, jan = String(++sequence)) {
  return (await db.query(`INSERT INTO public.products(store_id,jan_code,product_name,category,product_group,supplier_name,cost_price,selling_price,brand)
    VALUES($1,$2,'旧名','分類','分類',NULL,50,100,'保持') RETURNING *`, [store, jan])).rows[0]
}
export function snapshot(p, changes = {}) {
  const now = Date.now()
  return { storeId: p.store_id, productId: p.id, janCode: p.jan_code, capturedAt: now, expiresAt: now + 900000,
    currentGroupId: 'g1', currentSupplierId: 's1', groups: [{ id: 'g1', name: '分類' }, { id: 'g2', name: '別分類' }],
    suppliers: [{ id: 's1', name: '仕入先' }, { id: 's2', name: '別仕入先' }], ...changes }
}
export const record = (db, p, value = snapshot(p), id = randomUUID(), actor = manager) => rpc(db,
  'SELECT public.record_pos_product_classification_snapshot($1,$2,$3,$4,$5) AS result', [actor, p.store_id, p.id, id, JSON.stringify(value)])
export const readSnapshot = (db, p, actor = manager) => rpc(db,
  'SELECT public.get_pos_product_classification_snapshot($1,$2,$3) AS result', [actor, p.store_id, p.id])
export function enqueue(db, p, saved, patch = { groupId: 'g2', supplierId: 's2' }, id = randomUUID(), actor = manager, expected) {
  const baseline = { name: p.product_name, price: String(p.selling_price), cost: String(p.cost_price),
    groupId: saved.currentGroupId, supplierId: saved.currentSupplierId }
  return rpc(db, 'SELECT public.enqueue_pos_product_edit_intake_v2($1,$2,$3,$4,$5,$6,$7) AS result',
    [actor, p.store_id, p.id, id, JSON.stringify(patch), JSON.stringify(expected ?? Object.fromEntries(Object.keys(patch).map(key => [key, baseline[key]]))), saved.snapshotId])
}
export const cancel = (db, intake) => rpc(db, 'SELECT public.cancel_pos_product_edit_intake($1,$2,$3) AS result',
  [intake.actor_id, intake.store_id, intake.operation_id])
export async function lease(db, intake) {
  const claimed = await rpc(db, 'SELECT public.claim_pos_product_edit_intake($1,$2) AS result', [intake.store_id, randomUUID()])
  if (!claimed.claimed || claimed.intake.operation_id !== intake.operation_id) throw new Error('unexpected local claim')
  return claimed.intake
}
export function prepared(intake, saved, changes = {}) {
  const now = Date.now(), store = intake.store_id, jan = intake.jan_code
  const before = { identity: { posProductId: 'pos-' + jan, officeId: store === 6 ? '11054' : '11053', groupId: store === 6 ? '11099' : '11098',
    salesKind: 'retail', productCode: '', manufacturerCode: jan, exclusiveStore: true },
  fields: { name: '旧名', groupId: saved.currentGroupId, price: '100', cost: '50', supplierId: saved.currentSupplierId },
  settings: { nameKana: 'キュウ', abbreviation: '旧', taxId: '0', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'c'.repeat(64) },
  groups: structuredClone(saved.groups), suppliers: structuredClone(saved.suppliers) }
  Object.assign(before, changes)
  const fields = { ...before.fields, ...intake.patch }
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
    catalogText: JSON.stringify({ groupId: fields.groupId, groupName: before.groups.find(g => g.id === fields.groupId)?.name ?? '未知',
      supplierId: fields.supplierId, supplierName: fields.supplierId === null ? null : before.suppliers.find(s => s.id === fields.supplierId)?.name ?? '未知', previousPosName: before.fields.name }),
    reviewedAt: now, dispatchHash: hash(dispatchText) }
}
export const prepareArgs = (intake, p) => [intake.operation_id, intake.lease_token, p.commandText, p.posId, hash(p.expectedText), p.catalogText,
  p.dispatchText, p.beforeText, p.expectedText, p.reviewedAt, p.dispatchHash]
export const prepare = (db, intake, p) => rpc(db,
  'SELECT public.prepare_pos_product_edit_intake($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result', prepareArgs(intake, p))

// 実POSには接続しない。既存の台帳遷移とconsume証拠を合成DB内で作ってDB反映を検証する。
export async function confirm(db, intake, request) {
  let operation = (await prepare(db, intake, request)).operation
  await rpc(db, 'SELECT public.consume_pos_product_edit_dispatch($1,$2,$3,$4) AS result',
    [intake.actor_id, intake.store_id, intake.operation_id, request.dispatchHash])
  for (const [event, fingerprint] of [['dispatch_returned', null], ['pos_verified', hash(request.expectedText)]]) {
    operation = await rpc(db, 'SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result',
      [intake.actor_id, intake.store_id, operation.id, operation.payload_hash, operation.row_version, event, fingerprint])
  }
  operation = await rpc(db, 'SELECT public.apply_pos_product_edit($1,$2,$3,$4,$5) AS result',
    [intake.actor_id, intake.store_id, operation.id, operation.payload_hash, operation.row_version])
  await rpc(db, 'SELECT public.finish_pos_product_edit_intake($1,$2,NULL) AS result', [intake.operation_id, intake.lease_token])
  return operation
}

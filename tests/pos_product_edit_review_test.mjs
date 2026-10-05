import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'

const require = createRequire(new URL('../next_app/package.json', import.meta.url))
const ts = require('typescript')
const source = readFileSync(new URL('../next_app/lib/pos-products/edit-review.server.ts', import.meta.url), 'utf8')
const module = { exports: {} }
const imports = { 'server-only': {}, 'node:crypto': { createHash }, './validation': validation, './identity': identity }
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module, exports: module.exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    throw new Error(`Unexpected import: ${name}`)
  },
})
const { fingerprintProductEditSnapshot, buildProductEditReview, verifyProductEditResult } = module.exports
const now = 1800000000000
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const jan = '0490123456789'
const plain = value => JSON.parse(JSON.stringify(value))
const snapshot = () => ({
  storeId: 6, productId: 42, janCode: jan, capturedAt: now - 1000, complete: true,
  identity: { posProductId: 'pos-fixture-1', officeId: '11054', groupId: '11099', salesKind: 'retail', productCode: '', manufacturerCode: jan, exclusiveStore: true },
  fields: { name: '変更前商品', groupId: 'group6', price: '999', cost: '450', supplierId: null },
  settings: { nameKana: ' ヘンコウマエ ', abbreviation: '既存略称', taxId: 'tax-fixture', priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: 'c'.repeat(64) },
})
const choices = () => ({ storeId: 6, salesKind: 'retail', groupIds: ['group6', 'group6-2'], supplierIds: ['supplier6'] })
const command = (s = snapshot()) => ({ kind: 'update', operationId, storeId: 6, productId: 42, expectedFingerprint: fingerprintProductEditSnapshot(s, now), fields: { ...s.fields, name: '変更後商品' } })

test('編集レビューはserver-onlyでPOS送信や公開Actionを追加しない', () => {
  assert.match(source, /import 'server-only'/)
  assert.doesNotMatch(source, /['"]use server['"]|fetch\(|console\.(log|error)/)
})

test('名前だけの変更差分と送信対象を作り、原価・空の商品コード・フリガナ等を保持する', () => {
  const s = snapshot(); const before = structuredClone(s)
  const r = buildProductEditReview(command(s), s, choices(), now)
  assert.deepEqual(plain(r.changes), [{ field: 'name', label: '商品名', before: '変更前商品', after: '変更後商品' }])
  assert.deepEqual(plain(r.patch), { goodsName: '変更後商品' })
  assert.equal(r.expectedSnapshot.fields.cost, '450')
  assert.equal(r.expectedSnapshot.identity.productCode, '')
  assert.deepEqual(plain(r.expectedSnapshot.settings), s.settings)
  assert.deepEqual(s, before)
  r.expectedSnapshot.settings.nameKana = 'mutated'
  assert.equal(s.settings.nameKana, before.settings.nameKana)
})

test('金額・原価・グループ・仕入先の変更は確認したPOS項目だけに対応する', () => {
  const s = snapshot(); const c = command(s)
  c.fields = { ...s.fields, price: '1001', cost: '401', groupId: 'group6-2', supplierId: 'supplier6' }
  const r = buildProductEditReview(c, s, choices(), now)
  assert.deepEqual(plain(r.patch), { goodsGroup: 'group6-2', gddGoodsPrice: '1001', gddGoodsCost: '401', gddSupplierCd: 'supplier6' })
  assert.equal(r.changes.length, 4)
  const unset = buildProductEditReview({ ...command({ ...s, fields: { ...s.fields, supplierId: 'supplier6' } }), fields: s.fields }, { ...s, fields: { ...s.fields, supplierId: 'supplier6' } }, choices(), now)
  assert.equal(unset.patch.gddSupplierCd, '')
})

test('別店舗・別商品ID・共有所属・別内部IDのsnapshotを受け付けない', () => {
  const c = command()
  for (const modify of [s => { s.storeId = 7 }, s => { s.productId = 43 }, s => { s.identity.exclusiveStore = false }, s => { s.identity.groupId = '11098' }, s => { s.identity.posProductId = 'another-id' }, s => { s.identity.productCode = '4901234567890' }]) {
    const s = snapshot(); modify(s)
    assert.throws(() => buildProductEditReview(c, s, choices(), now))
  }
})

test('編集開始後に商品値や保護項目が変われば競合として停止する', () => {
  const c = command()
  for (const modify of [s => { s.fields.cost = '400' }, s => { s.fields.name = '別担当の名前' }, s => { s.settings.nameKana = 'ベツ' }, s => { s.settings.taxId = 'another' }, s => { s.settings.otherSettingsFingerprint = 'd'.repeat(64) }]) {
    const s = snapshot(); modify(s)
    assert.throws(() => buildProductEditReview(c, s, choices(), now), /変更|競合/)
  }
})

test('取得失敗・古いsnapshot・未来時刻・不完全な保護設定は拒否する', () => {
  for (const modify of [s => { s.complete = false }, s => { s.capturedAt = now - 120001 }, s => { s.capturedAt = now + 5001 }, s => { s.capturedAt = NaN }, s => { delete s.settings.nameKana }, s => { s.settings.otherSettingsFingerprint = '' }, s => { s.cookie = 'must-not-leak' }]) {
    const s = snapshot(); modify(s)
    assert.throws(() => fingerprintProductEditSnapshot(s, now))
  }
})

test('未対応の店舗別価格・会計時入力・店舗別仕入先を一括へ変換しない', () => {
  for (const [field, value] of [['priceScope', 'per_store'], ['priceMode', 'at_checkout'], ['supplierScope', 'per_store']]) {
    const s = snapshot(); s.settings[field] = value
    assert.throws(() => buildProductEditReview(command(), s, choices(), now), /対応|方式/)
  }
})

test('手入力小数を黙って切り捨てず、POS保存用レビューでは整数円を要求する', () => {
  for (const field of ['price', 'cost']) {
    const c = command(); c.fields[field] = '499.5'
    assert.throws(() => buildProductEditReview(c, snapshot(), choices(), now), /整数/)
  }
  const c = command(); c.fields.cost = '0'
  assert.equal(buildProductEditReview(c, snapshot(), choices(), now).patch.gddGoodsCost, '0')
})

test('現在の店舗候補にないグループ・仕入先は送信対象にしない', () => {
  assert.throws(() => buildProductEditReview(command(), snapshot(), { ...choices(), storeId: 7 }, now))
  const c = command(); c.fields.groupId = 'other-store-group'
  assert.throws(() => buildProductEditReview(c, snapshot(), choices(), now))
  c.fields = { ...snapshot().fields, supplierId: 'other-store-supplier' }
  assert.throws(() => buildProductEditReview(c, snapshot(), choices(), now))
})

test('無変更・通常編集へのJAN混入・新規追加は編集レビューで拒否する', () => {
  assert.throws(() => buildProductEditReview({ ...command(), fields: snapshot().fields }, snapshot(), choices(), now), /変更/)
  assert.throws(() => buildProductEditReview({ ...command(), janCode: jan }, snapshot(), choices(), now))
  assert.throws(() => buildProductEditReview({ kind: 'create', operationId, storeId: 6, janCode: jan, fields: snapshot().fields }, snapshot(), choices(), now))
})

test('指紋はキー順や取得時刻に依存せず、店舗・商品・保護値を含む', () => {
  const s = snapshot(); const reordered = Object.fromEntries(Object.entries(s).reverse())
  reordered.capturedAt = now
  reordered.settings = Object.fromEntries(Object.entries(s.settings).reverse())
  assert.equal(fingerprintProductEditSnapshot(s, now), fingerprintProductEditSnapshot(reordered, now))
  const changed = snapshot(); changed.identity.posProductId = 'different'
  assert.notEqual(fingerprintProductEditSnapshot(s, now), fingerprintProductEditSnapshot(changed, now))
})

test('保存後は最新の同一商品・全変更値・保護値が一致した場合だけ指紋を返す', () => {
  const r = buildProductEditReview(command(), snapshot(), choices(), now)
  const actual = plain(r.expectedSnapshot); actual.capturedAt = now + 1000
  assert.equal(verifyProductEditResult(r, actual, now + 2000), r.expectedResultFingerprint)
  for (const modify of [s => { s.fields.name = '変更前商品' }, s => { s.fields.cost = '499' }, s => { s.identity.posProductId = 'different' }, s => { s.settings.nameKana = '' }, s => { s.productId = 43 }, s => { s.capturedAt = now - 1 }]) {
    const altered = structuredClone(actual); modify(altered)
    assert.throws(() => verifyProductEditResult(r, altered, now + 2000))
  }
})

test('レビュー内容の変更と期待指紋の不整合を拒否する', () => {
  const r = buildProductEditReview(command(), snapshot(), choices(), now)
  const actual = plain(r.expectedSnapshot); actual.capturedAt = now + 1000
  r.expectedResultFingerprint = '0'.repeat(64)
  assert.throws(() => verifyProductEditResult(r, actual, now + 2000))
})

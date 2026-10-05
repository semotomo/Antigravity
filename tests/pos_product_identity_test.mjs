import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWritablePosProduct,
  assertProductIdentityChangeSafe,
  assertProductDeletionSafe,
  PRODUCT_REFERENCE_KINDS,
} from '../next_app/lib/pos-products/identity.ts'

const jan = '0490123456789'
const fingerprint = 'b'.repeat(64)
const product = () => ({ posProductId: 'POS-42', officeId: '11054', groupId: '11099', salesKind: 'retail',
  productCode: jan, manufacturerCode: jan, exclusiveStore: true })
const search = candidates => ({ storeId: 6, janCode: jan, complete: true, searchedFields: ['productCode', 'manufacturerCode'], candidates })
const usage = () => ({ storeId: 6, productId: 42, fingerprint, complete: true,
  counts: Object.fromEntries(PRODUCT_REFERENCE_KINDS.map(k => [k, 0])), currentStock: 0, pendingOperation: false,
  posReferencesChecked: true, posHasReferences: false })
const request = () => ({ storeId: 6, productId: 42, expectedFingerprint: fingerprint })

test('店名表示やJANだけでなくPOS所属グループ・店舗コードを照合する', () => {
  assert.equal(resolveWritablePosProduct(search([product()])).posProductId, 'POS-42')
  for (const change of [{ groupId: '11098' }, { officeId: '11053' }, { groupId: '11097' }, { exclusiveStore: false }, { salesKind: 'service' }]) {
    assert.throws(() => resolveWritablePosProduct(search([{ ...product(), ...change }])))
  }
})

test('商品コードとメーカー品番は両検索を終え、一意な内部商品IDの場合だけ解決', () => {
  const same = product()
  assert.equal(resolveWritablePosProduct(search([same, { ...same }])).posProductId, 'POS-42')
  assert.throws(() => resolveWritablePosProduct(search([same, { ...same, posProductId: 'POS-43' }])))
  assert.throws(() => resolveWritablePosProduct({ ...search([same]), complete: false }))
  assert.throws(() => resolveWritablePosProduct({ ...search([same]), searchedFields: ['productCode'] }))
  assert.throws(() => resolveWritablePosProduct(search([])))
})

test('メーカー品番だけの既存商品は識別可能だが、不一致や変化した同一IDは拒否', () => {
  assert.equal(resolveWritablePosProduct(search([{ ...product(), productCode: '' }])).posProductId, 'POS-42')
  assert.throws(() => resolveWritablePosProduct(search([{ ...product(), manufacturerCode: '4901234567890' }])))
  assert.throws(() => resolveWritablePosProduct(search([product(), { ...product(), manufacturerCode: '' }])))
})

test('同じJANでも本店のPOS対応で独立に識別する', () => {
  const main = { ...product(), officeId: '11053', groupId: '11098', posProductId: 'POS-MAIN' }
  assert.equal(resolveWritablePosProduct({ ...search([main]), storeId: 7 }).posProductId, 'POS-MAIN')
  assert.throws(() => resolveWritablePosProduct({ ...search([main]), storeId: 0 }))
})

test('参照調査の欠損・不正件数・対象不一致・古い状態は削除を拒否', () => {
  assert.doesNotThrow(() => assertProductDeletionSafe(request(), usage()))
  for (const change of [{ complete: false }, { counts: {} }, { storeId: 7 }, { productId: 99 }, { fingerprint: 'old' },
    { currentStock: null }, { currentStock: -1 }, { pendingOperation: true }, { posReferencesChecked: false }, { posHasReferences: true }]) {
    assert.throws(() => assertProductDeletionSafe(request(), { ...usage(), ...change }))
  }
  for (const count of [-1, null, '0', NaN]) {
    const refs = usage()
    refs.counts[PRODUCT_REFERENCE_KINDS[0]] = count
    assert.throws(() => assertProductDeletionSafe(request(), refs))
  }
})

test('どの種類の履歴も一件あれば物理削除を止め、停止機能を案内', () => {
  for (const kind of PRODUCT_REFERENCE_KINDS) {
    const refs = usage()
    refs.counts[kind] = 1
    assert.throws(() => assertProductDeletionSafe(request(), refs), /停止/)
  }
})

test('JAN訂正は現行・過去JANの同店舗衝突を拒否し、他店舗JANは混ぜない', () => {
  const target = { ...request(), oldJanCode: jan, newJanCode: '4901234567890' }
  const reservations = { complete: true, storeId: 6, janCode: target.newJanCode, owners: [] }
  assert.doesNotThrow(() => assertProductIdentityChangeSafe(target, usage(), reservations))
  for (const change of [{ complete: false }, { storeId: 7 }, { janCode: jan }, { owners: [99] }, { owners: [42] }]) {
    assert.throws(() => assertProductIdentityChangeSafe(target, usage(), { ...reservations, ...change }))
  }
})

test('履歴対応表への移行前は参照付きJAN変更を拒否しsnapshotを書き換えない', () => {
  const refs = usage()
  refs.counts.inventoryItems = 1
  const before = structuredClone(refs)
  assert.throws(() => assertProductIdentityChangeSafe({ ...request(), oldJanCode: jan, newJanCode: '4901234567890' }, refs,
    { complete: true, storeId: 6, janCode: '4901234567890', owners: [] }))
  assert.deepEqual(refs, before)
})

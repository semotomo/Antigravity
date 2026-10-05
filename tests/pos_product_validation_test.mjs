import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePosProductCommand,
  normalizeProductJan,
  normalizeProductMoney,
  suggestProductCost,
  validateProductChoices,
} from '../next_app/lib/pos-products/validation.ts'

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fingerprint = 'a'.repeat(64)
const jan = '0490123456789'
const fields = { name: 'テスト商品', groupId: 'group-1', price: '1000', cost: '500', supplierId: null }
const create = () => ({ kind: 'create', operationId, storeId: 6, janCode: jan, fields: { ...fields } })
const update = () => ({ kind: 'update', operationId, storeId: 6, productId: 42, expectedFingerprint: fingerprint, fields: { ...fields } })

test('JANは先頭0を保ち全角数字を正規化するが、数値や途中の空白は拒否する', () => {
  assert.equal(normalizeProductJan(' ０４９０１２３４５６７８９ '), jan)
  for (const invalid of [490123456789, '', '49 0123456789', '123', null, '4901234567890\n0']) {
    assert.throws(() => normalizeProductJan(invalid))
  }
})

test('商品金額は未入力と0を区別し、指数・負数・非有限値・過剰な小数を拒否する', () => {
  assert.equal(normalizeProductMoney('0000.00'), '0')
  assert.equal(normalizeProductMoney('0499.50'), '499.5')
  for (const invalid of ['', null, '1e3', '-1', '1,000', Infinity, '0.001', 1.0000001]) {
    assert.throws(() => normalizeProductMoney(invalid))
  }
})

test('原価50%は1円未満を切り捨て、手入力済みの原価を保持する', () => {
  assert.equal(suggestProductCost('1000', { mode: 'automatic', value: '' }), '500')
  assert.equal(suggestProductCost('999', { mode: 'automatic', value: '' }), '499')
  assert.equal(suggestProductCost('0', { mode: 'automatic', value: '' }), '0')
  assert.equal(suggestProductCost('0.01', { mode: 'automatic', value: '' }), '0')
  for (const [price, expected] of [['1', '0'], ['1.99', '0'], ['2', '1'], ['999.99', '499'], ['1000.01', '500'], ['999999999.99', '499999999']]) {
    assert.equal(suggestProductCost(price, { mode: 'automatic', value: '' }), expected)
  }
  for (const price of ['', '-1', '0.001', Infinity, '1000000000']) {
    assert.throws(() => suggestProductCost(price, { mode: 'automatic', value: '' }))
  }
  assert.equal(suggestProductCost('2000', { mode: 'manual', value: '450' }), '450')
  assert.equal(suggestProductCost('', { mode: 'manual', value: '' }), '')
})

test('商品追加のJANと店販入力を正規化し、不明な送信フィールドを拒否する', () => {
  const result = parsePosProductCommand(create())
  assert.equal(result.janCode, jan)
  assert.equal(result.fields.price, '1000')
  assert.equal(result.fields.supplierId, null)
  for (const extra of [{ storeType: 'master' }, { posUrl: 'https://example.com' }, { productId: 42 }]) {
    assert.throws(() => parsePosProductCommand({ ...create(), ...extra }))
  }
  assert.throws(() => parsePosProductCommand({ ...create(), fields: { ...fields, isActive: false } }))
})

test('通常編集ではJAN・店舗・区分・略称等をフィールドへ混入できない', () => {
  assert.equal(parsePosProductCommand(update()).productId, 42)
  for (const forbidden of ['janCode', 'storeId', 'salesKind', 'nameKana', 'abbreviation']) {
    assert.throws(() => parsePosProductCommand({ ...update(), fields: { ...fields, [forbidden]: 'changed' } }))
  }
})

test('店舗・操作ID・商品ID・期待指紋は厳格に検証する', () => {
  for (const storeId of ['6', 0, 8, null]) assert.throws(() => parsePosProductCommand({ ...create(), storeId }))
  for (const productId of [0, -1, 1.1, '42', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parsePosProductCommand({ ...update(), productId }))
  }
  assert.throws(() => parsePosProductCommand({ ...create(), operationId: 'not-a-uuid' }))
  assert.throws(() => parsePosProductCommand({ ...update(), expectedFingerprint: '' }))
  assert.throws(() => parsePosProductCommand([]))
})

test('JAN訂正は理由・旧JAN再確認・異なる新JANを必須とする', () => {
  const input = { kind: 'change_jan', operationId, storeId: 6, productId: 42, expectedFingerprint: fingerprint,
    oldJanCode: jan, newJanCode: '4901234567890', confirmationJan: jan, reason: '誤登録を訂正' }
  assert.equal(parsePosProductCommand(input).newJanCode, '4901234567890')
  for (const change of [{ reason: ' ' }, { confirmationJan: '4901234567890' }, { newJanCode: jan }]) {
    assert.throws(() => parsePosProductCommand({ ...input, ...change }))
  }
})

test('削除は明示確認・理由・対象JANの再入力が必要', () => {
  const input = { kind: 'delete', operationId, storeId: 7, productId: 42, expectedFingerprint: fingerprint,
    janCode: jan, confirmationJan: jan, confirmed: true, reason: '誤って追加した未使用商品' }
  assert.equal(parsePosProductCommand(input).kind, 'delete')
  for (const change of [{ reason: '' }, { confirmed: false }, { confirmed: 'true' }, { confirmationJan: '' }]) {
    assert.throws(() => parsePosProductCommand({ ...input, ...change }))
  }
})

test('グループと仕入先は同店舗・店販のサーバー取得選択肢だけを許可', () => {
  const choices = { storeId: 6, salesKind: 'retail', groupIds: ['group-1'], supplierIds: ['supplier-1'] }
  assert.doesNotThrow(() => validateProductChoices(parsePosProductCommand(create()), choices))
  assert.throws(() => validateProductChoices(parsePosProductCommand(create()), { ...choices, storeId: 7 }))
  assert.throws(() => validateProductChoices(parsePosProductCommand(create()), { ...choices, salesKind: 'service' }))
  assert.throws(() => validateProductChoices(parsePosProductCommand(create()), { ...choices, groupIds: [] }))
  const supplier = parsePosProductCommand({ ...create(), fields: { ...fields, supplierId: 'wrong-store' } })
  assert.throws(() => validateProductChoices(supplier, choices))
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateInventoryBalance,
  createInventorySourceFingerprint,
} from '../next_app/lib/inventory/calculation.ts'
import { normalizePosSnapshot } from '../next_app/lib/inventory/posSnapshot.ts'

const JAN = '4900000000001'

function baseInput() {
  return {
    storeId: 7,
    productId: 101,
    janCode: JAN,
    physicalQuantity: 10,
    countedAt: '2026-08-23T01:15:30.000Z',
    calculatedAsOf: '2026-08-23T03:00:00.000Z',
    posRows: [],
    transfers: [],
    adjustments: [],
  }
}

test('POS snapshotは販売・返品を正規化し、同一内容行を削除せずordinalで保持する', () => {
  const duplicateSale = {
    productCode: JAN,
    productName: 'テスト商品',
    taskContent: '販売',
    storeName: '本店',
    taskDateTime: '2026/08/23 10:16',
    quantity: -1,
    cost: 100,
    totalCost: -100,
  }
  const snapshot = normalizePosSnapshot([
    duplicateSale,
    { ...duplicateSale },
    { ...duplicateSale, taskContent: '返品', taskDateTime: '2026/08/23 10:17' },
    { ...duplicateSale, taskContent: '注文', taskDateTime: '2026/08/23 10:18' },
  ], 7)

  assert.equal(snapshot.rows.length, 4)
  assert.deepEqual(snapshot.rows.slice(0, 2).map((row) => row.signatureOrdinal), [1, 2])
  assert.equal(snapshot.rows[0].eventKind, 'sale')
  assert.equal(snapshot.rows[0].quantity, 1)
  assert.equal(snapshot.rows[2].eventKind, 'return')
  assert.equal(snapshot.rows[3].eventKind, 'order')
  assert.equal(snapshot.rows[0].eventAt, '2026-08-23T01:16:00.000Z')
  assert.match(snapshot.payloadSha256, /^[0-9a-f]{64}$/)
})

test('不正なPOS日時は現在時刻へ補正せず拒否する', () => {
  assert.throws(() => normalizePosSnapshot([{
    productCode: JAN,
    productName: 'テスト商品',
    taskContent: '販売',
    storeName: '本店',
    taskDateTime: '2026/02/30 10:00',
    quantity: 1,
    cost: 100,
    totalCost: 100,
  }], 7), /POS日時/)
})

test('計数時刻以降の販売・返品・移動・使用・調整を基本式どおり集計する', () => {
  const result = calculateInventoryBalance({
    ...baseInput(),
    posRows: [
      { storeId: 7, matchedProductId: 101, eventKind: 'sale', eventAt: '2026-08-23T01:16:00.000Z', quantity: 3 },
      { storeId: 7, matchedProductId: 101, eventKind: 'return', eventAt: '2026-08-23T01:17:00.000Z', quantity: 1 },
    ],
    transfers: [
      { id: 1, entryType: 'transfer', fromStoreId: 7, toStoreId: 6, janCode: JAN, quantity: 2, occurredAt: '2026-08-23T01:20:00.000Z' },
      { id: 2, entryType: 'transfer', fromStoreId: 6, toStoreId: 7, janCode: JAN, quantity: 1, occurredAt: '2026-08-23T01:30:00.000Z' },
      { id: 3, entryType: 'usage', fromStoreId: 7, toStoreId: null, janCode: JAN, quantity: 1, occurredAt: '2026-08-23T01:40:00.000Z' },
    ],
    adjustments: [
      { id: 'a1', storeId: 7, productId: 101, quantityDelta: 2, effectiveAt: '2026-08-23T01:50:00.000Z' },
    ],
  })

  assert.deepEqual(result, {
    physicalQuantity: 10,
    salesQuantity: 3,
    returnQuantity: 1,
    transferInQuantity: 1,
    transferOutQuantity: 2,
    usageQuantity: 1,
    adjustmentDelta: 2,
    calculatedQuantity: 8,
    appliedPosRowCount: 2,
    ambiguousPosRowCount: 0,
  })
})

test('POSと計数が同じ分なら自動計算せず曖昧件数へ送る', () => {
  const result = calculateInventoryBalance({
    ...baseInput(),
    posRows: [
      { storeId: 7, matchedProductId: 101, eventKind: 'sale', eventAt: '2026-08-23T01:15:00.000Z', quantity: 2 },
    ],
  })

  assert.equal(result.salesQuantity, 0)
  assert.equal(result.calculatedQuantity, 10)
  assert.equal(result.ambiguousPosRowCount, 1)
})

test('同じsnapshotを再計算しても加減を継ぎ足さず同じ結果とfingerprintを返す', () => {
  const input = {
    ...baseInput(),
    posRows: [
      { storeId: 7, matchedProductId: 101, eventKind: 'sale', eventAt: '2026-08-23T01:16:00.000Z', quantity: 2 },
      { storeId: 7, matchedProductId: 101, eventKind: 'sale', eventAt: '2026-08-23T01:16:00.000Z', quantity: 2 },
    ],
  }

  const first = calculateInventoryBalance(input)
  const second = calculateInventoryBalance(input)
  assert.deepEqual(first, second)
  assert.equal(first.salesQuantity, 4)
  assert.equal(first.calculatedQuantity, 6)

  const fingerprintInput = {
    version: 1,
    sessionId: '11111111-1111-4111-8111-111111111111',
    snapshotPayloadSha256: 'a'.repeat(64),
    calculatedAsOf: input.calculatedAsOf,
    items: [{ productId: 101, quantity: 10, countedAt: input.countedAt, rowVersion: 1 }],
    transfers: [],
    adjustments: [],
  }
  assert.equal(
    createInventorySourceFingerprint(fingerprintInput),
    createInventorySourceFingerprint({ ...fingerprintInput, items: [...fingerprintInput.items] }),
  )
})

test('同じJANでも別店舗・別product_idのPOS行や移動を混ぜない', () => {
  const result = calculateInventoryBalance({
    ...baseInput(),
    posRows: [
      { storeId: 6, matchedProductId: 101, eventKind: 'sale', eventAt: '2026-08-23T01:16:00.000Z', quantity: 9 },
      { storeId: 7, matchedProductId: 202, eventKind: 'sale', eventAt: '2026-08-23T01:17:00.000Z', quantity: 9 },
    ],
    transfers: [
      { id: 1, entryType: 'usage', fromStoreId: 6, toStoreId: null, janCode: JAN, quantity: 9, occurredAt: '2026-08-23T01:20:00.000Z' },
      { id: 2, entryType: 'usage', fromStoreId: 7, toStoreId: null, janCode: '4900000000002', quantity: 9, occurredAt: '2026-08-23T01:20:00.000Z' },
    ],
  })

  assert.equal(result.calculatedQuantity, 10)
})

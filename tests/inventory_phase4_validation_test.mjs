import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseInventoryAdjustmentRequest,
  parseInventoryCorrectionRequest,
  parseInventoryExclusionRequest,
  parseInventoryFinalizeRequest,
  parseInventoryOverviewRequest,
  parseInventoryProductStatusRequest,
} from '../next_app/lib/inventory/validation.ts'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const snapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('商品停止・除外・確定後訂正は理由と店舗JANを必須にする', () => {
  const status = parseInventoryProductStatusRequest({
    storeId: 7,
    janCode: '4901234567890',
    active: false,
    reason: '今後取り扱わないため',
  })
  assert.equal(status.active, false)

  assert.throws(() => parseInventoryProductStatusRequest({ ...status, reason: ' ' }))
  assert.throws(() => parseInventoryProductStatusRequest({ ...status, storeId: 6, janCode: 'ABC' }))

  const exclusion = parseInventoryExclusionRequest({
    storeId: 7,
    sessionId,
    janCode: '4901234567890',
    excluded: true,
    reason: '現物確認対象外',
    expectedRowVersion: 1,
  })
  assert.equal(exclusion.excluded, true)

  const correction = parseInventoryCorrectionRequest({
    storeId: 7,
    sessionId,
    janCode: '4901234567890',
    quantity: 0,
    reason: '確定後に数え直したため',
    expectedRowVersion: 2,
  })
  assert.equal(correction.quantity, 0)
})

test('確定要求はsession・snapshot・row version・計算時刻を検証する', () => {
  const result = parseInventoryFinalizeRequest({
    storeId: 6,
    sessionId,
    snapshotId,
    expectedRowVersion: 3,
    calculatedAsOf: '2026-08-24T01:00:00.000Z',
  })
  assert.equal(result.storeId, 6)
  assert.throws(() => parseInventoryFinalizeRequest({ ...result, calculatedAsOf: 'invalid' }))
  assert.throws(() => parseInventoryFinalizeRequest({ ...result, expectedRowVersion: 0 }))
})

test('手動調整は0を拒否し、符号付き数量・理由・冪等キーを検証する', () => {
  const result = parseInventoryAdjustmentRequest({
    storeId: 7,
    sessionId,
    janCode: '4901234567890',
    quantityDelta: -2,
    reason: '破損品を除外',
    idempotencyKey: snapshotId,
  })
  assert.equal(result.quantityDelta, -2)
  assert.throws(() => parseInventoryAdjustmentRequest({ ...result, quantityDelta: 0 }))
  assert.throws(() => parseInventoryAdjustmentRequest({ ...result, reason: '' }))
})

test('現在庫一覧は検索長・状態・ページ範囲を制限する', () => {
  const result = parseInventoryOverviewRequest({
    storeId: '7',
    query: 'a'.repeat(200),
    stockStatus: 'negative',
    limit: 999,
    offset: -1,
  })
  assert.equal(result.query.length, 100)
  assert.equal(result.limit, 200)
  assert.equal(result.offset, 0)
  assert.throws(() => parseInventoryOverviewRequest({ ...result, stockStatus: 'invalid' }))
})

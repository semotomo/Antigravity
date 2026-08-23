import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseInventoryCountRequest,
  parseInventoryWorkspaceRequest,
} from '../next_app/lib/inventory/validation.ts'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('在庫0を有効な棚卸し数量として受け付ける', () => {
  const result = parseInventoryCountRequest({
    storeId: 7,
    sessionId,
    janCode: '0490123456789',
    quantity: 0,
    mode: 'initial',
    expectedRowVersion: 1,
  })

  assert.equal(result.quantity, 0)
  assert.equal(result.janCode, '0490123456789')
})

test('負数・小数4桁・不正店舗・不正row versionを拒否する', () => {
  const base = {
    storeId: 7,
    sessionId,
    janCode: '4901234567890',
    quantity: 1,
    mode: 'replace',
    expectedRowVersion: 2,
  }

  assert.throws(() => parseInventoryCountRequest({ ...base, quantity: -1 }))
  assert.throws(() => parseInventoryCountRequest({ ...base, quantity: '1.2345' }))
  assert.throws(() => parseInventoryCountRequest({ ...base, storeId: 8 }))
  assert.throws(() => parseInventoryCountRequest({ ...base, expectedRowVersion: 0 }))
})

test('数量保存方法はinitial・add・replaceだけを許可する', () => {
  for (const mode of ['initial', 'add', 'replace']) {
    assert.equal(
      parseInventoryCountRequest({
        storeId: 6,
        sessionId,
        janCode: '4901234567890',
        quantity: 2,
        mode,
        expectedRowVersion: 1,
      }).mode,
      mode,
    )
  }

  assert.throws(() => parseInventoryCountRequest({
    storeId: 6,
    sessionId,
    janCode: '4901234567890',
    quantity: 2,
    mode: 'subtract',
    expectedRowVersion: 1,
  }))
})

test('一覧入力は検索長・取得件数・offsetを安全な範囲へ制限する', () => {
  const result = parseInventoryWorkspaceRequest({
    storeId: '7',
    sessionId,
    query: 'a'.repeat(200),
    countStatus: 'uncounted',
    limit: '9999',
    offset: '-10',
  })

  assert.equal(result.query.length, 100)
  assert.equal(result.limit, 200)
  assert.equal(result.offset, 0)
})

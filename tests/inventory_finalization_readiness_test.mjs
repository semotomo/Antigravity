import assert from 'node:assert/strict'
import test from 'node:test'

import { getInventoryFinalizationReadiness } from '../next_app/lib/inventory/workspace.ts'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function createSupabase(progress, sessionOverrides = {}) {
  const calls = []
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args })
        return {
          data: {
            session: {
              id: sessionId,
              storeId: 6,
              status: 'draft',
              startedAt: '2026-08-26T00:00:00.000Z',
              updatedAt: '2026-08-26T01:00:00.000Z',
              rowVersion: 7,
              ...sessionOverrides,
            },
            progress,
            items: [],
            filteredCount: progress.totalCount,
            limit: 1,
            offset: 0,
          },
          error: null,
        }
      },
    },
  }
}

test('確定前チェックは一覧を1件だけ取得し、進捗だけで確定可否を返す', async () => {
  const supabase = createSupabase({
    totalCount: 2764,
    countedCount: 2,
    uncountedCount: 2762,
    excludedCount: 0,
    progressRate: 0.1,
  })

  const result = await getInventoryFinalizationReadiness(supabase.client, {
    storeId: 6,
    sessionId,
  })

  assert.deepEqual(result, {
    rowVersion: 7,
    totalCount: 2764,
    countedCount: 2,
    pendingCount: 2762,
    excludedCount: 0,
    canFinalize: false,
  })
  assert.equal(supabase.calls.length, 1)
  assert.equal(supabase.calls[0].name, 'get_inventory_workspace')
  assert.equal(supabase.calls[0].args.p_limit, 1)
})

test('全商品が棚卸し済みまたは除外済みで、入力が1件以上あれば確定可能にする', async () => {
  const supabase = createSupabase({
    totalCount: 2764,
    countedCount: 2700,
    uncountedCount: 0,
    excludedCount: 64,
    progressRate: 100,
  })

  const result = await getInventoryFinalizationReadiness(supabase.client, {
    storeId: 6,
    sessionId,
  })

  assert.equal(result.canFinalize, true)
})

test('全商品除外またはdraft以外のセッションは確定可能にしない', async () => {
  const allExcluded = createSupabase({
    totalCount: 10,
    countedCount: 0,
    uncountedCount: 0,
    excludedCount: 10,
    progressRate: 100,
  })
  const result = await getInventoryFinalizationReadiness(allExcluded.client, {
    storeId: 6,
    sessionId,
  })
  assert.equal(result.canFinalize, false)

  const finalized = createSupabase({
    totalCount: 10,
    countedCount: 10,
    uncountedCount: 0,
    excludedCount: 0,
    progressRate: 100,
  }, { status: 'finalized' })
  await assert.rejects(
    getInventoryFinalizationReadiness(finalized.client, { storeId: 6, sessionId }),
    /確定前チェックできません/,
  )
})

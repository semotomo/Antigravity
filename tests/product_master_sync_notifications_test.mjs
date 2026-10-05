import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const ts = createRequire(new URL('../next_app/package.json', import.meta.url))('typescript')
function load(path, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../next_app/${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => {
    assert.ok(Object.hasOwn(imports, name), name)
    return imports[name]
  }, ...globals })
  return exports
}
const store = { id: 7, name: '本店', tenpoGroupId: '11098', tenpoGroupName: 'からつケンネル本店' }
const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('店舗に束縛された確定拒否だけ商品未変更と表示し、原文は公開しない', () => {
  const api = load('lib/product-sync/notifications.ts')
  for (const code of ['PRODUCT_SYNC_PENDING_EDIT', 'PRODUCT_SYNC_PENDING_SYNC', 'PRODUCT_SYNC_STALE', 'PRODUCT_SYNC_INVALID_DATA', 'PRODUCT_SYNC_EXPIRED', 'PRODUCT_SYNC_DISABLED', 'PRODUCT_SYNC_UNAVAILABLE']) {
    const result = api.decodeProductMasterSyncResult(store, { success: false, master: {
      success: false, storeId: 7, code, outcome: 'rejected', runId,
      message: 'private-cookie-html', logs: 'private-token',
    } })
    assert.equal(result.outcome, 'rejected')
    assert.equal(result.code, code)
    assert.match(result.message, /商品は変更されていません/)
    assert.doesNotMatch(JSON.stringify(result), /private/)
  }
})

test('不明応答・店舗違い・件数不足は結果不明で再送禁止と表示する', () => {
  const api = load('lib/product-sync/notifications.ts')
  for (const payload of [null, {}, { success: true },
    { success: false, master: { success: false, code: 'PRODUCT_SYNC_STALE', outcome: 'rejected', storeId: 6 } },
    { success: false, master: { success: false, code: 'private-secret', outcome: 'rejected', storeId: 7 } },
    { success: true, master: { success: true, storeId: 7, runId, csvRowCount: 5, syncResult: { count: 4 } } },
    { success: true, storeId: 6, runId, csvRowCount: 5, syncResult: { count: 5 } },
    { success: true, storeId: 7, csvRowCount: 5, syncResult: { count: 5 } },
  ]) {
    const result = api.decodeProductMasterSyncResult(store, payload)
    assert.equal(result.outcome, 'unknown')
    assert.match(result.nextStep, /再送せず/)
    assert.doesNotMatch(result.message, /商品は変更されていません/)
  }
})

test('成功にはCSV全件と一致する適用件数が必要で、余計なGAS情報を返さない', () => {
  const api = load('lib/product-sync/notifications.ts')
  const result = api.decodeProductMasterSyncResult(store, { success: true, master: {
    success: true, storeId: 7, runId, csvRowCount: 5, syncResult: { count: 5 }, logs: 'private-cookie',
  } })
  assert.equal(result.success, true)
  assert.equal(result.csvCount, 5)
  assert.equal(result.syncCount, 5)
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

function runnerFixture({ responses = [], blocked = [], recordFailure = false } = {}) {
  const calls = []
  const notifications = load('lib/product-sync/notifications.ts')
  const server = load('lib/product-sync/run.server.ts', {
    'server-only': {},
    'node:crypto': { randomUUID: () => runId },
    './notifications': notifications,
    './notifications.server': {
      getProductSyncNotificationGate: async id => { calls.push(['gate', id]); return { blocked: blocked.includes(id) } },
      recordProductSyncNotification: async (...args) => { calls.push(['record', ...args]); if (recordFailure) throw Error('private-token') },
    },
  }, { Date, setTimeout: fn => fn() })
  return { calls, run: () => server.runProductMasterSync([store, { ...store, id: 6, name: 'わんわん' }], 'cron', async target => {
    calls.push(['send', target.id])
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response
  }) }
}

test('全失敗と部分失敗を成功扱いせず、失敗を店舗ごとに永続記録する', async () => {
  const success = { success: true, master: { success: true, storeId: 7, runId, csvRowCount: 5, syncResult: { count: 5 } } }
  for (const responses of [[null, null], [success, null]]) {
    const f = runnerFixture({ responses })
    const result = await f.run()
    assert.equal(result.success, false)
    assert.equal(result.results.length, 2)
    assert.equal(f.calls.filter(row => row[0] === 'record').length, 2)
  }
})

test('結果不明が未解消の店舗は手動/cronとも送信せず、通信例外を漏らさない', async () => {
  const f = runnerFixture({ blocked: [7], responses: [Error('private-cookie-html')] })
  const result = await f.run()
  assert.equal(result.success, false)
  assert.deepEqual(f.calls.filter(row => row[0] === 'send'), [['send', 6]])
  assert.equal(result.results[0].outcome, 'unknown')
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('通知永続記録が失敗した場合も成功を偽らず、保存不能を固定文で返す', async () => {
  const f = runnerFixture({ responses: [null, null], recordFailure: true })
  const result = await f.run()
  assert.equal(result.success, false)
  assert.equal(result.notificationsSaved, false)
  assert.match(result.message, /通知を保存できませんでした/)
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('商品適用成功と通知だけの保存失敗を区分し、再送不要と表示する', async () => {
  const f = runnerFixture({ recordFailure: true, responses: [7, 6].map(storeId => ({ success: true, storeId, runId,
    csvRowCount: 5, syncResult: { count: 5 } })) })
  const result = await f.run()
  assert.equal(result.success, false)
  assert.ok(result.results.every(row => row.success))
  assert.match(result.message, /適用済み/)
  assert.match(result.message, /再送は不要/)
  assert.doesNotMatch(result.message, /店舗の商品マスタ同期に失敗/)
})

function routeFixture({ user = true, allowed = [7, 6], view = 'all', success = true, throwPrivate = false } = {}) {
  const calls = []
  const notifications = load('lib/product-sync/notifications.ts')
  const validation = load('lib/inventory/validation.ts', {}, { URL })
  class InventoryAccessError extends Error { constructor(status) { super('private-role'); this.status = status } }
  const imports = {
    'next/cache': { revalidatePath: path => calls.push(['refresh', path]) },
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabase/server': { createClient: async () => {
      calls.push(['client'])
      return { auth: { getUser: async () => { calls.push(['auth']); return { data: { user: user ? { id: runId } : null }, error: null } } } }
    } },
    '@/lib/inventory/validation': validation,
    '@/lib/storeAuth': { getStoreContext: async () => ({ currentView: view }) },
    '@/lib/inventory/auth': { InventoryAccessError, requireInventoryManagerAccess: async (_db, id) => {
      calls.push(['manager', id]); if (!allowed.includes(id)) throw new InventoryAccessError(403)
    } },
    '@/lib/product-sync/notifications': notifications,
    '@/lib/product-sync/run.server': { runProductMasterSync: async (stores, source) => {
      calls.push(['run', stores.map(row => row.id), source])
      if (throwPrivate) throw Error('private-cookie-html')
      return { success, notificationsSaved: true, message: '固定の安全な結果', results: stores.map(row => ({
        storeId: row.id, success, outcome: success ? 'succeeded' : 'rejected',
      })) }
    } },
    '@/lib/product-sync/notifications.server': { updateProductSyncSuccessHistory: async () => calls.push(['history']) },
    '@/lib/pos-products/master-sync-transport.server': { configuredProductMasterSyncTransport: () => ({ sync: async () => { throw Error('Unexpected send') } }) },
  }
  const globals = { process: { env: { CRON_SECRET: 'test-secret' } }, URL }
  return { calls, manual: load('app/api/gas/sync-products/route.ts', imports, globals), cron: load('app/api/cron/products/sync/route.ts', imports, globals) }
}

const manualRequest = () => new Request('http://localhost/api/gas/sync-products', { method: 'POST', headers: { Origin: 'http://localhost' } })

test('手動同期のOrigin欠落・別サイト・不正Originは認証/DB/GASより前に403で拒否する', async () => {
  for (const origin of [null, 'https://other.example', 'not-an-origin', 'null', 'http://localhost/path', 'http://user:password@localhost', 'http://localhost/', 'http://localhost https://other.example']) {
    const f = routeFixture()
    const response = await f.manual.POST(new Request('http://localhost/api/gas/sync-products', {
      method: 'POST', headers: origin === null ? {} : { Origin: origin },
    }))
    assert.equal(response.status, 403, `${origin}`)
    assert.equal(response.body.success, false)
    assert.deepEqual(f.calls, [])
  }
})

test('手動同期は本人ログインと対象全店舗managerを再認可し、未認可なら送信しない', async () => {
  for (const options of [{ user: false }, { allowed: [7] }, { allowed: [] }]) {
    const f = routeFixture(options)
    const response = await f.manual.POST(manualRequest())
    assert.equal(response.status, options.user === false ? 401 : 403)
    assert.equal(f.calls.some(row => row[0] === 'run' || row[0] === 'history'), false)
    assert.doesNotMatch(JSON.stringify(response), /private/)
  }
  const f = routeFixture({ view: 'wanwan', allowed: [6] })
  assert.equal((await f.manual.POST(manualRequest())).status, 200)
  assert.deepEqual(Array.from(f.calls.find(row => row[0] === 'run')[1]), [6])
})

test('cronは専用認証必須で、手動/cronとも全店成功だけ最終成功日時を更新する', async () => {
  const denied = routeFixture()
  assert.equal((await denied.cron.GET(new Request('http://localhost/'))).status, 401)
  assert.equal(denied.calls.length, 0)
  for (const success of [true, false]) {
    for (const method of ['manual', 'cron']) {
      const f = routeFixture({ success })
      const response = method === 'manual' ? await f.manual.POST(manualRequest()) : await f.cron.GET(new Request('http://localhost/', { headers: { Authorization: 'Bearer test-secret' } }))
      assert.equal(response.body.success, success)
      assert.equal(f.calls.filter(row => row[0] === 'history').length, success ? 1 : 0)
      assert.equal(response.status === 200, success)
    }
  }
})

test('ルートの未知の例外は原文を返さず、同期状態確認と再送禁止を返す', async () => {
  const f = routeFixture({ throwPrivate: true })
  const response = await f.manual.POST(manualRequest())
  assert.equal(response.status, 500)
  assert.match(response.body.message, /再送せず/)
  assert.doesNotMatch(JSON.stringify(response), /private/)
})

function readFixture({ user = true, allowed = [{ store_id: 7, role: 'viewer' }] } = {}) {
  const calls = []
  const notices = load('lib/product-sync/notifications.ts')
  const row = { attempt_id: runId, store_id: 7, source: 'cron', outcome: 'unknown', code: 'PRODUCT_SYNC_UNKNOWN',
    run_id: runId, started_at: '2026-10-05T01:00:00Z', created_at: '2026-10-05T01:01:00Z', resolved_at: null,
    resolution_outcome: null, secret: 'private-token' }
  function query(table) {
    calls.push(['table', table])
    let resolved = false
    const q = {
      select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, is: () => q,
      not: () => { resolved = true; return q },
      in: (field, value) => { calls.push(['filter', field, value]); return q },
      then: fn => Promise.resolve({ data: table === 'user_store_access' ? allowed : resolved ? [] : [row], count: 1, error: null }).then(fn),
    }
    return q
  }
  const api = load('lib/product-sync/notifications.server.ts', {
    'server-only': {}, './notifications': notices,
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: user ? { id: runId } : null }, error: null }) }, from: query }) },
    '@supabase/supabase-js': { createClient: () => ({ rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: { blocked: true }, error: null } } }) },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost/', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } } })
  return { api, calls }
}

test('通知読取りは本人/店舗memberを検査し、viewerにも自店舗だけを返す', async () => {
  const anonymous = readFixture({ user: false })
  await assert.rejects(anonymous.api.readProductSyncNotifications(7))
  assert.equal(anonymous.calls.length, 0)
  const other = readFixture()
  await assert.rejects(other.api.readProductSyncNotifications(6))
  assert.equal(other.calls.some(row => row[0] === 'rpc' || row[1] === 'product_master_sync_notifications'), false)
  const f = readFixture()
  const result = await f.api.readProductSyncNotifications(null)
  assert.equal(result.notifications[0].storeId, 7)
  assert.ok(f.calls.filter(row => row[1] === 'store_id').every(row => JSON.stringify(row[2]) === '[6,7]' || JSON.stringify(row[2]) === '[7]'))
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('通知Actionは未知のDB例外を公開しない', async () => {
  const api = load('app/actions/productSyncNotifications.ts', {
    '@/lib/product-sync/notifications.server': { readProductSyncNotifications: async () => { throw Error('private-cookie-html') } },
  })
  const result = await api.getProductSyncNotifications(7)
  assert.equal(result.success, false)
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('通知表示は未変更の拒否・未確認・適用/未適用確認済みを同時に残す', () => {
  const require = createRequire(new URL('../next_app/package.json', import.meta.url))
  const { renderToStaticMarkup } = require('react-dom/server')
  const api = load('components/products/ProductSyncNotificationList.tsx', { 'react/jsx-runtime': require('react/jsx-runtime') })
  const notices = load('lib/product-sync/notifications.ts')
  const base = { source: 'cron', createdAt: '2026-10-05T01:00:00Z', resolvedAt: null, resolutionOutcome: null }
  const notifications = [
    { ...notices.productSyncFailure(store, 'PRODUCT_SYNC_STALE'), ...base, id: '1' },
    { ...notices.productSyncFailure(store, 'PRODUCT_SYNC_UNKNOWN'), ...base, id: '2', source: 'recovery' },
    { ...notices.productSyncFailure(store, 'PRODUCT_SYNC_UNKNOWN'), ...base, id: '3', resolvedAt: '2026-10-05T01:02:00Z', resolutionOutcome: 'succeeded' },
    { ...notices.productSyncFailure(store, 'PRODUCT_SYNC_UNKNOWN'), ...base, id: '4', resolvedAt: '2026-10-05T01:03:00Z', resolutionOutcome: 'rejected' },
  ]
  const html = renderToStaticMarkup(api.ProductSyncNotificationList({ notifications, unresolvedCount: 2 }))
  for (const text of ['商品は変更されていません', '結果確認が必要', '適用確認済み', '未適用確認済み', '今後も適用されない', '以前の失敗記録は保持', '状態確認で検出', '当時の通知:']) assert.ok(html.includes(text), text)
  assert.equal((html.match(/role="alert"/g) ?? []).length, 2)
  assert.equal((html.match(/role="status"/g) ?? []).length, 2)
})

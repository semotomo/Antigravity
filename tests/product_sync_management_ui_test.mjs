import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(new URL('../next_app/package.json', import.meta.url))
const ts = require('typescript')
const jsx = require('react/jsx-runtime')
const { renderToStaticMarkup } = require('react-dom/server')
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const icons = new Proxy({}, { get: () => () => null })
const Link = props => jsx.jsx('a', props)
const read = path => readFileSync(new URL(`../next_app/${path}`, import.meta.url), 'utf8')

function load(path, imports = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return jsx
    if (name === 'next/link') return { default: Link }
    if (name === 'lucide-react') return icons
    assert.ok(Object.hasOwn(imports, name), `Unexpected module: ${name}`)
    return imports[name]
  }, ...globals })
  return exports
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(elements)
  return tree.props ? [tree, ...elements(tree.props.children)] : []
}

test('商品一覧は同期通知を取得せず、商品一覧の店舗選択と編集フラグを維持する', async () => {
  const ProductsBoard = () => null
  const page = load('app/(dashboard)/products/page.tsx', {
    '@/components/products/ProductsBoard': { ProductsBoard },
    '@/lib/productStores': { getProductStoreId: view => view === 'main' ? 7 : null },
    '@/lib/storeAuth': { getStoreContext: async () => ({ currentView: 'main' }) },
  }, { process: { env: {} } })
  const tree = await page.default()
  const board = elements(tree).find(node => node.type === ProductsBoard)
  assert.ok(board)
  assert.equal(board.props.selectedStoreId, 7)
  assert.equal(board.props.posEditorEnabled, false)
  assert.doesNotMatch(read('app/(dashboard)/products/page.tsx'), /ProductSyncNotifications|getProductSyncNotifications/)
})

test('設定の同期管理ページは管理店舗をサーバー判定する通知コンポーネントへ渡す', async () => {
  const ProductSyncNotifications = () => null
  const page = load('app/(dashboard)/options/product-sync/page.tsx', {
    '@/components/products/ProductSyncNotifications': { ProductSyncNotifications },
  })
  const tree = await page.default()
  const management = elements(tree).find(node => node.type === ProductSyncNotifications)
  assert.ok(management)
  assert.equal(management.props.storeId, null)
})

test('システム設定から商品同期管理へ移動できる', () => {
  const options = load('components/options/OptionsBoard.tsx', {
    react: { useState: initial => [initial, () => {}] },
    '@/lib/actions/options': { createUserAction: () => assert.fail('Unexpected account write'),
      updateStoreSettingsAction: () => assert.fail('Unexpected settings write') },
  })
  const markup = renderToStaticMarkup(options.OptionsBoard({ initialStores: [] }))
  assert.match(markup, /href="\/options\/product-sync"/)
})

function management(result, enabled = false) {
  const ProductMasterSyncButton = () => jsx.jsx('button', { 'data-testid': 'sync-button' })
  const list = load('components/products/ProductSyncNotificationList.tsx')
  const api = load('components/products/ProductSyncNotifications.tsx', {
    '@/app/actions/productSyncNotifications': { getProductSyncNotifications: async () => result },
    './ProductSyncNotificationList': list,
    '@/components/sales/ProductMasterSyncButton': { ProductMasterSyncButton },
  }, { process: { env: { POS_PRODUCT_MASTER_SYNC_ENABLED: String(enabled) } } })
  return { render: () => api.ProductSyncNotifications({ storeId: null }), ProductMasterSyncButton }
}

test('管理できる店舗がない利用者には同期設定・通知・操作を表示しない', async () => {
  const f = management({ success: true, managedStoreIds: [], notifications: [], unresolvedCount: 0 })
  const markup = renderToStaticMarkup(await f.render())
  assert.doesNotMatch(markup, /data-testid="sync-button"|商品マスタ同期の通知|現在：|過去の実行記録/)
})

test('管理画面は停止設定と未解決unknownを保持し、管理店舗だけに停止中の同期ボタンを表示する', async () => {
  const notices = load('lib/product-sync/notifications.ts')
  const notice = { ...notices.productSyncFailure({ id: 7, name: '本店' }, 'PRODUCT_SYNC_UNKNOWN'),
    id: 'notice-7', source: 'manual', createdAt: '2026-10-11T02:00:00Z', resolvedAt: null, resolutionOutcome: null }
  const f = management({ success: true, managedStoreIds: [7], notifications: [notice], unresolvedCount: 1 })
  const tree = await f.render()
  const buttons = elements(tree).filter(node => node.type === f.ProductMasterSyncButton)
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props.storeId, 7)
  assert.equal(buttons[0].props.syncEnabled, false)
  const markup = renderToStaticMarkup(tree)
  assert.match(markup, /現在.*停止中/)
  assert.match(markup, /結果確認が必要/)
  assert.match(markup, /再送せず/)
  assert.doesNotMatch(markup, /適用確認済み/)
})

function buttonHarness() {
  const states = [], calls = []
  let index = 0
  const notifications = load('lib/product-sync/notifications.ts')
  const button = load('components/sales/ProductMasterSyncButton.tsx', {
    react: { useState: initial => {
      const current = index++
      if (!(current in states)) states[current] = initial
      return [states[current], value => { states[current] = typeof value === 'function' ? value(states[current]) : value }]
    } },
    'next/navigation': { useRouter: () => ({ refresh: () => calls.push(['refresh']) }) },
    '@/lib/product-sync/notifications': notifications,
  }, { fetch: async (url, options) => {
    calls.push(['fetch', url, options.method])
    return { ok: false, status: 502, json: async () => ({ success: false, message: '結果確認が必要です。',
      results: [{ storeId: 7, success: false, code: 'PRODUCT_SYNC_UNKNOWN' }] }) }
  } })
  return { calls, render: props => { index = 0; return button.ProductMasterSyncButton(props) } }
}

test('同期停止中はボタンが無効になり、handlerを直接呼んでも送信しない', async () => {
  const f = buttonHarness()
  const tree = f.render({ syncEnabled: false, storeId: 7 })
  const button = elements(tree).find(node => node.type === 'button')
  assert.equal(button.props.disabled, true)
  await button.props.onClick()
  assert.equal(f.calls.length, 0)
})

test('店舗指定の同期はその店舗だけを要求し、結果不明の確認リンクは設定の管理画面へ向く', async () => {
  for (const storeId of [6, 7]) {
    const f = buttonHarness()
    const props = { syncEnabled: true, storeId }
    const button = elements(f.render(props)).find(node => node.type === 'button')
    assert.equal(button.props.disabled, false)
    await button.props.onClick()
    const request = f.calls.find(call => call[0] === 'fetch')
    assert.ok(request)
    const url = new URL(request[1], 'http://localhost')
    assert.equal(url.pathname, '/api/gas/sync-products')
    assert.equal(url.searchParams.get('store'), String(storeId))
    assert.equal(request[2], 'POST')
    const link = elements(f.render(props)).find(node => node.type === Link)
    assert.ok(link)
    assert.equal(link.props.href, '/options/product-sync')
  }
})

function readFixture(access) {
  const calls = []
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const notices = load('lib/product-sync/notifications.ts')
  function query(table) {
    assert.ok(['user_store_access', 'product_master_sync_notifications'].includes(table), table)
    calls.push(['table', table])
    let roles = null, stores = null, resolved = false
    const q = {
      select: () => q, order: () => q, limit: () => q, neq: () => q, is: () => q,
      eq: (field, value) => { if (field === 'role') roles = [value]; return q },
      in: (field, values) => {
        if (field === 'role') roles = values
        if (field === 'store_id') { stores = values; calls.push(['stores', plain(values)]) }
        return q
      },
      not: () => { resolved = true; return q },
      then: (resolve, reject) => {
        const data = table === 'user_store_access'
          ? access.filter(row => (!roles || roles.includes(row.role)) && (!stores || stores.includes(row.store_id)))
          : []
        return Promise.resolve({ data, count: resolved ? undefined : data.length, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  const api = load('lib/product-sync/notifications.server.ts', {
    'server-only': {}, './notifications': notices,
    '@/lib/supabase/server': { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) }, from: query,
    }) },
    '@supabase/supabase-js': { createClient: () => {
      calls.push(['service'])
      return { rpc: async (name, args) => {
        calls.push(['rpc', name, plain(args)])
        return { data: { blocked: true }, error: null }
      } }
    } },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } } })
  return { api, calls }
}

test('通知DALはstaff/viewerを管理店舗にせず、店舗権限がなければ通知query/RPCへ進まない', async () => {
  for (const role of ['staff', 'viewer']) {
    for (const storeId of [null, 7]) {
      const f = readFixture([{ store_id: 7, role }])
      if (storeId === null) {
        const result = await f.api.readProductSyncNotifications(null)
        assert.deepEqual(plain(result.managedStoreIds), [])
        assert.deepEqual(plain(result.notifications), [])
      } else await assert.rejects(() => f.api.readProductSyncNotifications(storeId))
      assert.equal(f.calls.some(call => call[0] === 'service' || call[0] === 'rpc' || call[1] === 'product_master_sync_notifications'), false)
    }
  }
})

test('全店舗の通知DALもmanager店舗だけへ絞り、viewer店舗の状態照合を行わない', async () => {
  const f = readFixture([{ store_id: 7, role: 'manager' }, { store_id: 6, role: 'viewer' }])
  const result = await f.api.readProductSyncNotifications(null)
  assert.deepEqual(plain(result.managedStoreIds), [7])
  assert.deepEqual(f.calls.filter(call => call[0] === 'rpc').map(call => call[2].p_store_id), [7])
  const noticeQueries = f.calls.filter(call => call[0] === 'stores').slice(1)
  assert.equal(noticeQueries.length, 2)
  assert.ok(noticeQueries.every(call => JSON.stringify(call[1]) === '[7]'))
  const other = readFixture([{ store_id: 7, role: 'manager' }, { store_id: 6, role: 'viewer' }])
  await assert.rejects(() => other.api.readProductSyncNotifications(6))
  assert.equal(other.calls.some(call => call[0] === 'service' || call[0] === 'rpc' || call[1] === 'product_master_sync_notifications'), false)
})

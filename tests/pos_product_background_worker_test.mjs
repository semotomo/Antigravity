import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { form, input, jan, prefix } from './fixtures/pos_product_form_fixture.mjs'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const endpoint = 'https://kennel-dashboard.vercel.app/api/pos-products/background-worker'
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const leaseToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const secret = '1'.repeat(64)
const plain = value => JSON.parse(JSON.stringify(value))
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
const hmac = value => createHmac('sha256', secret).update(canonical(value)).digest('hex')
const simple = (id, fields) => `<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">${Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${id === 'hmma00000Form' ? '' : 'includeChildBody:'}${id}:${key}" value="${value}">`).join('')}</form>`
const list = n => `${n}件中` + simple('hmma02400Form', { schOfficeCd: '', schTenpoGroupNoSingle: '', schGoodsId: '', schMakerCd: '', schGoodsName: '', doSerchNormal: '', 'goodsItems:0:doHmma02402': '', doDelete: '' })
const searchPages = (html, second = html) => [list(0), list(1), simple('hmma02402Form', { doHmma02403: '' }), html, list(0), list(1), simple('hmma02402Form', { doHmma02403: '' }), second]
const opaque = { 'thumbnailImageUrl-30': '', 'imageFileCnt-30': 'synthetic-private-count+/=&', delImageFileUrl: '', goodsImageItemsSave: 'synthetic-private-items+/=&' }
function imageForm(store, overrides = {}) {
  return form(store, overrides).replace(input('imageFileName', '既存画像.png', 'hidden'), Object.entries(opaque).map(([key, value]) => input(key, value, 'hidden')).join(''))
    .replace('method="post"', 'method="post" enctype="multipart/form-data"').replace('</form>', input('uploadThumbnailFile', '', 'file') + '</form>')
}

function setup(options = {}) {
  const store = options.store ?? 6, before = options.before ?? imageForm(store), after = options.after ?? imageForm(store, { name: '変更後商品' })
  const pages = [simple('hmma00000Form', { loginId: '', password: '', doLogin: '' }), 'portal', ...searchPages(before, options.beforeSecond), ...searchPages(after)]
  const calls = [], messages = [], logs = []
  let tick = 1_800_000_000_000, uuidCount = 0, saveCount = 0, consumeCount = 0, releases = 0
  const properties = new Map(Object.entries({ POS_PRODUCT_BACKGROUND_EDIT_ENABLED: 'true', POS_PRODUCT_BACKGROUND_NEXT_STORE: String(store),
    POS_PRODUCT_INSPECTION_ENABLED: 'true', POS_PRODUCT_EDIT_EXECUTION_ENABLED: 'true', POS_PRODUCT_CONSUME_ENABLED: 'true',
    POS_PRODUCT_CONSUME_URL: 'https://kennel-dashboard.vercel.app/api/pos-products/consume', POS_PRODUCT_CONSUME_SECRET: secret, ...options.properties }))
  const intake = { operation_id: operationId, actor_id: actorId, store_id: store, product_id: 123, jan_code: jan,
    patch: { name: '変更後商品' }, baseline: { product_name: '既存商品', category: '', product_group: 'group', selling_price: 126, cost_price: 75, supplier_name: '' },
    lease_token: leaseToken, status: 'working', ...options.intake }
  const signed = (request, data) => {
    const reply = { version: 1, audience: 'kennel.pos-product-background-worker-response.v1', requestId: request.requestId,
      action: request.action, storeId: request.storeId, success: true, data }
    options.mutateResponse?.(reply, request)
    reply.signature = hmac(reply)
    if (options.badSignature === request.action) reply.signature = '0'.repeat(64)
    return reply
  }
  const response = body => ({ getResponseCode: () => 200, getHeaders: () => ({ 'Content-Type': 'application/json' }), getContentText: () => JSON.stringify(body) })
  const context = vm.createContext({ Date: { now: () => ++tick }, Logger: { log: value => logs.push(String(value)) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      newBlob: text => ({ getBytes: () => Buffer.from(text, 'utf8') }),
      getUuid: () => `dddddddd-dddd-4ddd-8ddd-${String(++uuidCount).padStart(12, '0')}`,
      computeDigest: (_, text) => [...createHash('sha256').update(text).digest()],
      computeHmacSha256Signature: (text, key) => [...createHmac('sha256', key).update(text).digest()] },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) ?? null, setProperty: (key, value) => properties.set(key, value) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => options.busy !== true, releaseLock: () => releases++ }) },
    UrlFetchApp: { fetch: (url, request) => {
      calls.push({ url, request })
      if (url === endpoint) {
        const envelope = JSON.parse(request.payload), signature = envelope.signature
        delete envelope.signature
        assert.equal(signature, hmac(envelope)); assert.equal(envelope.audience, 'kennel.pos-product-background-worker.v1')
        assert.match(envelope.requestId, /^[\da-f-]{36}$/); assert.equal(envelope.expiresAt - envelope.issuedAt, 60000)
        messages.push(envelope)
        if (options.redirect === envelope.action) return { getResponseCode: () => 302, getHeaders: () => ({ Location: 'https://evil.test/' }) }
        if (options.throwCallback === envelope.action) throw Error('synthetic-private-callback-failure')
        let data
        if (envelope.action === 'claim') {
          data = envelope.storeId !== store ? { intake: null, operation: null, claimed: false }
            : { intake, operation: options.existingOperation ?? (consumeCount ? { id: operationId, actor_id: actorId, store_id: store, jan_code: jan, product_id_snapshot: 123, send_attempts: 1, status: 'uncertain' } : null), claimed: true }
        } else if (envelope.action === 'prepare') {
          options.afterPrepare?.(properties)
          const inspection = envelope.payload.inspection
          const patch = {}, fieldMap = { name: 'goodsName', price: 'gddGoodsPrice', cost: 'gddGoodsCost' }
          for (const [key, value] of Object.entries(intake.patch)) {
            if (value !== inspection.searches[1].formInspection.fields[key]) patch[fieldMap[key]] = value
          }
          const dispatch = { operationId, actorId, storeId: store, janCode: jan, before: inspection.searches[1].formInspection,
            patch, expiresAt: tick + 120000 }
          options.mutateDispatch?.(dispatch)
          data = { operationId, actorId, storeId: store, dispatch: options.review ? null : dispatch, nextAction: options.review ? 'review' : 'save' }
        } else if (envelope.action === 'recover') data = { operationId, storeId: store, status: options.recoverStatus ?? 'completed' }
        else data = { operationId, storeId: store, status: envelope.action === 'result' && envelope.payload.result.outcome === 'values_verified' ? 'completed' : 'needs_review' }
        options.mutateData?.(data, envelope)
        if (options.slowCallback === envelope.action) tick += 60001
        options.afterCallback?.(properties, envelope)
        return response(signed(envelope, data))
      }
      if (url.endsWith('/api/pos-products/consume')) {
        consumeCount++
        const command = JSON.parse(request.payload), receipt = { operationId: command.operationId, actorId: command.actorId, storeId: command.storeId, dispatchHash: command.dispatchHash, accepted: options.consumeAccepted !== false }
        options.onConsume?.(properties)
        const reply = { version: 1, requestSignature: command.signature, receipt,
          signature: createHmac('sha256', secret).update(JSON.stringify([1, 'kennel.pos-product-consume-response.v1', command.signature, receipt.operationId, receipt.actorId, receipt.storeId, receipt.dispatchHash, receipt.accepted])).digest('hex') }
        return response(reply)
      }
      assert.match(url, /^https:\/\/cg8\.power-k\.jp\//)
      if (typeof request.payload === 'string') {
        saveCount++
        if (options.saveThrows) throw Error('synthetic-private-save-disconnected')
        return { getResponseCode: () => 303, getHeaders: () => ({ Location: '/hm-hmma/view/hmma/hmma024/hmma02400.html' }), getAllHeaders: () => ({ 'Set-Cookie': 'synthetic-private=session; Path=/' }) }
      }
      if (saveCount === 0) tick += options.slowReadMs ?? 0
      options.onPosRead?.(properties, calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length)
      const html = pages.shift()
      if (html === undefined) throw Error('synthetic-private-extra-read')
      return { getResponseCode: () => 200, getHeaders: () => ({}), getContentText: () => html, getAllHeaders: () => ({ 'Set-Cookie': 'synthetic-private=session; Path=/' }) }
    } } })
  vm.runInContext(['gas/autoDownload.js', 'gas/posProductReadDiagnostic.js', 'gas/posProductForm.js', 'gas/posProductSubmission.js',
    'gas/posProductProtocol.js', 'gas/posProductEditGateway.js', 'gas/posProductEditExecution.js', 'gas/posProductBackgroundWorker.js'].map(read).join('\n'), context)
  context.getPOSConfig_ = () => ({ baseUrl: 'https://cg8.power-k.jp/0D890OGI', loginId: 'synthetic-private-user', password: 'synthetic-private-password' })
  return { context, calls, messages, logs, properties, run: () => plain(context.runPosProductBackgroundWorker()),
    get saveCount() { return saveCount }, get consumeCount() { return consumeCount }, get releases() { return releases } }
}

test('worker OFF/読取りOFF/保存OFF/consume OFF/lockbusyは外部接続しない', () => {
  for (const options of [{ properties: { POS_PRODUCT_BACKGROUND_EDIT_ENABLED: null } }, { properties: { POS_PRODUCT_INSPECTION_ENABLED: null } },
    { properties: { POS_PRODUCT_EDIT_EXECUTION_ENABLED: null } }, { properties: { POS_PRODUCT_CONSUME_ENABLED: null } }, { busy: true }]) {
    const f = setup(options); assert.equal(f.run().processed, false); assert.equal(f.calls.length, 0)
  }
})

test('両店舗で遅い初回照合後に期限を作り、保持フォームからconsume→保存一回→新規両検索する', async () => {
  for (const store of [6, 7]) {
    const f = setup({ store, slowReadMs: 18000 }), result = f.run()
    assert.deepEqual(result, { processed: true, code: 'COMPLETED' }); assert.equal(f.saveCount, 1); assert.equal(f.consumeCount, 1); assert.equal(f.releases, 1)
    assert.equal(f.calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length, 19)
    assert.deepEqual(f.messages.map(message => message.action), ['claim', 'prepare', 'result'])
    assert.equal(new Set(f.messages.map(message => message.requestId)).size, 3)
    const prepared = f.messages.find(message => message.action === 'prepare')
    assert.equal(prepared.payload.inspection.storeId, store); assert.equal(prepared.payload.leaseToken, leaseToken)
    const saved = f.calls.find(call => call.url.startsWith('https://cg8.power-k.jp') && typeof call.request.payload === 'string')
    const body = await new Response(saved.request.payload, { headers: { 'Content-Type': saved.request.contentType } }).formData()
    for (const [key, value] of Object.entries(opaque)) assert.equal(body.get(prefix + key), value)
    assert.equal(body.get(prefix + 'goodsName'), '変更後商品'); assert.equal(body.get(prefix + 'gddGoodsCost'), '75')
    assert.doesNotMatch(JSON.stringify(f.messages), /synthetic-private|Cookie|imageState|imageFileCnt|goodsImageItemsSave|payload.*loginId/)
    assert.doesNotMatch(f.logs.join('\n'), /synthetic-private/)
  }
})

test('空店舗は次店舗を確認し、実受付は最大一件だけ処理する', () => {
  const f = setup({ store: 7, properties: { POS_PRODUCT_BACKGROUND_NEXT_STORE: '6' } })
  assert.equal(f.run().code, 'COMPLETED'); assert.deepEqual(f.messages.filter(message => message.action === 'claim').map(message => message.storeId), [6, 7]); assert.equal(f.saveCount, 1)
})

test('同じ値の入力項目を保存patchへ入れず、変更した原価だけを保存する', async () => {
  const f = setup({ intake: { patch: { price: '126', cost: '80' } }, after: imageForm(6).replace(input('gddGoodsCost', '75'), input('gddGoodsCost', '80')) })
  assert.equal(f.run().code, 'COMPLETED'); assert.equal(f.saveCount, 1)
  const saved = f.calls.find(call => call.url.startsWith('https://cg8.power-k.jp') && typeof call.request.payload === 'string')
  const body = await new Response(saved.request.payload, { headers: { 'Content-Type': saved.request.contentType } }).formData()
  assert.equal(body.get(prefix + 'gddGoodsPrice'), '126'); assert.equal(body.get(prefix + 'gddGoodsCost'), '80')
})

test('署名/相関/HTTP転送/期限/鍵変更/未知bodyを拒否しPOSへ接続しない', () => {
  const cases = [{ badSignature: 'claim' }, { redirect: 'claim' }, { slowCallback: 'claim' },
    { afterCallback: (properties, envelope) => { if (envelope.action === 'claim') properties.set('POS_PRODUCT_CONSUME_SECRET', '2'.repeat(64)) } },
    ...[reply => { reply.requestId = operationId }, reply => { reply.action = 'prepare' }, reply => { reply.storeId = 7 },
      reply => { reply.extra = 'synthetic-private' }, reply => { reply.success = false; reply.data = null }].map(mutateResponse => ({ mutateResponse }))]
  for (const options of cases) {
    const f = setup(options); assert.equal(f.run().code, 'WORKER_RESPONSE_FAILED'); assert.equal(f.saveCount, 0)
    assert.equal(f.calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length, 0)
    assert.ok(f.calls.every(call => call.url === endpoint && call.request.followRedirects === false))
  }
  const f = setup(), port = f.context.createPosProductBackgroundPort_({ getProperty: name => f.properties.get(name) }, () => {})
  assert.throws(() => port('claim', 6, { value: 'x'.repeat(524288) })); assert.equal(f.calls.length, 0)
})

test('店舗/JAN/lease/immutable対象不一致とsend1を保存前に停止する', () => {
  for (const options of [{ intake: { store_id: 7 } }, { intake: { jan_code: 'bad' } }, { intake: { lease_token: 'bad' } },
    { existingOperation: { id: operationId, actor_id: actorId, store_id: 6, jan_code: jan, product_id_snapshot: 123, send_attempts: 1 } },
    { existingOperation: { id: actorId, actor_id: actorId, store_id: 6, jan_code: jan, product_id_snapshot: 123, send_attempts: 0 } }]) {
    const f = setup(options); assert.notEqual(f.run().code, 'COMPLETED'); assert.equal(f.saveCount, 0); assert.equal(f.consumeCount, 0)
    assert.equal(f.calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length, 0)
  }
})

test('既存send1はfresh読取りと署名recoverだけ行い、保存/consume/prepareを一度も呼ばない', () => {
  for (const status of ['dispatching', 'verifying', 'uncertain', 'pos_confirmed', 'db_pending']) {
    const f = setup({ before: imageForm(6, { name: '変更後商品' }), existingOperation: {
      id: operationId, actor_id: actorId, store_id: 6, jan_code: jan, product_id_snapshot: 123, send_attempts: 1, status,
    } })
    assert.deepEqual(f.run(), { processed: true, code: 'COMPLETED' })
    assert.equal(f.saveCount, 0); assert.equal(f.consumeCount, 0)
    assert.deepEqual(f.messages.map(message => message.action), ['claim', 'recover'])
    assert.equal(f.calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length, 10)
    const recovered = f.messages.at(-1)
    assert.equal(recovered.payload.operationId, operationId); assert.equal(recovered.payload.leaseToken, leaseToken)
    assert.equal(recovered.payload.inspection.searches[1].formInspection.fields.name, '変更後商品')
    assert.doesNotMatch(JSON.stringify(recovered.payload), /synthetic-private|Cookie|imageState|imageFileCnt|goodsImageItemsSave|baseline/)
  }
})

test('send1読取り/通知失敗・別job receiptは結果不明のまま保存0回、要確認の希望入力を保持する', () => {
  const existingOperation = { id: operationId, actor_id: actorId, store_id: 6, jan_code: jan, product_id_snapshot: 123, send_attempts: 1, status: 'uncertain' }
  for (const options of [{ before: imageForm(7) }, { badSignature: 'recover' }, { throwCallback: 'recover' },
    { mutateData: (data, request) => { if (request.action === 'recover') data.operationId = actorId } }]) {
    const f = setup({ existingOperation, ...options })
    assert.equal(f.run().code, 'REVIEW_REQUIRED'); assert.equal(f.saveCount, 0); assert.equal(f.consumeCount, 0)
    assert.equal(f.messages.at(-1).action, 'fail'); assert.equal(f.messages.at(-1).payload.code, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN')
    assert.ok(!f.messages.some(message => message.action === 'prepare'))
  }
  const needsReview = setup({ existingOperation, recoverStatus: 'needs_review' })
  assert.equal(needsReview.run().code, 'REVIEW_REQUIRED'); assert.equal(needsReview.saveCount, 0)
  assert.equal(needsReview.messages.at(-1).action, 'recover')
})

test('新鮮なPOSの店舗/JAN/画像状態不一致は入力を保持して固定readfailureを送る', () => {
  for (const before of [imageForm(7), imageForm(6).replaceAll(jan, '4901234567890'), imageForm(6).replace(input('imageFileCnt-30', opaque['imageFileCnt-30'], 'hidden'), '')]) {
    const f = setup({ before }); assert.equal(f.run().code, 'POS_READ_FAILED'); assert.equal(f.saveCount, 0)
    assert.equal(f.messages.at(-1).action, 'fail'); assert.equal(f.messages.at(-1).payload.code, 'POS_READ_FAILED')
  }
})

test('prepareの対象/patch/baseline差替え、署名不良、reviewはconsumeも保存もしない', () => {
  for (const options of [{ badSignature: 'prepare' }, { review: true }, ...[
    dispatch => { dispatch.storeId = 7 }, dispatch => { dispatch.janCode = '4901234567890' }, dispatch => { dispatch.actorId = operationId },
    dispatch => { dispatch.patch.gddGoodsCost = '999' }, dispatch => { dispatch.before.fields.name = '差し替え' },
  ].map(mutateDispatch => ({ mutateDispatch }))]) {
    const f = setup(options); assert.notEqual(f.run().code, 'COMPLETED'); assert.equal(f.saveCount, 0); assert.equal(f.consumeCount, 0)
  }
})

test('consume拒否/consume中停止/prepare後運用停止は保存POST0回', () => {
  for (const options of [{ consumeAccepted: false }, { onConsume: properties => properties.set('POS_PRODUCT_BACKGROUND_EDIT_ENABLED', null) },
    { afterPrepare: properties => properties.set('POS_PRODUCT_EDIT_EXECUTION_ENABLED', null) }]) {
    const f = setup(options); assert.notEqual(f.run().code, 'COMPLETED'); assert.equal(f.saveCount, 0)
  }
})

test('初回照合の上限到達/読取り中停止/保存後画像差分は再保存を許さない', () => {
  const exhausted = setup({ slowReadMs: 40000 }); assert.equal(exhausted.run().code, 'POS_READ_FAILED'); assert.equal(exhausted.saveCount, 0)
  assert.equal(exhausted.calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length, 8)
  const stopped = setup({ onPosRead: (properties, count) => { if (count === 3) properties.set('POS_PRODUCT_INSPECTION_ENABLED', null) } })
  assert.equal(stopped.run().code, 'POS_READ_FAILED'); assert.equal(stopped.saveCount, 0)
  assert.equal(stopped.calls.filter(call => call.url.startsWith('https://cg8.power-k.jp')).length, 3)
  const changed = setup({ after: imageForm(6, { name: '変更後商品' }).replace(opaque.goodsImageItemsSave, 'synthetic-private-changed-image') })
  assert.equal(changed.run().code, 'REVIEW_REQUIRED'); assert.equal(changed.saveCount, 1)
  assert.equal(changed.messages.at(-1).payload.result.outcome, 'verification_required')
})

test('保存切断は再送せず読取り確認し、result応答消失後の再claim send1は再保存しない', () => {
  const disconnected = setup({ saveThrows: true }); assert.equal(disconnected.run().code, 'COMPLETED'); assert.equal(disconnected.saveCount, 1)
  const f = setup({ throwCallback: 'result' }); assert.equal(f.run().code, 'WORKER_RESPONSE_FAILED'); assert.equal(f.saveCount, 1)
  assert.equal(f.messages.at(-1).payload.code, 'WORKER_RESPONSE_FAILED'); assert.equal(f.run().code, 'REVIEW_REQUIRED'); assert.equal(f.saveCount, 1)
  assert.equal(f.messages.at(-1).payload.code, 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN')
})

test('result/failの署名済みreceiptも店舗/操作/statusを束縛し、別jobの成功を採用しない', () => {
  for (const change of [data => { data.operationId = actorId }, data => { data.storeId = 7 },
    data => { data.status = 'pos_confirmed' }, data => { data.extra = 'synthetic-private' }]) {
    const f = setup({ mutateData: (data, request) => { if (request.action === 'result') change(data) } })
    assert.equal(f.run().code, 'WORKER_RESPONSE_FAILED'); assert.equal(f.saveCount, 1)
    assert.equal(f.messages.at(-1).action, 'fail'); assert.equal(f.messages.at(-1).payload.code, 'WORKER_RESPONSE_FAILED')
  }
})

test('workerはトリガー/公開入口を作成せず固定URLへ接続する', () => {
  const source = read('gas/posProductBackgroundWorker.js')
  assert.doesNotMatch(source, /ScriptApp|newTrigger|function\s+(?:doGet|doPost|onOpen|onEdit)\b|Logger\.|console\./)
  assert.equal((read('gas/posProductEditExecution.js').match(/UrlFetchApp\.fetch\(url\(prepared\.url\)/g) ?? []).length, 1)
})

test('実Node worker protocolがGAS要求を検証し、Node応答をGASが全actionで受理する', () => {
  const require = createRequire(new URL('../next_app/package.json', import.meta.url)), ts = require('typescript')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read('next_app/lib/pos-products/background-worker-protocol.server.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Buffer, require: name => name === 'server-only' ? {} : { createHmac, timingSafeEqual } })
  const protocol = module.exports, f = setup(), ids = new Set()
  f.context.UrlFetchApp.fetch = (url, options) => {
    assert.equal(url, endpoint); assert.equal(options.followRedirects, false)
    const request = JSON.parse(options.payload)
    const verified = protocol.verifyBackgroundWorkerRequest(options.payload, secret, request.issuedAt + 1)
    assert.equal(verified.action, request.action); ids.add(request.requestId)
    const result = protocol.signBackgroundWorkerResponse(verified, true, { operationId, storeId: 6, status: 'needs_review' }, secret)
    return { getResponseCode: () => 200, getHeaders: () => ({ 'Content-Type': 'application/json' }), getContentText: () => JSON.stringify(result) }
  }
  const port = f.context.createPosProductBackgroundPort_({ getProperty: name => f.properties.get(name) }, () => {})
  for (const action of ['claim', 'prepare', 'result', 'fail', 'recover']) {
    assert.deepEqual(plain(port(action, 6, { operationId, leaseToken })), { operationId, storeId: 6, status: 'needs_review' })
  }
  assert.equal(ids.size, 5)
})

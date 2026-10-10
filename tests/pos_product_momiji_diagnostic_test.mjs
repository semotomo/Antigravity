import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { form, input, jan as fixtureJan, prefix } from './fixtures/pos_product_form_fixture.mjs'

const jan = '4582107173062'
const source = name => readFileSync(new URL('../gas/' + name, import.meta.url), 'utf8')
const edit = () => form(7, { name: '95ミツヤ もみじ焼き' })
  .replaceAll(fixtureJan, jan).replace('value="126"', 'value="199"').replace('value="75"', 'value="95"')
const shell = (id, fields) => `<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">${Object.entries(fields).map(([key,value]) => `<input name="${id === 'hmma00000Form' ? '' : 'includeChildBody:'}${id}:${key}" value="${value}" type="hidden">`).join('')}</form>`
const list = count => `${count}件中` + shell('hmma02400Form', {
  schOfficeCd: '', schTenpoGroupNoSingle: '', schGoodsId: '', schMakerCd: '', schGoodsName: '',
  doSerchNormal: '', doDelete: '', 'goodsItems:0:doHmma02402': '', state: 'synthetic-private-state',
})
// 実DOMの項目名だけを反映した合成状態。実際のserialized値やHTMLは保存しない。
const emptyThumbnailEdit = (items = 'synthetic-private-image-items-state') => edit()
  .replace(input('imageFileName', '既存画像.png', 'hidden'),
    input('thumbnailImageUrl-30', '', 'hidden') + input('imageFileCnt-30', 'synthetic-private-image-count-state', 'hidden') +
    input('delImageFileUrl', '', 'hidden') + input('goodsImageItemsSave', items, 'hidden'))
  .replace('method="post"', 'method="post" enctype="multipart/form-data"')
  .replace('</form>', input('uploadThumbnailFile', '', 'file') + '</form>')
function fixture(options = {}) {
  const calls = [], logs = [], builds = []
  let pages = [shell('hmma00000Form', { loginId: '', password: '', doLogin: '' }), 'portal',
    list(0), list(options.count ?? 1), shell('hmma02402Form', { doHmma02403: '' }), options.first ?? edit(),
    list(0), list(1), shell('hmma02402Form', { doHmma02403: '' }), options.second ?? edit()]
  const context = vm.createContext({
    Logger: { log: value => logs.push(value) },
    UrlFetchApp: { fetch: (url, request) => {
      calls.push({ url, request })
      if (options.networkError) throw Error(options.networkError)
      const text = pages.shift()
      if (text === undefined) throw Error('unexpected synthetic request')
      return { getResponseCode: () => 200, getContentText: () => text, getHeaders: () => ({}), getAllHeaders: () => ({}) }
    } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...createHash('sha256').update(value).digest()],
      getUuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', newBlob: value => ({ getBytes: () => Buffer.from(value) }) },
  })
  for (const name of ['autoDownload.js', 'posProductReadDiagnostic.js', 'posProductForm.js', 'posProductSubmission.js', 'posProductMomijiDiagnostic.js']) vm.runInContext(source(name), context)
  context.getPOSConfig_ = () => ({ baseUrl: 'https://cg8.power-k.jp/0D890OGI', loginId: 'synthetic-user', password: 'synthetic-private-password' })
  const original = context.buildPosProductEditSubmission_
  context.buildPosProductEditSubmission_ = (...args) => {
    if (options.buildError) throw Error(options.buildError)
    const result = original(...args)
    builds.push({ args, result })
    return result
  }
  return { context, calls, logs, builds, run: (...args) => JSON.parse(JSON.stringify(context.diagnoseHontenMomijiEditPreparation(...args))) }
}

test('実DOM名4項目の合成画像なし状態を2検索で保持し、保存せずmultipartを組み立てる', async () => {
  const html = emptyThumbnailEdit(), f = fixture({ first: html, second: html }), result = f.run()
  assert.equal(result.success, true)
  assert.equal(result.code, 'MOMIJI_EDIT_PREPARATION_INSPECTED')
  assert.equal(result.completedSearches, 2)
  assert.equal(result.preparedCount, 1)
  assert.equal(result.imageValuesMatch, true)
  assert.equal(result.productSaveSent, false)
  assert.equal(result.consumeCalled, false)
  assert.equal(result.heldOperationVerified, false)
  for (const counts of result.forms) {
    assert.equal(counts.imageControlCount, 4)
    assert.equal(counts.imageEntryCount, 4)
    assert.equal(counts.imageTypeIsHidden, true)
    assert.equal(counts.imageValueMatches, true)
    assert.equal(counts.imageContract, 'thumbnail-empty-v1')
    assert.equal(counts.emptyFilePartCount, 1)
  }
  assert.equal(f.calls.length, 10)
  assert.equal(f.builds.length, 1)
  const prepared = f.builds[0].result
  const body = await new Response(prepared.payload, { headers: { 'Content-Type': prepared.contentType } }).formData()
  for (const [key, value] of Object.entries({ 'thumbnailImageUrl-30': '', 'imageFileCnt-30': 'synthetic-private-image-count-state',
    delImageFileUrl: '', goodsImageItemsSave: 'synthetic-private-image-items-state' })) assert.equal(body.get(prefix + key), value)
  assert.equal(body.get(prefix + 'uploadThumbnailFile').size, 0)
  assert.equal(body.get(prefix + 'uploadThumbnailFile').name, '')
  assert.equal(body.get(prefix + 'imageFileName'), null)
  assert.ok(f.calls.every(({ request }) => !Object.keys(request.payload ?? {}).some(key => /:(?:doUpdate|doDelete)$/.test(key))))
  assert.doesNotMatch(f.logs.join('\n') + JSON.stringify(result), /synthetic-private|Content-Disposition|goodsImageItemsSave|thumbnailImageUrl/)
})

test('実DOM名のopaque画像状態差や削除指定は読取り診断でも組立前に停止する', () => {
  for (const [second, phase, code] of [
    [emptyThumbnailEdit('synthetic-private-next-image-state'), 'IMAGE_COMPARE', 'MOMIJI_IMAGE_COMPARE_REJECTED'],
    [emptyThumbnailEdit().replace(input('delImageFileUrl', '', 'hidden'), input('delImageFileUrl', 'synthetic-private-delete', 'hidden')),
      'IMAGE_GUARD', 'MOMIJI_IMAGE_GUARD_REJECTED'],
  ]) {
    const f = fixture({ first: emptyThumbnailEdit(), second }), result = f.run()
    assert.equal(result.success, false)
    assert.equal(result.phase, phase)
    assert.equal(result.code, code)
    assert.equal(f.builds.length, 0)
    assert.equal(result.productSaveSent, false)
    assert.equal(result.consumeCalled, false)
    assert.doesNotMatch(f.logs.join('\n') + JSON.stringify(result), /synthetic-private|goodsImageItemsSave|thumbnailImageUrl/)
  }
})

test('固定本店/JANを2検索し指定3項目を1回組み立てるだけで保存しない', () => {
  const f = fixture(), result = f.run()
  assert.equal(result.success, true)
  assert.equal(result.code, 'MOMIJI_EDIT_PREPARATION_INSPECTED')
  assert.equal(result.storeId, 7)
  assert.equal(result.janCode, jan)
  assert.equal(result.completedSearches, 2)
  assert.equal(result.preparedCount, 1)
  assert.equal(result.baselineMatchesApproved, true)
  assert.equal(result.productSaveSent, false)
  assert.equal(result.consumeCalled, false)
  assert.equal(result.heldOperationVerified, false)
  assert.equal(result.imageValuesMatch, true)
  assert.equal(result.identicalInspections, true)
  assert.equal(f.calls.length, 10)
  assert.equal(f.builds.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.builds[0].args[4])), { goodsName: 'ミツヤ もみじ焼き', gddGoodsPrice: '200', gddGoodsCost: '100' })
  const body = new URLSearchParams(f.builds[0].result.payload)
  for (const [key, value] of [['goodsName', 'ミツヤ もみじ焼き'], ['gddGoodsPrice', '200'], ['gddGoodsCost', '100']]) assert.equal(body.get(prefix + key), value)
  for (const { request } of f.calls) {
    assert.ok(!Object.keys(request.payload ?? {}).some(key => /:(?:doUpdate|doDelete)$/.test(key)))
    const filters = request.payload
    if (filters?.['includeChildBody:hmma02400Form:doSerchNormal'] !== undefined) {
      assert.equal(filters['includeChildBody:hmma02400Form:schOfficeCd'], '11053')
      assert.equal(filters['includeChildBody:hmma02400Form:schTenpoGroupNoSingle'], '11098')
      assert.ok(['schGoodsId', 'schMakerCd'].some(key => filters['includeChildBody:hmma02400Form:' + key] === jan))
    }
  }
  assert.equal(result.forms[0].frameworkState.conditions.preparedEntryCount, 1)
  assert.ok(result.phases.every(value => /^[A-Z_]+$/.test(value.phase) && value.elapsedMs >= 0))
  assert.doesNotMatch(f.logs.join('\n') + JSON.stringify(result), /synthetic-private|fixture-id|既存画像|<form|gdsPublicGoodsCd.*458/)
})

test('引数から別商品を指定できず、通信前に停止する', () => {
  const f = fixture(), result = f.run(6, '4902397868767')
  assert.equal(result.success, false)
  assert.equal(result.code, 'MOMIJI_DIAGNOSTIC_ARGUMENTS_REJECTED')
  assert.equal(f.calls.length, 0)
})

test('両検索の店舗/JAN/候補数不一致は保存組立へ進めない', () => {
  for (const options of [{ first: edit().replaceAll('11098', '11099') }, { first: edit().replaceAll(jan, fixtureJan) }, { count: 2 }]) {
    const f = fixture(options), result = f.run()
    assert.equal(result.success, false)
    assert.equal(f.builds.length, 0)
    assert.equal(result.productSaveSent, false)
  }
})

test('画像hiddenの欠落/型変更/disabledを専用工程で拒否し値は出さない', () => {
  for (const first of [edit().replace(/<input[^>]*name="[^"]*:imageFileName"[^>]*>/, ''),
    edit().replace(`name="${prefix}imageFileName" value="既存画像.png"`, `name="${prefix}imageFileName" value="synthetic-private-image" disabled`),
    edit().replace(`type="hidden" name="${prefix}imageFileName"`, `type="text" name="${prefix}imageFileName"`)]) {
    const f = fixture({ first }), result = f.run()
    assert.equal(result.success, false)
    assert.equal(result.phase, 'IMAGE_GUARD')
    assert.equal(result.code, 'MOMIJI_IMAGE_GUARD_REJECTED')
    assert.equal(f.builds.length, 0)
    assert.doesNotMatch(f.logs.join('\n'), /synthetic-private-image|既存画像/)
  }
})

test('両検索で画像/業務値が変化した場合は組立を停止する', () => {
  for (const [second, phase] of [[edit().replace('既存画像.png', 'synthetic-private-image'), 'IMAGE_COMPARE'],
    [edit().replace('value="199"', 'value="198"'), 'INSPECTION_COMPARE']]) {
    const f = fixture({ second }), result = f.run()
    assert.equal(result.success, false)
    assert.equal(result.phase, phase)
    assert.equal(f.builds.length, 0)
  }
})

test('承認時の名前/金額が変わっていれば新しい値を送信準備しない', () => {
  const changed = edit().replace('value="199"', 'value="198"')
  const f = fixture({ first: changed, second: changed }), result = f.run()
  assert.equal(result.success, false)
  assert.equal(result.baselineMatchesApproved, false)
  assert.equal(result.code, 'MOMIJI_BASELINE_CHANGED')
  assert.equal(f.builds.length, 0)
})

test('フォーム状態欠落を固定コード/工程と件数だけで報告する', () => {
  const first = edit().replace(/<input type="hidden" name="te-conditions"[^>]*>/, '')
  const f = fixture({ first }), result = f.run()
  assert.equal(result.success, false)
  assert.equal(result.phase, 'SUBMISSION_PARSE')
  assert.equal(result.code, 'POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE')
  assert.equal(result.forms[0].frameworkState.conditions.preparedEntryCount, 0)
  assert.equal(f.builds.length, 0)
})

test('秘密情報付き例外や未知コードをログ・戻り値へ流さない', () => {
  for (const options of [{ networkError: 'POS_READ_HTTP_FAILURE synthetic-private-password' },
    { buildError: 'POS_PRODUCT_SUBMISSION_REJECTED synthetic-private-state' },
    { buildError: 'POS_PRODUCT_FORM_REJECTED_SYNTHETIC_PRIVATE_KEY' }]) {
    const f = fixture(options), result = f.run()
    assert.equal(result.success, false)
    assert.equal(result.code, 'UNEXPECTED_ERROR')
    assert.doesNotMatch(f.logs.join('\n') + JSON.stringify(result), /synthetic-private|SYNTHETIC_PRIVATE|fixture-id|既存画像/)
  }
})

test('属性重複の固定分類を保持し、属性値や未知suffixは表示しない', () => {
  const f = fixture({ first: edit().replace(`name="${prefix}goodsNameKana"`, `name="${prefix}goodsNameKana" name="synthetic-private-name"`) })
  const result = f.run()
  assert.equal(result.phase, 'INSPECTION_PARSE')
  assert.equal(result.code, 'POS_PRODUCT_FORM_REJECTED_CONTROL_ATTRIBUTES_DUPLICATE_NAME')
  assert.doesNotMatch(f.logs.join('\n'), /synthetic-private-name/)
  for (const code of ['POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE_MARKUP_DUPLICATE_VALUE',
    'POS_PRODUCT_FORM_REJECTED_SELECT_OPTIONS_DUPLICATE_SELECTED']) {
    assert.equal(fixture({ buildError: code }).run().code, code)
  }
  assert.equal(fixture({ buildError: 'POS_PRODUCT_FORM_REJECTED_CONTROL_ATTRIBUTES_DUPLICATE_SYNTHETIC_PRIVATE' }).run().code, 'UNEXPECTED_ERROR')
})

test('既知の組立拒否を固定コードで区別する', () => {
  const f = fixture({ buildError: 'POS_PRODUCT_SUBMISSION_REJECTED' }), result = f.run()
  assert.equal(result.phase, 'SUBMISSION_BUILD')
  assert.equal(result.code, 'POS_PRODUCT_SUBMISSION_REJECTED')
  assert.equal(result.productSaveSent, false)
})

test('新診断は公開入口/実行器/consume/DB/Drive/トリガーへ接続しない', () => {
  const code = source('posProductMomijiDiagnostic.js')
  assert.doesNotMatch(code, /UrlFetchApp|PropertiesService|executePosProductEdit_|DriveApp|SpreadsheetApp|ScriptApp|SUPABASE|doPost|doGet|consumeDispatch|fetch\(|upsert|processProductMasterCSV_/)
  assert.equal((code.match(/^function\s+/gm) ?? []).length, 1)
  for (const name of ['autoDownload.js', 'posProductEditGateway.js', 'posProductInspection.js']) assert.ok(!source(name).includes('diagnoseHontenMomijiEditPreparation'))
})

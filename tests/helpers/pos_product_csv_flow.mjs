import assert from 'node:assert/strict'

// ネットワークへ接続せず、異なる実フォームを順に返すPOS通信fixture。
export function attachProductMasterCsvFlow(context, options = {}) {
  const storeId = options.storeId ?? 7, group = storeId === 7 ? '11098' : '11099'
  const storeName = storeId === 7 ? 'からつケンネル本店' : 'わんわんペットセンター'
  const baseUrl = 'https://cg8.power-k.jp/0D890OGI'
  const path = '/hm-hmma/view/hmma/hmma024/', searchUrl = 'https://cg8.power-k.jp' + path + 'hmma02405.html'
  const exportUrl = 'https://cg8.power-k.jp' + path + 'hmma02494.html'
  const searchPrefix = 'includeChildBody:hmma02405Form:', exportPrefix = 'includeChildBody:hmma02494Form:'
  const fields = ['ofNameChk', 'gdsSalesKbnChk', 'goodsGroupChk', 'goodsGroupNameChk',
    'goodsNameKanaChk', 'goodsPriceChk', 'liveMembersDispChk', 'goodsTaxCdChk', 'goodsCostChk']
  const submit = (prefix, name, disabled = '') => `<input type="submit" name="${prefix}${name}" value="" ${disabled}/>`
  const searchForm = revision => `<form id="hmma02405Form" name="includeChildBody:hmma02405Form" action="${searchUrl}">` +
    `<input type="hidden" name="${searchPrefix}viewState" value="search-state-${revision}"/>` +
    `<select name="${searchPrefix}schTenpoGroup"><option value="11097" selected>全店</option>` +
    `<option value="${group}">${storeName}</option></select>` + submit(searchPrefix, 'doSearch') +
    submit(searchPrefix, 'goHmma02494') + submit(searchPrefix, 'goHmma02400') + '</form>' +
    `<form id="otherForm"><input name="${searchPrefix}viewState" value="outside-state"/>` +
    submit(searchPrefix, 'goHmmaWrong') + '</form>'
  let stage = 'login', reloads = 0, exports = 0, downloads = 0, driveWrites = 0, dbWrites = 0
  const posts = []
  const exportForm = ready => {
    let html = `<form id="hmma02494Form" name="includeChildBody:hmma02494Form" action="${exportUrl}">` +
      fields.map(name => `<input type="checkbox" name="${exportPrefix}${name}" value="true"/>`).join('') +
      `<input type="hidden" name="${exportPrefix}viewState" value="export-state"/>` +
      submit(exportPrefix, 'doExport') + submit(exportPrefix, 'goHmma02400') +
      submit(exportPrefix, 'doDownload', ready ? '' : 'disabled="disabled"') + 'ダウンロード</form>'
    return options.exportHtml ? options.exportHtml(html) : html
  }
  const rows = [`${storeId === 7 ? '11053' : '11054'},${storeName},2,0012345678901,g,分類,商品,,200,1,,100`,
    `${storeId === 7 ? '11053' : '11054'},${storeName},2,999999,g,分類,共通,,200,1,,100`]
  const blob = options.blob ?? { getDataAsString: () => rows.join('\n') }
  const response = (html, headers = {}, status = 200) => ({ getResponseCode: () => status,
    getContentText: () => html, getHeaders: () => headers, getAllHeaders: () => headers, getBlob: () => blob })
  const redirect = url => response('', { Location: url }, 302)
  context.UrlFetchApp = { fetch(url, request) {
    const method = request.method.toLowerCase(), payload = request.payload ?? {}
    const commands = Object.keys(payload).filter(key => /:(?:do|go)[A-Z]/.test(key)).map(key => key.split(':').pop())
    if (method === 'post' && url !== baseUrl) posts.push({ commands, payload: { ...payload } })
    if (url === baseUrl && method === 'get') return response('<form id="hmma00000Form" name="hmma00000Form"></form>')
    if (url === baseUrl && method === 'post') return redirect('https://cg8.power-k.jp/portal.html')
    if (url.endsWith('/portal.html')) return response('<main>POS</main>')
    if (url === searchUrl && method === 'get') {
      const html = searchForm(stage === 'search-result' ? 2 : 1)
      return response(options.searchHtml ? options.searchHtml(html, stage) : html)
    }
    if (url === searchUrl && method === 'post' && stage === 'login') {
      assert.deepEqual(commands, ['doSearch'])
      assert.equal(payload[searchPrefix + 'viewState'], 'search-state-1')
      assert.equal(payload[searchPrefix + 'schTenpoGroup'], group)
      stage = options.directExport ? 'export-page' : 'search-result'
      return redirect(options.directExport ? exportUrl : searchUrl)
    }
    if (url === searchUrl && method === 'post' && stage === 'search-result') {
      assert.deepEqual(commands, ['goHmma02494'])
      assert.equal(payload[searchPrefix + 'viewState'], 'search-state-2')
      assert.equal(payload[searchPrefix + 'schTenpoGroup'], group)
      stage = 'export-page'
      return redirect(exportUrl)
    }
    if (url === exportUrl && method === 'get') {
      if (stage === 'export-running') reloads++
      return response(exportForm(stage === 'export-running' && reloads >= (options.readyAfter ?? 1)))
    }
    if (url === exportUrl && method === 'post' && commands[0] === 'doExport') {
      assert.deepEqual(commands, ['doExport'])
      assert.equal(stage, 'export-page')
      assert.equal(payload[exportPrefix + 'viewState'], 'export-state')
      for (const name of fields) assert.equal(payload[exportPrefix + name], 'true')
      exports++; stage = 'export-running'
      return redirect(exportUrl)
    }
    if (url === exportUrl && method === 'post' && commands[0] === 'doDownload') {
      assert.deepEqual(commands, ['doDownload'])
      assert.ok(reloads >= (options.readyAfter ?? 1), 'disabled download must not be sent')
      downloads++
      return response('', { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=goods.csv' })
    }
    throw Error('unexpected synthetic POS request')
  } }
  context.Utilities.sleep = () => {}
  context.switchStoreContext_ = (_, cookies, target) => {
    assert.equal(target, storeId === 7 ? '本店' : 'わんわん'); return cookies
  }
  context.DriveApp = { getFolderById: () => { driveWrites++; throw Error('dry-run Drive access forbidden') } }
  context.processProductMasterCSV_ = () => { dbWrites++; throw Error('dry-run DB write forbidden') }
  return { config: { baseUrl, loginId: 'private-login', password: 'private-password',
    companyCd: 'private-company', companyKey: '', tenpoGroupId: group, tenpoGroupName: storeName }, posts,
    get counts() { return { exports, downloads, reloads, driveWrites, dbWrites } } }
}

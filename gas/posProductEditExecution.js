/**
 * 通常編集のprivate実行アダプター。公開入口/診断/トリガーへは接続しない。
 * 専用フラグは既定OFF。永続consumeDispatchの実装/配線前は通信もできない。
 * consumeはDBのcommand hash/内部ID/期待結果とdispatchHashを束縛し、原子的に一度だけ受理する必要がある。
 * Nodeの既存claimを二度呼ぶだけではこの契約を満たさない。hidden/本文/資格情報は永続化しない。
 */
function executePosProductEdit_(config, command, consumeDispatch) {
  var saveRequestStarted = false, responseReceived = false;
  function result(outcome, code, inspection) {
    var value = { outcome: outcome, code: code, saveRequestStarted: saveRequestStarted, responseReceived: responseReceived };
    if (inspection) value.inspection = inspection;
    return value;
  }
  function reject() { throw new Error('POS_PRODUCT_EDIT_EXECUTION_REJECTED'); }
  function record(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
        keys.some(function(key) { return !Object.prototype.hasOwnProperty.call(value, key); })) reject();
    return value;
  }
  function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (!value || typeof value !== 'object') reject();
    return '{' + Object.keys(value).sort().map(function(key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
  }
  var request, dispatchHash;
  try {
    if (PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_EDIT_EXECUTION_ENABLED') !== 'true') {
      return result('not_sent', 'POS_PRODUCT_EDIT_DISABLED');
    }
    if (typeof consumeDispatch !== 'function') return result('not_sent', 'POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE');
    record(command, ['operationId', 'actorId', 'storeId', 'janCode', 'before', 'patch', 'expiresAt']);
    var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (typeof command.operationId !== 'string' || !uuid.test(command.operationId) ||
        typeof command.actorId !== 'string' || !uuid.test(command.actorId) || (command.storeId !== 6 && command.storeId !== 7) ||
        typeof command.janCode !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(command.janCode)) reject();
    var now = Date.now();
    if (!Number.isSafeInteger(command.expiresAt) || command.expiresAt <= now || command.expiresAt - now > 120000) reject();
    record(command.before, ['identity', 'fields', 'settings', 'groups', 'suppliers']);
    if (!command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch)) reject();
    var patchKeys = Object.keys(command.patch);
    if (!patchKeys.length || patchKeys.length > 5 || patchKeys.some(function(key) {
      return ['goodsName', 'goodsGroup', 'gddGoodsPrice', 'gddGoodsCost', 'gddSupplierCd'].indexOf(key) < 0 ||
        typeof command.patch[key] !== 'string' || command.patch[key].length > 1000;
    })) reject();
    // 呼出元/consumeの後の変更が送信内容を差し替えないよう、値を内部コピーする。
    var requestText = canonical(command);
    if (requestText.length > 24576 || Utilities.newBlob(requestText).getBytes().length > 24576) reject();
    request = JSON.parse(requestText);
    // 台帳commandのpayloadHashとは別。永続ポートが両者を明示的に束縛する。
    dispatchHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, requestText, Utilities.Charset.UTF_8)
      .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
    if (!config || config.baseUrl !== 'https://cg8.power-k.jp/0D890OGI' ||
        typeof config.loginId !== 'string' || !config.loginId || config.loginId.length > 4096 ||
        typeof config.password !== 'string' || !config.password || config.password.length > 4096) reject();
  } catch (_) { return result('not_sent', 'POS_PRODUCT_EDIT_INVALID_REQUEST'); }

  var origin = 'https://cg8.power-k.jp', cookies = '', fieldsMap = {
    goodsName: 'name', goodsGroup: 'groupId', gddGoodsPrice: 'price', gddGoodsCost: 'cost', gddSupplierCd: 'supplierId',
  };
  function url(value) {
    if (typeof value !== 'string' || !/^https:\/\/cg8\.power-k\.jp\/(?:0D890OGI|hm-hmma\/view\/hmma\/hmma(?:000\/hmma00000|030\/hmma03000|024\/hmma0240[023])\.html(?:;jsessionid=[A-Za-z0-9_-]{1,128}(?:\.[A-Za-z0-9_-]{1,32})?)?)(?:\?te-uniquekey=[A-Za-z0-9_-]{1,128})?$/.test(value)) reject();
    return value;
  }
  function absolute(value) { return url(typeof value === 'string' && value[0] === '/' ? origin + value : value); }
  function readRequest(target, payload) {
    for (var redirects = 0; redirects < 4; redirects++) {
      var response = UrlFetchApp.fetch(url(target), { method: payload ? 'post' : 'get', payload: payload || undefined,
        headers: { Cookie: cookies }, followRedirects: false, muteHttpExceptions: true });
      cookies = mergeCookies_(cookies, response);
      var code = response.getResponseCode();
      if (code === 302 || code === 303) {
        var headers = response.getHeaders();
        target = absolute(headers.Location || headers.location);
        payload = null; // 転送はGETだけ。Cookie/本文を外部ホストへ送らない。
        continue;
      }
      if (code !== 200) reject();
      var html = response.getContentText();
      if (typeof html !== 'string' || html.length > 2000000) reject();
      return html;
    }
    reject();
  }
  function inspect() {
    var listUrl = origin + '/hm-hmma/view/hmma/hmma024/hmma02400.html', searches = [], forms = [], images = [];
    ['schGoodsId', 'schMakerCd'].forEach(function(searchField) {
      var html = readRequest(listUrl);
      var filters = { schOfficeCd: request.storeId === 7 ? '11053' : '11054', schTenpoGroupNoSingle: request.storeId === 7 ? '11098' : '11099',
        schGoodsId: '', schMakerCd: '', schGoodsName: '' };
      filters[searchField] = request.janCode;
      html = readRequest(listUrl, posReadPayload_(html, 'hmma02400Form', 'doSerchNormal', filters));
      var text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '');
      var count = text.match(/([\d,]+)\s*件中/);
      if (!count || Number(count[1].replace(/,/g, '')) !== 1) reject();
      var listForm = posReadForm_(html, 'hmma02400Form'), fields = extractAllFormFields_(listForm, 'hmma02400Form');
      var buttons = Object.keys(fields).filter(function(key) { return /^includeChildBody:hmma02400Form:goodsItems:\d+:doHmma02402$/.test(key); });
      if (buttons.length !== 1) reject();
      html = readRequest(listUrl, posReadPayload_(html, 'hmma02400Form', buttons[0].replace('includeChildBody:hmma02400Form:', ''), {}));
      html = readRequest(origin + '/hm-hmma/view/hmma/hmma024/hmma02402.html', posReadPayload_(html, 'hmma02402Form', 'doHmma02403', {}));
      var parsed = parsePosProductEditForm_(html, request.storeId, request.janCode, true), inspection = parsed.inspection;
      // 現行フォームで確認済みの画像業務値だけをprivateに照合する。通信状態hiddenは比較しない。
      // 欠落/無効化/型変更は画像保持を確認できないため停止し、値自体はDTOやログへ出さない。
      var imageControls = parsed.submission.controls.imageFileName;
      var imageEntries = parsed.submission.entries.filter(function(entry) { return entry.key === 'imageFileName'; });
      if (!imageControls || imageControls.length !== 1 || imageControls[0].type !== 'hidden' || imageEntries.length !== 1 ||
          imageEntries[0].value !== imageControls[0].value) reject();
      images.push(imageEntries[0].value);
      searches.push({ field: searchField, count: 1, inspected: true, internalId: inspection.identity.posProductId,
        internalIdPresent: true, salesKind: '2', storeGroupId: inspection.identity.groupId,
        productCodeMatches: inspection.identity.productCode === request.janCode,
        manufacturerCodeMatches: inspection.identity.manufacturerCode === request.janCode, formInspection: inspection });
      forms.push(html);
    });
    if (canonical(searches[0].formInspection) !== canonical(searches[1].formInspection) || images[0] !== images[1]) reject();
    return { html: forms[1], imageFileName: images[1], data: { storeId: request.storeId, janCode: request.janCode, capturedAt: Date.now(), searches: searches } };
  }

  function executableNow() {
    return Date.now() < request.expiresAt && PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_EDIT_EXECUTION_ENABLED') === 'true';
  }
  var prepared, expected, beforeImageFileName;
  try {
    var loginHtml = readRequest(config.baseUrl);
    var loginPayload = posReadPayload_(loginHtml, 'hmma00000Form', 'doLogin', { loginId: config.loginId, password: config.password });
    var loginAction = absolute(posReadDecode_(extractFormAction_(posReadForm_(loginHtml, 'hmma00000Form'), 'hmma00000Form') || ''));
    if (!/^https:\/\/cg8\.power-k\.jp\/(?:0D890OGI|hm-hmma\/view\/hmma\/hmma000\/hmma00000\.html(?:;jsessionid=[A-Za-z0-9_.-]+)?)(?:\?te-uniquekey=[A-Za-z0-9_-]+)?$/.test(loginAction)) reject();
    readRequest(loginAction, loginPayload);
    var before = inspect();
    beforeImageFileName = before.imageFileName;
    prepared = buildPosProductEditSubmission_(before.html, request.storeId, request.janCode, request.before, request.patch);
    expected = JSON.parse(canonical(request.before));
    Object.keys(request.patch).forEach(function(key) { expected.fields[fieldsMap[key]] = key === 'gddSupplierCd' && request.patch[key] === '' ? null : request.patch[key]; });
  } catch (_) { return result('not_sent', 'POS_PRODUCT_EDIT_PREPARE_REJECTED'); }

  try {
    if (!executableNow()) return result('not_sent', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED');
    var receipt = consumeDispatch({ operationId: request.operationId, actorId: request.actorId, storeId: request.storeId, dispatchHash: dispatchHash });
    record(receipt, ['operationId', 'actorId', 'storeId', 'dispatchHash', 'accepted']);
    if (receipt.accepted !== true || receipt.operationId !== request.operationId || receipt.actorId !== request.actorId ||
        receipt.storeId !== request.storeId || receipt.dispatchHash !== dispatchHash) reject();
  } catch (_) { return result('verification_required', 'POS_PRODUCT_EDIT_EXECUTION_RIGHT_UNAVAILABLE'); }

  try {
    // 実行権の消費中に期限切れ/運用停止となっても、保存を開始しない。
    if (!executableNow()) return result('verification_required', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED');
  } catch (_) { return result('verification_required', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED'); }

  var sentAt = Date.now(), unexpectedResponse = false;
  // 保存POSTはこの1箇所だけ。例外/転送/不明結果でも再送ループへ戻らない。
  saveRequestStarted = true;
  try {
    var saveResponse = UrlFetchApp.fetch(url(prepared.url), { method: 'post', contentType: prepared.contentType, payload: prepared.payload,
      headers: { Cookie: cookies }, followRedirects: false, muteHttpExceptions: true });
    responseReceived = true;
    cookies = mergeCookies_(cookies, saveResponse);
    var saveCode = saveResponse.getResponseCode();
    if (saveCode === 302 || saveCode === 303) {
      var saveHeaders = saveResponse.getHeaders();
      absolute(saveHeaders.Location || saveHeaders.location); // 転送先は検査だけ。保存本文を再送しない。
    } else if (saveCode !== 200) reject();
  } catch (_) { unexpectedResponse = responseReceived; }
  try {
    // 成功画面/保存応答HTMLは読まず、固定の一覧から新しく両検索する。
    var after = inspect();
    if (unexpectedResponse || after.data.capturedAt <= sentAt || after.imageFileName !== beforeImageFileName ||
        canonical(after.data.searches[1].formInspection) !== canonical(expected)) reject();
    return result('values_verified', 'POS_PRODUCT_EDIT_VALUES_VERIFIED', after.data);
  } catch (_) { return result('verification_required', 'POS_PRODUCT_EDIT_VERIFY_REQUIRED'); }
}

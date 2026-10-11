/**
 * 署名付きの商品読取り受付。公開受付側と専用読取りフラグの両方を必須にする。
 * 保存・削除・DB受付は扱わず、専用フラグ未設定ではPOS通信しない。
 */
function handlePosProductInspection_(body) {
  var startedAt = Date.now(), stage = 'CONFIG', verified = null;
  try {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('POS_PRODUCT_INSPECTION_ENABLED') !== 'true') throw new Error('DISABLED');
    stage = 'VERIFY';
    var request = verifyPosProductRequest_(body, properties.getProperty('POS_PRODUCT_SIGNING_SECRET'));
    var payload = request.payload;
    if (request.action !== 'inspect' || Object.keys(payload).length !== 3 ||
        ['operationId', 'storeId', 'janCode'].some(function(key) { return !Object.prototype.hasOwnProperty.call(payload, key); }) ||
        payload.operationId !== request.operationId || payload.storeId !== request.storeId ||
        typeof payload.janCode !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(payload.janCode)) throw new Error('INVALID_TARGET');
    verified = request;
    stage = 'POS_CONFIG';
    var data = inspectPosProductEdit_(getPOSConfig_(), request.storeId, payload.janCode, function(next) {
      // 通信値ではなく、読取りアダプターの既知工程だけを診断へ渡す。
      if (/^(LOGIN_GET|LOGIN_PAYLOAD|LOGIN_ACTION|LOGIN_POST|LIST_GET|SEARCH_PAYLOAD|SEARCH_POST|SEARCH_PARSE|DETAIL_POST|EDIT_POST|EDIT_PARSE)$/.test(next)) stage = next;
    });
    return { version: 1, success: true, operationId: request.operationId, actorId: request.actorId,
      storeId: request.storeId, janCode: payload.janCode, data: data };
  } catch (error) {
    // HTML、通信例外、署名/資格情報、利用者が渡した文字列を返さない。
    if (verified) {
      var message = error && typeof error.message === 'string' ? error.message : '';
      var code = 'UNAVAILABLE';
      if (/^POS_PRODUCT_FORM_REJECTED(?:_[A-Z_0-9]+)?$/.test(message)) code = 'FORM_CONTRACT';
      else if (message === 'POS_READ_IDENTITY_MISMATCH') code = 'IDENTITY';
      else if (/^(POS_SEARCH_COUNT_UNKNOWN|POS_SEARCH_NOT_UNIQUE)$/.test(message)) code = 'SEARCH';
      else if (message === 'POS_READ_HTTP_FAILURE') code = 'HTTP';
      else if (/^(UNEXPECTED_POS_READ_URL|INVALID_POS_READ_REDIRECT|POS_READ_REDIRECT_LIMIT)$/.test(message)) code = 'REDIRECT';
      else if (/^(UNEXPECTED_POS_READ_FORM|POS_READ_ACTION_MISSING|POS_READ_FIELD_MISSING|POS_LOGIN_ACTION_MISSING|INVALID_POS_READ_HTML)$/.test(message)) code = 'FORM_CONTRACT';
      return { version: 1, success: false, operationId: verified.operationId, actorId: verified.actorId,
        storeId: verified.storeId, janCode: verified.payload.janCode, code: code, stage: stage,
        elapsedMs: Math.min(360000, Math.max(0, Date.now() - startedAt)) };
    }
    return { version: 1, success: false, code: 'POS_PRODUCT_INSPECTION_UNAVAILABLE' };
  }
}

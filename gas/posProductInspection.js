/**
 * 署名付きの商品読取り受付。ローカルのみでdoPost/トリガーへ未接続。
 * 保存・削除・DB受付は扱わず、専用フラグ未設定ではPOS通信しない。
 */
function handlePosProductInspection_(body) {
  try {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('POS_PRODUCT_INSPECTION_ENABLED') !== 'true') throw new Error('DISABLED');
    var request = verifyPosProductRequest_(body, properties.getProperty('POS_PRODUCT_SIGNING_SECRET'));
    var payload = request.payload;
    if (request.action !== 'inspect' || Object.keys(payload).length !== 3 ||
        ['operationId', 'storeId', 'janCode'].some(function(key) { return !Object.prototype.hasOwnProperty.call(payload, key); }) ||
        typeof payload.janCode !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(payload.janCode)) throw new Error('INVALID_TARGET');
    var data = inspectPosProductEdit_(getPOSConfig_(), request.storeId, payload.janCode);
    return { version: 1, success: true, operationId: request.operationId, actorId: request.actorId,
      storeId: request.storeId, janCode: payload.janCode, data: data };
  } catch (_) {
    // HTML、通信例外、署名/資格情報、利用者が渡した文字列を返さない。
    return { version: 1, success: false, code: 'POS_PRODUCT_INSPECTION_UNAVAILABLE' };
  }
}

/**
 * 通常編集の署名付きprivate受付。公開入口/トリガーへは未接続で、専用フラグは既定OFF。
 * consume設定を実行器/POS通信より先に検査し、本文・資格情報・通信例外は公開しない。
 */
function handlePosProductEditDispatch_(body) {
  try {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('POS_PRODUCT_EDIT_GATEWAY_ENABLED') !== 'true') throw new Error('DISABLED');
    var request = verifyPosProductRequest_(body, properties.getProperty('POS_PRODUCT_SIGNING_SECRET'));
    var command = request.payload;
    posProductEditGatewayRecord_(command, ['operationId', 'actorId', 'storeId', 'janCode', 'before', 'patch', 'expiresAt']);
    // 外側の期限は署名検証後にだけ読む。内部commandの期限延長を認めない。
    var envelope = JSON.parse(body);
    if (request.action !== 'dispatch' || command.operationId !== request.operationId || command.actorId !== request.actorId ||
        command.storeId !== request.storeId || !Number.isSafeInteger(command.expiresAt) || command.expiresAt <= Date.now() ||
        command.expiresAt > envelope.expiresAt) throw new Error('INVALID_COMMAND');
    var dispatchHash = posProductHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      posProductEditGatewayCanonical_(command), Utilities.Charset.UTF_8));
    var consumer = createPosProductEditConsumer_(properties);
    var result = executePosProductEdit_(getPOSConfig_(), command, consumer);
    return { version: 1, success: true, operationId: request.operationId, actorId: request.actorId,
      storeId: request.storeId, dispatchHash: dispatchHash, result: result };
  } catch (_) {
    return { version: 1, success: false, code: 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE' };
  }
}

/**
 * 一度だけの永続実行権を固定のNodeポートで消費する。保存/再送はこの関数では行わない。
 * 専用鍵による応答署名と要求の相関を確認してから、業務receiptだけを実行器へ渡す。
 */
function createPosProductEditConsumer_(properties) {
  function reject() { throw new Error('POS_PRODUCT_EDIT_CONSUME_UNAVAILABLE'); }
  var url, secret;
  try {
    url = properties.getProperty('POS_PRODUCT_CONSUME_URL');
    secret = properties.getProperty('POS_PRODUCT_CONSUME_SECRET');
    if (properties.getProperty('POS_PRODUCT_CONSUME_ENABLED') !== 'true' ||
        url !== 'https://kennel-dashboard.vercel.app/api/pos-products/consume' ||
        typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) reject();
  } catch (_) { reject(); }
  function current() {
    if (properties.getProperty('POS_PRODUCT_CONSUME_ENABLED') !== 'true' ||
        properties.getProperty('POS_PRODUCT_CONSUME_URL') !== url ||
        properties.getProperty('POS_PRODUCT_CONSUME_SECRET') !== secret) reject();
  }

  return function(input) {
    try {
      current();
      posProductEditGatewayRecord_(input, ['operationId', 'actorId', 'storeId', 'dispatchHash']);
      var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (typeof input.operationId !== 'string' || !uuid.test(input.operationId) ||
          typeof input.actorId !== 'string' || !uuid.test(input.actorId) || (input.storeId !== 6 && input.storeId !== 7) ||
          typeof input.dispatchHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.dispatchHash)) reject();
      var issuedAt = Date.now(), expiresAt = issuedAt + 30000;
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(expiresAt)) reject();
      var request = { version: 1, audience: 'kennel.pos-product-consume.v1', operationId: input.operationId,
        actorId: input.actorId, storeId: input.storeId, issuedAt: issuedAt, expiresAt: expiresAt,
        dispatchHash: input.dispatchHash };
      request.signature = posProductHex_(Utilities.computeHmacSha256Signature(JSON.stringify([1, request.audience,
        request.operationId, request.actorId, request.storeId, request.issuedAt, request.expiresAt, request.dispatchHash]),
        secret, Utilities.Charset.UTF_8));
      // 固定URLへ一度だけ送る。転送、通信例外、曖昧な応答でも再送しない。
      var response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(request),
        followRedirects: false, muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) reject();
      var headers = response.getHeaders(), contentType = headers['Content-Type'] || headers['content-type'];
      if (typeof contentType !== 'string' || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType)) reject();
      var text = response.getContentText();
      if (typeof text !== 'string' || text.length > 4096 || Utilities.newBlob(text).getBytes().length > 4096) reject();
      var parsed = JSON.parse(text);
      posProductEditGatewayRecord_(parsed, ['version', 'requestSignature', 'receipt', 'signature']);
      var receipt = parsed.receipt;
      posProductEditGatewayRecord_(receipt, ['operationId', 'actorId', 'storeId', 'dispatchHash', 'accepted']);
      if (parsed.version !== 1 || parsed.requestSignature !== request.signature ||
          typeof parsed.signature !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.signature) ||
          receipt.operationId !== request.operationId || receipt.actorId !== request.actorId || receipt.storeId !== request.storeId ||
          receipt.dispatchHash !== request.dispatchHash || typeof receipt.accepted !== 'boolean') reject();
      var expected = posProductHex_(Utilities.computeHmacSha256Signature(JSON.stringify([1, 'kennel.pos-product-consume-response.v1',
        request.signature, receipt.operationId, receipt.actorId, receipt.storeId, receipt.dispatchHash, receipt.accepted]),
        secret, Utilities.Charset.UTF_8));
      var receivedAt = Date.now();
      if (!posProductEqualHex_(parsed.signature, expected) || !Number.isSafeInteger(receivedAt) ||
          receivedAt < issuedAt || receivedAt >= expiresAt) reject();
      // 設定変更後は旧鍵のreceiptを使わない。実行権消費済みの可能性があっても再送しない。
      current();
      return { operationId: receipt.operationId, actorId: receipt.actorId, storeId: receipt.storeId,
        dispatchHash: receipt.dispatchHash, accepted: receipt.accepted };
    } catch (_) { reject(); }
  };
}

function posProductEditGatewayRecord_(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(function(key) { return !Object.prototype.hasOwnProperty.call(value, key); })) throw new Error('INVALID_RECORD');
}

function posProductEditGatewayCanonical_(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(posProductEditGatewayCanonical_).join(',') + ']';
  if (!value || typeof value !== 'object') throw new Error('INVALID_VALUE');
  return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + posProductEditGatewayCanonical_(value[key]);
  }).join(',') + '}';
}

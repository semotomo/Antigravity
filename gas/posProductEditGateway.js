/**
 * 通常編集の署名付きprivate受付。公開入口/トリガーへは未接続で、専用フラグは既定OFF。
 * consume設定を実行器/POS通信より先に検査し、本文・資格情報・通信例外は公開しない。
 */
function handlePosProductEditDispatch_(body) {
  try {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('POS_PRODUCT_EDIT_GATEWAY_ENABLED') !== 'true') throw new Error('DISABLED');
    var signingSecret = properties.getProperty('POS_PRODUCT_SIGNING_SECRET');
    var request = verifyPosProductRequest_(body, signingSecret);
    var command = request.payload;
    posProductEditGatewayRecord_(command, ['operationId', 'actorId', 'storeId', 'janCode', 'before', 'patch', 'expiresAt']);
    // 外側の期限は署名検証後にだけ読む。内部commandの期限延長を認めない。
    var envelope = JSON.parse(body);
    if (request.action !== 'dispatch' || command.operationId !== request.operationId || command.actorId !== request.actorId ||
        command.storeId !== request.storeId || !Number.isSafeInteger(command.expiresAt) || command.expiresAt <= Date.now() ||
        command.expiresAt > envelope.expiresAt) throw new Error('INVALID_COMMAND');
    var dispatchHash = posProductHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      posProductEditGatewayCanonical_(command), Utilities.Charset.UTF_8));
    var consumer = createPosProductEditConsumer_(properties), consumeCalled = false;
    var result = executePosProductEdit_(getPOSConfig_(), command, function(input) {
      // consumeの成否によらず、呼出後の結果へ「consume前」の証明を付けない。
      consumeCalled = true;
      return consumer(input);
    });
    var response = { version: 1, success: true, operationId: request.operationId, actorId: request.actorId,
      storeId: request.storeId, dispatchHash: dispatchHash, result: result };
    if (!consumeCalled) {
      var proof = createPosProductNotSentProof_(properties, signingSecret, request, envelope, dispatchHash, result);
      if (proof) response.notSentProof = proof;
    }
    return response;
  } catch (_) {
    return { version: 1, success: false, code: 'POS_PRODUCT_EDIT_DISPATCH_UNAVAILABLE' };
  }
}

/** consume前の固定停止だけを証明する。本文・hidden・例外原文は証明へ含めない。 */
function createPosProductNotSentProof_(properties, secret, request, envelope, dispatchHash, result) {
  try {
    posProductEditGatewayRecord_(result, ['outcome', 'code', 'saveRequestStarted', 'responseReceived']);
    var preConsumeCodes = ['POS_PRODUCT_EDIT_DISABLED', 'POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE',
      'POS_PRODUCT_EDIT_INVALID_REQUEST', 'POS_PRODUCT_EDIT_PREPARE_REJECTED', 'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED'];
    if (result.outcome !== 'not_sent' || result.saveRequestStarted !== false || result.responseReceived !== false ||
        preConsumeCodes.indexOf(result.code) < 0) return null;
    var occurredAt = Date.now();
    if (!Number.isSafeInteger(occurredAt) || occurredAt < 0 ||
        properties.getProperty('POS_PRODUCT_SIGNING_SECRET') !== secret) return null;
    var proof = { version: 1, audience: 'kennel.pos-product-not-sent.v1', operationId: request.operationId,
      actorId: request.actorId, storeId: request.storeId, dispatchHash: dispatchHash,
      requestSignature: envelope.signature, stopCode: result.code, occurredAt: occurredAt };
    proof.signature = posProductHex_(Utilities.computeHmacSha256Signature(JSON.stringify([1, proof.audience,
      proof.operationId, proof.actorId, proof.storeId, proof.dispatchHash, proof.requestSignature,
      proof.stopCode, proof.occurredAt]), secret, Utilities.Charset.UTF_8));
    // 署名処理中に運用鍵が変更された場合も、旧鍵の証明を外へ返さない。
    if (properties.getProperty('POS_PRODUCT_SIGNING_SECRET') !== secret) return null;
    return proof;
  } catch (_) { return null; }
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

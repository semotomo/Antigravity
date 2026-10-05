/**
 * 商品用署名の検証のみ。公開入口にはまだ接続しない。
 * 実行時にはDB認可・内容照合・原子的claimが別途必須で、署名だけでは保存しない。
 * 本文、秘密鍵、認証情報をログへ出さない。
 */
function verifyPosProductRequest_(body, secret, now) {
  var hexPattern = /^[0-9a-f]{64}$/;
  var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (now === undefined) now = Date.now();
  if (typeof secret !== 'string' || !hexPattern.test(secret) ||
      typeof body !== 'string' || body.length > 24576 || Utilities.newBlob(body).getBytes().length > 24576) posProductAuthReject_();
  var envelope;
  try { envelope = JSON.parse(body); } catch (_) { posProductAuthReject_(); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) posProductAuthReject_();
  var keys = ['version', 'audience', 'action', 'operationId', 'actorId', 'storeId', 'issuedAt', 'expiresAt', 'payload', 'payloadHash', 'signature'];
  if (Object.keys(envelope).length !== keys.length || Object.keys(envelope).some(function(k) { return keys.indexOf(k) < 0; })) posProductAuthReject_();
  if (envelope.version !== 1 || envelope.audience !== 'kennel.pos-products.v1' ||
      ['inspect', 'dispatch', 'reconcile'].indexOf(envelope.action) < 0 ||
      typeof envelope.operationId !== 'string' || !uuidPattern.test(envelope.operationId) ||
      typeof envelope.actorId !== 'string' || !uuidPattern.test(envelope.actorId) ||
      (envelope.storeId !== 6 && envelope.storeId !== 7)) posProductAuthReject_();
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(envelope.issuedAt) || !Number.isSafeInteger(envelope.expiresAt) ||
      envelope.issuedAt < 0 || envelope.issuedAt > now + 5000 || envelope.expiresAt <= now ||
      envelope.expiresAt <= envelope.issuedAt || envelope.expiresAt - envelope.issuedAt > 120000) posProductAuthReject_();
  if (typeof envelope.payload !== 'string' || envelope.payload.length > 16384 ||
      Utilities.newBlob(envelope.payload).getBytes().length > 16384 ||
      typeof envelope.payloadHash !== 'string' || !hexPattern.test(envelope.payloadHash) ||
      typeof envelope.signature !== 'string' || !hexPattern.test(envelope.signature)) posProductAuthReject_();
  var payload;
  try { payload = JSON.parse(envelope.payload); } catch (_) { posProductAuthReject_(); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      payload.storeId !== envelope.storeId || payload.operationId !== envelope.operationId) posProductAuthReject_();
  var text = JSON.stringify([envelope.version, envelope.audience, envelope.action, envelope.operationId,
    envelope.actorId, envelope.storeId, envelope.issuedAt, envelope.expiresAt, envelope.payloadHash]);
  var hash = posProductHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, envelope.payload, Utilities.Charset.UTF_8));
  var signature = posProductHex_(Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8));
  if (!posProductEqualHex_(hash, envelope.payloadHash) || !posProductEqualHex_(signature, envelope.signature)) posProductAuthReject_();
  return { action: envelope.action, operationId: envelope.operationId, actorId: envelope.actorId,
    storeId: envelope.storeId, payloadHash: envelope.payloadHash, payload: payload };
}

function posProductAuthReject_() { throw new Error('POS_PRODUCT_AUTHORIZATION_REJECTED'); }
function posProductHex_(bytes) {
  return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function posProductEqualHex_(a, b) {
  // 長さと形式は呼出元で固定。途中の一致文字数で早期returnしない。
  var different = 0;
  for (var i = 0; i < 64; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

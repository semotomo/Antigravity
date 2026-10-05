/** 商品同期専用署名受付。設定・秘密鍵・要求/応答原文・従来ログを外部へ返さない。 */
function productMasterSyncHex_(bytes) {
  return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function productMasterSyncEqualHex_(a, b) {
  var different = 0;
  for (var i = 0; i < 64; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
function verifyProductMasterSyncRequest_(body, secret, now) {
  if (now === undefined) now = Date.now();
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret) || typeof body !== 'string' ||
      body.length > 2048 || Utilities.newBlob(body).getBytes().length > 2048) throw new Error('PRODUCT_SYNC_UNKNOWN');
  var e;
  try { e = JSON.parse(body); } catch (_) { throw new Error('PRODUCT_SYNC_UNKNOWN'); }
  var keys = ['version', 'audience', 'requestId', 'storeId', 'issuedAt', 'expiresAt', 'signature'];
  if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length !== keys.length ||
      keys.some(function(key) { return !Object.prototype.hasOwnProperty.call(e, key); }) ||
      e.version !== 1 || e.audience !== 'kennel.product-master-sync.request.v1' ||
      typeof e.requestId !== 'string' || !productMasterSyncUuid_(e.requestId) || (e.storeId !== 6 && e.storeId !== 7) ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(e.issuedAt) || e.issuedAt < 0 || e.issuedAt > now + 5000 ||
      !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= now || e.expiresAt <= e.issuedAt || e.expiresAt - e.issuedAt > 120000 ||
      typeof e.signature !== 'string' || !/^[0-9a-f]{64}$/.test(e.signature)) throw new Error('PRODUCT_SYNC_UNKNOWN');
  var text = JSON.stringify([e.version, e.audience, e.requestId, e.storeId, e.issuedAt, e.expiresAt]);
  var signature = productMasterSyncHex_(Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8));
  if (!productMasterSyncEqualHex_(e.signature, signature)) throw new Error('PRODUCT_SYNC_UNKNOWN');
  return e;
}
function signedProductMasterSyncResponse_(request, result, secret) {
  var now = Date.now(), payload = JSON.stringify(result);
  if (Utilities.newBlob(payload).getBytes().length > 4096) throw new Error('PRODUCT_SYNC_UNKNOWN');
  var hash = productMasterSyncHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload, Utilities.Charset.UTF_8));
  var text = JSON.stringify([1, 'kennel.product-master-sync.response.v1', request.requestId, request.storeId, now, now + 120000, hash]);
  return { version: 1, audience: 'kennel.product-master-sync.response.v1', requestId: request.requestId, storeId: request.storeId,
    issuedAt: now, expiresAt: now + 120000, payload: payload, payloadHash: hash,
    signature: productMasterSyncHex_(Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8)) };
}
function productMasterSyncFixedStoreConfig_(storeId) {
  if (storeId !== 6 && storeId !== 7) throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  var properties = PropertiesService.getScriptProperties(), prefix = 'POS_PRODUCT_SYNC_STORE_' + storeId + '_';
  var config = { baseUrl: properties.getProperty(prefix + 'BASE_URL'), loginId: properties.getProperty(prefix + 'LOGIN_ID'),
    password: properties.getProperty(prefix + 'PASSWORD'), companyCd: properties.getProperty(prefix + 'COMPANY_CD'),
    companyKey: properties.getProperty(prefix + 'COMPANY_KEY'), tenpoGroupId: properties.getProperty(prefix + 'TENPO_GROUP_ID'),
    tenpoGroupName: properties.getProperty(prefix + 'TENPO_GROUP_NAME') };
  var storeName = storeId === 6 ? 'わんわんペットセンター' : 'からつケンネル本店';
  // 汎用POS設定へ後退せず、その店舗に固定した接続情報だけを利用する。
  if (typeof config.baseUrl !== 'string' || !/^https:\/\/cg8\.power-k\.jp\/[A-Za-z0-9_-]{1,100}$/.test(config.baseUrl) ||
      typeof config.loginId !== 'string' || !config.loginId || config.loginId.length > 256 ||
      typeof config.password !== 'string' || !config.password || config.password.length > 1024 ||
      typeof config.companyCd !== 'string' || !config.companyCd || config.companyCd.length > 100 ||
      typeof config.companyKey !== 'string' || config.companyKey.length > 256 ||
      typeof config.tenpoGroupId !== 'string' || !/^\d{1,10}$/.test(config.tenpoGroupId) || config.tenpoGroupName !== storeName) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  }
  return config;
}
function handleProductMasterSyncRequest_(body) {
  var request = null, context = null, properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('POS_PRODUCT_MASTER_SYNC_SECRET');
  try {
    request = verifyProductMasterSyncRequest_(body, secret);
    if (secret === properties.getProperty('POS_PRODUCT_SIGNING_SECRET')) throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
    if (properties.getProperty('POS_PRODUCT_MASTER_SYNC_ENABLED') !== 'true' ||
        properties.getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') !== 'true') throw productMasterSyncError_('PRODUCT_SYNC_DISABLED', 'rejected');
    var config = productMasterSyncFixedStoreConfig_(request.storeId);
    context = beginRequestedProductMasterSync_(request.storeId, request.requestId, request.expiresAt);
    var downloaded = downloadProductMasterFromPOS_(config, request.storeId === 6 ? 'わんわん' : '本店', { syncContext: context });
    if (!downloaded || downloaded.success !== true || !downloaded.syncResult || downloaded.syncResult.success !== true) {
      var failure = productMasterSyncFailure_(downloaded && downloaded.syncResult || downloaded, request.storeId, context.id);
      return signedProductMasterSyncResponse_(request, failure, secret);
    }
    var result = downloaded.syncResult;
    if (!Number.isSafeInteger(downloaded.csvRowCount) || downloaded.csvRowCount < 1 || downloaded.csvRowCount > 10000 ||
        result.count !== downloaded.csvRowCount || !Number.isSafeInteger(result.deactivatedCount) || result.deactivatedCount < 0 ||
        typeof result.syncStartedAt !== 'string' || !isFinite(Date.parse(result.syncStartedAt))) throw productMasterSyncError_('PRODUCT_SYNC_UNKNOWN', 'unknown');
    return signedProductMasterSyncResponse_(request, { success: true, storeId: request.storeId, runId: context.id, csvRowCount: downloaded.csvRowCount,
      syncResult: { success: true, count: result.count, deactivatedCount: result.deactivatedCount, syncStartedAt: result.syncStartedAt } }, secret);
  } catch (error) {
    if (request) return signedProductMasterSyncResponse_(request, productMasterSyncFailure_(error, request.storeId,
      context ? context.id : (error && error.runId)), secret);
    return { version: 1, success: false, code: 'PRODUCT_SYNC_UNAVAILABLE' };
  }
}

/** Sheetsからの内部実行も店舗を明示し、公開署名経路と同じ開始権・固定設定を使う。 */
function downloadFixedProductMasterSync_(storeId) {
  var context = null;
  try {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('POS_PRODUCT_MASTER_SYNC_ENABLED') !== 'true' ||
        properties.getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') !== 'true') throw productMasterSyncError_('PRODUCT_SYNC_DISABLED', 'rejected');
    var config = productMasterSyncFixedStoreConfig_(storeId);
    var requestId = Utilities.getUuid();
    context = beginRequestedProductMasterSync_(storeId, requestId, Date.now() + 120000);
    var result = downloadProductMasterFromPOS_(config, storeId === 6 ? 'わんわん' : '本店', { syncContext: context });
    if (!result || result.success !== true) return productMasterSyncFailure_(result && result.syncResult || result, storeId, context.id);
    return result;
  } catch (error) { return productMasterSyncFailure_(error, storeId, context ? context.id : error.runId); }
}

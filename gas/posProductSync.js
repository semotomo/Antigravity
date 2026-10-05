/** 商品マスタ同期の版管理。既定OFFで、新経路失敗時に旧書込みへ戻さない。 */
function productMasterSyncStoreId_(storeName) {
  if (storeName === '本店' || storeName === 'からつケンネル本店') return 7;
  if (storeName === 'わんわん' || storeName === 'わんわんペットセンター') return 6;
  throw new Error('商品同期の対象店舗を一つ指定してください。');
}

function productMasterSyncUuid_(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
function productMasterSyncError_(code, outcome, runId) {
  var messages = {
    PRODUCT_SYNC_PENDING_EDIT: '商品編集が未完了です。編集の完了後にCSVを取得し直して再同期してください。',
    PRODUCT_SYNC_PENDING_SYNC: '進行中または未確認の同期があります。前回同期の状態を確認してください。',
    PRODUCT_SYNC_STALE: '商品情報が変更されました。CSVを取得し直して再同期してください。',
    PRODUCT_SYNC_INVALID_DATA: '商品CSVを検証できませんでした。商品情報を確認して取得し直してください。',
    PRODUCT_SYNC_EXPIRED: '同期の有効期限を過ぎました。CSVを取得し直して再同期してください。',
    PRODUCT_SYNC_DISABLED: '商品同期は停止中です。設定を確認してください。',
    PRODUCT_SYNC_UNAVAILABLE: '商品同期の専用サーバー設定を確認してください。',
    PRODUCT_SYNC_UNKNOWN: '商品同期の結果を確認できません。再送せず同期状態を確認し、必要ならCSVを取得し直してください。',
  };
  if (!Object.prototype.hasOwnProperty.call(messages, code)) { code = 'PRODUCT_SYNC_UNKNOWN'; outcome = 'unknown'; }
  var error = new Error(messages[code]);
  error.productMasterSyncFailure = true; error.code = code; error.outcome = outcome === 'rejected' ? 'rejected' : 'unknown';
  if (productMasterSyncUuid_(runId)) error.runId = runId;
  return error;
}
function productMasterSyncFailure_(error, storeId, runId) {
  var codes = ['PRODUCT_SYNC_PENDING_EDIT', 'PRODUCT_SYNC_PENDING_SYNC', 'PRODUCT_SYNC_STALE', 'PRODUCT_SYNC_INVALID_DATA', 'PRODUCT_SYNC_EXPIRED',
    'PRODUCT_SYNC_DISABLED', 'PRODUCT_SYNC_UNAVAILABLE', 'PRODUCT_SYNC_UNKNOWN'];
  var safe = error && (error.productMasterSyncFailure === true || error.success === false) && codes.indexOf(error.code) !== -1 &&
    (error.outcome === 'unknown' || error.outcome === 'rejected');
  var result = { success: false, storeId: storeId, code: safe ? error.code : 'PRODUCT_SYNC_UNKNOWN', outcome: safe ? error.outcome : 'unknown' };
  var id = runId || (safe && error.runId);
  if (productMasterSyncUuid_(id)) result.runId = id;
  return result;
}
function productMasterSyncRpcRefusal_(status, result) {
  // SQLSTATEと固定されたDB識別子の両方を照合し、任意の例外文章を外部表示しない。
  if ((status !== 400 && status !== 409) || !result || typeof result !== 'object') return null;
  if (result.code === '40001' && (result.message === 'stale sync' || result.message === 'PRODUCT_SYNC_STALE')) return 'PRODUCT_SYNC_STALE';
  if (result.code === '55000' && (result.message === 'pending product operation' || result.message === 'PRODUCT_SYNC_PENDING_EDIT')) return 'PRODUCT_SYNC_PENDING_EDIT';
  if (result.code === '55000' && (result.message === 'sync expired' || result.message === 'PRODUCT_SYNC_EXPIRED')) return 'PRODUCT_SYNC_EXPIRED';
  if (result.code === '22023' && ['invalid sync store', 'sync unavailable', 'invalid sync records', 'invalid sync count',
    'sync content conflict', 'invalid sync fields', 'invalid sync values', 'duplicate sync JAN', 'PRODUCT_SYNC_INVALID_DATA',
    'PRODUCT_SYNC_INCOMPLETE'].indexOf(result.message) !== -1) return 'PRODUCT_SYNC_INVALID_DATA';
  return null;
}

function productMasterSyncRpc_(name, payload) {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  var key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  }
  if (['begin_product_master_sync', 'begin_product_master_sync_request', 'apply_product_master_sync', 'get_product_master_sync_request'].indexOf(name) === -1) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  }
  var response;
  try {
    response = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + name, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      muteHttpExceptions: true, followRedirects: false,
    });
  } catch (e) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNKNOWN', 'unknown', payload.p_request_id || payload.p_run_id);
  }
  var result;
  try { result = JSON.parse(response.getContentText()); } catch (e) { result = null; }
  if (response.getResponseCode() !== 200) {
    var refusal = productMasterSyncRpcRefusal_(response.getResponseCode(), result);
    throw productMasterSyncError_(refusal || 'PRODUCT_SYNC_UNKNOWN', refusal ? 'rejected' : 'unknown', payload.p_run_id || (refusal ? null : payload.p_request_id));
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw productMasterSyncError_('PRODUCT_SYNC_UNKNOWN', 'unknown', payload.p_request_id || payload.p_run_id);
  return result;
}

function beginRequestedProductMasterSync_(storeId, requestId, expiresAt) {
  if ((storeId !== 6 && storeId !== 7) || !productMasterSyncUuid_(requestId) || !Number.isSafeInteger(expiresAt)) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  }
  var result = productMasterSyncRpc_('begin_product_master_sync_request', { p_store_id: storeId, p_request_id: requestId,
    p_request_expires_at: new Date(expiresAt).toISOString() });
  if (result.accepted === false && result.outcome === 'rejected' && Object.keys(result).length === 5 && result.storeId === storeId && result.requestId === requestId &&
      ['PRODUCT_SYNC_PENDING_EDIT', 'PRODUCT_SYNC_PENDING_SYNC', 'PRODUCT_SYNC_STALE', 'PRODUCT_SYNC_INVALID_DATA', 'PRODUCT_SYNC_EXPIRED'].indexOf(result.code) !== -1) {
    throw productMasterSyncError_(result.code, 'rejected');
  }
  if (result.accepted !== true || Object.keys(result).length !== 4 || !productMasterSyncUuid_(result.id) || result.id !== requestId || result.storeId !== storeId ||
      typeof result.startedAt !== 'string' || !isFinite(Date.parse(result.startedAt))) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNKNOWN', 'unknown', requestId);
  }
  return { id: result.id, storeId: storeId, startedAt: result.startedAt };
}

function beginCoordinatedProductMasterSync_(storeName, options) {
  if (options && options.dryRun === true) return null;
  if (PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') !== 'true') return null;
  var storeId = productMasterSyncStoreId_(storeName);
  var result = productMasterSyncRpc_('begin_product_master_sync', { p_store_id: storeId });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id || '') ||
      result.storeId !== storeId || typeof result.startedAt !== 'string' || !isFinite(Date.parse(result.startedAt))) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNKNOWN', 'unknown');
  }
  return { id: result.id, storeId: storeId, startedAt: result.startedAt };
}

function applyCoordinatedProductMasterSync_(records, storeName, context) {
  var storeId = productMasterSyncStoreId_(storeName);
  if (!context || context.storeId !== storeId || !/^[0-9a-f-]{36}$/i.test(context.id || '')) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  }
  var result = productMasterSyncRpc_('apply_product_master_sync', { p_run_id: context.id, p_store_id: storeId, p_records: records });
  if (Object.keys(result).length !== 4 || result.success !== true || result.count !== records.length || !Number.isSafeInteger(result.deactivatedCount) ||
      result.deactivatedCount < 0 || typeof result.syncStartedAt !== 'string' || !isFinite(Date.parse(result.syncStartedAt))) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNKNOWN', 'unknown', context.id);
  }
  return result;
}

/**
 * 所有者の時間主導実行用。フラグは既定OFFで、トリガーを作成しない。
 * 1実行につき最大1受付だけ処理し、本文・鍵・POS認証情報を記録しない。
 */
function runPosProductBackgroundWorker() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('POS_PRODUCT_BACKGROUND_EDIT_ENABLED') !== 'true') return { processed: false, code: 'DISABLED' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1)) return { processed: false, code: 'BUSY' };
  var startedAt = Date.now(), intake = null, storeId = null, call = null, recoveryRequired = false;
  function current() {
    // 新たな通信開始を5分までに制限し、6分上限の結果通知用余裕を残す。
    if (Date.now() - startedAt >= 300000 || properties.getProperty('POS_PRODUCT_BACKGROUND_EDIT_ENABLED') !== 'true') {
      throw new Error('POS_PRODUCT_BACKGROUND_STOPPED');
    }
  }
  function readAllowed() {
    current();
    if (properties.getProperty('POS_PRODUCT_INSPECTION_ENABLED') !== 'true') throw new Error('POS_PRODUCT_BACKGROUND_READ_DISABLED');
  }
  function executionAllowed() {
    current();
    return properties.getProperty('POS_PRODUCT_INSPECTION_ENABLED') === 'true' &&
      properties.getProperty('POS_PRODUCT_CONSUME_ENABLED') === 'true';
  }
  function fail(code) {
    if (!intake || !call) return;
    try {
      var receipt = call('fail', storeId, { operationId: intake.operation_id, leaseToken: intake.lease_token, code: code });
      validatePosProductBackgroundReceipt_(receipt, intake.operation_id, storeId);
    } catch (_) {}
  }
  try {
    readAllowed();
    if (properties.getProperty('POS_PRODUCT_EDIT_EXECUTION_ENABLED') !== 'true' ||
        properties.getProperty('POS_PRODUCT_CONSUME_ENABLED') !== 'true') return { processed: false, code: 'EXECUTION_DISABLED' };
    call = createPosProductBackgroundPort_(properties, current);
    var workerId = Utilities.getUuid(), firstStore = properties.getProperty('POS_PRODUCT_BACKGROUND_NEXT_STORE') === '7' ? 7 : 6;
    if (!posProductBackgroundUuid_(workerId)) throw new Error('INVALID_WORKER');
    var stores = [firstStore, firstStore === 6 ? 7 : 6];
    for (var index = 0; index < stores.length; index++) {
      storeId = stores[index];
      var claimed = call('claim', storeId, { workerId: workerId });
      posProductBackgroundRecord_(claimed, ['intake', 'operation', 'claimed']);
      if (typeof claimed.claimed !== 'boolean' || (claimed.operation !== null && !posProductBackgroundObject_(claimed.operation))) throw new Error('INVALID_CLAIM');
      if (!claimed.claimed) {
        if (claimed.intake !== null || claimed.operation !== null) throw new Error('INVALID_CLAIM');
        continue;
      }
      // 未署名・別店舗・壊れたleaseをPOSアクセスに利用しない。
      validatePosProductBackgroundIntake_(claimed.intake, storeId);
      intake = JSON.parse(posProductBackgroundCanonical_(claimed.intake));
      properties.setProperty('POS_PRODUCT_BACKGROUND_NEXT_STORE', storeId === 6 ? '7' : '6');
      if (claimed.operation !== null) {
        var operation = claimed.operation;
        if (operation.id !== intake.operation_id || operation.actor_id !== intake.actor_id || operation.store_id !== storeId ||
            operation.jan_code !== intake.jan_code || operation.product_id_snapshot !== intake.product_id ||
            !Number.isSafeInteger(operation.send_attempts) || operation.send_attempts < 0 ||
            operation.send_attempts > 1) {
          fail('POS_PRODUCT_EDIT_OUTCOME_UNKNOWN');
          return { processed: true, code: 'REVIEW_REQUIRED' };
        }
        if (operation.send_attempts === 1) {
          if (['dispatching', 'verifying', 'uncertain', 'pos_confirmed', 'db_pending'].indexOf(operation.status) < 0) {
            fail('POS_PRODUCT_EDIT_OUTCOME_UNKNOWN');
            return { processed: true, code: 'REVIEW_REQUIRED' };
          }
          recoveryRequired = true;
        }
      }
      break;
    }
    if (!intake) return { processed: false, code: 'EMPTY' };
    var session;
    try {
      readAllowed();
      session = createPosProductEditSession_(getPOSConfig_(), storeId, intake.jan_code, readAllowed, executionAllowed);
      session.before = session.inspect();
    } catch (_) {
      fail(recoveryRequired ? 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN' : 'POS_READ_FAILED');
      return { processed: true, code: recoveryRequired ? 'REVIEW_REQUIRED' : 'POS_READ_FAILED' };
    }
    if (recoveryRequired) {
      try {
        // send1は保存準備・consumeへ戻らない。元dispatchとの一致判定とDB反映だけを委ねる。
        var recovered = call('recover', storeId, { operationId: intake.operation_id, leaseToken: intake.lease_token,
          inspection: JSON.parse(posProductBackgroundCanonical_(session.before.data)) });
        validatePosProductBackgroundReceipt_(recovered, intake.operation_id, storeId);
        return { processed: true, code: recovered.status === 'completed' ? 'COMPLETED' : 'REVIEW_REQUIRED' };
      } catch (_) {
        fail('POS_PRODUCT_EDIT_OUTCOME_UNKNOWN');
        return { processed: true, code: 'REVIEW_REQUIRED' };
      }
    }
    var prepared;
    try {
      // フォーム・Cookie・画像opaqueは渡さず、照合用業務DTOのコピーだけを署名する。
      prepared = call('prepare', storeId, { operationId: intake.operation_id, leaseToken: intake.lease_token,
        inspection: JSON.parse(posProductBackgroundCanonical_(session.before.data)) });
      posProductBackgroundRecord_(prepared, ['operationId', 'actorId', 'storeId', 'dispatch', 'nextAction']);
      if (prepared.operationId !== intake.operation_id || prepared.actorId !== intake.actor_id || prepared.storeId !== storeId ||
          ['save', 'review'].indexOf(prepared.nextAction) < 0) throw new Error('INVALID_PREPARE');
      if (prepared.nextAction === 'review') {
        if (prepared.dispatch !== null) throw new Error('INVALID_PREPARE');
        return { processed: true, code: 'REVIEW_REQUIRED' };
      }
      var command = prepared.dispatch;
      posProductBackgroundRecord_(command, ['operationId', 'actorId', 'storeId', 'janCode', 'before', 'patch', 'expiresAt']);
      var fieldMap = { name: 'goodsName', price: 'gddGoodsPrice', cost: 'gddGoodsCost' }, expectedPatch = {};
      Object.keys(intake.patch).forEach(function(key) {
        // 受付基準との競合はNextが検査する。現在値と同じ入力は保存patchに追加しない。
        if (intake.patch[key] !== session.before.data.searches[1].formInspection.fields[key]) expectedPatch[fieldMap[key]] = intake.patch[key];
      });
      if (command.operationId !== intake.operation_id || command.actorId !== intake.actor_id || command.storeId !== storeId ||
          command.janCode !== intake.jan_code || posProductBackgroundCanonical_(command.patch) !== posProductBackgroundCanonical_(expectedPatch) ||
          posProductBackgroundCanonical_(command.before) !== posProductBackgroundCanonical_(session.before.data.searches[1].formInspection)) {
        throw new Error('INVALID_PREPARE');
      }
    } catch (_) {
      fail('POS_PREPARE_FAILED');
      return { processed: true, code: 'POS_PREPARE_FAILED' };
    }
    var result;
    try {
      current();
      var consumer = createPosProductEditConsumer_(properties);
      result = executePosProductEditWithSession_(getPOSConfig_(), prepared.dispatch, consumer, session);
    } catch (_) {
      fail('POS_PREPARE_FAILED');
      return { processed: true, code: 'POS_PREPARE_FAILED' };
    }
    try {
      var receipt = call('result', storeId, { operationId: intake.operation_id, leaseToken: intake.lease_token, result: result });
      validatePosProductBackgroundReceipt_(receipt, intake.operation_id, storeId);
      return { processed: true, code: result.outcome === 'values_verified' && receipt.status === 'completed' ? 'COMPLETED' : 'REVIEW_REQUIRED' };
    } catch (_) {
      // 結果通知消失は再保存の許可にしない。DBのsend_attemptsが後続実行を停止する。
      fail('WORKER_RESPONSE_FAILED');
      return { processed: true, code: 'WORKER_RESPONSE_FAILED' };
    }
  } catch (_) {
    fail('WORKER_RESPONSE_FAILED');
    return { processed: intake !== null, code: 'WORKER_RESPONSE_FAILED' };
  } finally { lock.releaseLock(); }
}

/** 固定Next URLへ各要求を一度だけ送る。転送先へ鍵・本文を渡さない。 */
function createPosProductBackgroundPort_(properties, assertCurrent) {
  var endpoint = 'https://kennel-dashboard.vercel.app/api/pos-products/background-worker';
  var secret = properties.getProperty('POS_PRODUCT_CONSUME_SECRET');
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
  function current() {
    assertCurrent();
    if (properties.getProperty('POS_PRODUCT_BACKGROUND_EDIT_ENABLED') !== 'true' ||
        properties.getProperty('POS_PRODUCT_CONSUME_SECRET') !== secret) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
  }
  return function(action, storeId, payload) {
    current();
    if (['claim', 'prepare', 'result', 'fail', 'recover'].indexOf(action) < 0 || (storeId !== 6 && storeId !== 7) || !posProductBackgroundObject_(payload)) {
      throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    }
    var issuedAt = Date.now(), requestId = Utilities.getUuid();
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !posProductBackgroundUuid_(requestId)) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    var request = { version: 1, audience: 'kennel.pos-product-background-worker.v1', action: action,
      requestId: requestId, storeId: storeId, issuedAt: issuedAt, expiresAt: issuedAt + 60000, payload: payload };
    request.signature = posProductHex_(Utilities.computeHmacSha256Signature(posProductBackgroundCanonical_(request), secret, Utilities.Charset.UTF_8));
    var body = posProductBackgroundCanonical_(request);
    if (body.length > 524288 || Utilities.newBlob(body).getBytes().length > 524288) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    var response = UrlFetchApp.fetch(endpoint, { method: 'post', contentType: 'application/json', payload: body,
      followRedirects: false, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    var headers = response.getHeaders(), contentType = headers['Content-Type'] || headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType)) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    var text = response.getContentText();
    if (typeof text !== 'string' || text.length > 524288 || Utilities.newBlob(text).getBytes().length > 524288) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    var parsed = JSON.parse(text);
    posProductBackgroundRecord_(parsed, ['version', 'audience', 'requestId', 'action', 'storeId', 'success', 'data', 'signature']);
    if (parsed.version !== 1 || parsed.audience !== 'kennel.pos-product-background-worker-response.v1' ||
        parsed.requestId !== requestId || parsed.action !== action || parsed.storeId !== storeId || typeof parsed.success !== 'boolean' ||
        (parsed.data !== null && !posProductBackgroundObject_(parsed.data)) || typeof parsed.signature !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.signature)) {
      throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    }
    var receivedSignature = parsed.signature;
    delete parsed.signature;
    var expected = posProductHex_(Utilities.computeHmacSha256Signature(posProductBackgroundCanonical_(parsed), secret, Utilities.Charset.UTF_8));
    var receivedAt = Date.now();
    if (!posProductEqualHex_(receivedSignature, expected) || !Number.isSafeInteger(receivedAt) || receivedAt < issuedAt || receivedAt >= request.expiresAt ||
        parsed.success !== true || parsed.data === null) throw new Error('POS_PRODUCT_BACKGROUND_PORT_UNAVAILABLE');
    current();
    return parsed.data;
  };
}

function validatePosProductBackgroundIntake_(intake, storeId) {
  if (!posProductBackgroundObject_(intake) || !posProductBackgroundUuid_(intake.operation_id) || !posProductBackgroundUuid_(intake.actor_id) ||
      !posProductBackgroundUuid_(intake.lease_token) || intake.store_id !== storeId || !Number.isSafeInteger(intake.product_id) || intake.product_id <= 0 ||
      typeof intake.jan_code !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(intake.jan_code) ||
      !posProductBackgroundObject_(intake.patch) || !posProductBackgroundObject_(intake.baseline)) throw new Error('INVALID_INTAKE');
  var keys = Object.keys(intake.patch);
  if (!keys.length || keys.length > 3 || keys.some(function(key) {
    return ['name', 'price', 'cost'].indexOf(key) < 0 || typeof intake.patch[key] !== 'string' || intake.patch[key].length > 1000;
  })) throw new Error('INVALID_INTAKE');
}

function validatePosProductBackgroundReceipt_(value, operationId, storeId) {
  posProductBackgroundRecord_(value, ['operationId', 'storeId', 'status']);
  if (value.operationId !== operationId || value.storeId !== storeId ||
      ['queued', 'working', 'needs_review', 'completed', 'cancelled'].indexOf(value.status) < 0) throw new Error('INVALID_WORKER_RECEIPT');
}

function posProductBackgroundUuid_(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function posProductBackgroundObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function posProductBackgroundRecord_(value, keys) {
  if (!posProductBackgroundObject_(value) || Object.keys(value).length !== keys.length || keys.some(function(key) {
    return !Object.prototype.hasOwnProperty.call(value, key);
  })) throw new Error('INVALID_WORKER_RECORD');
}

function posProductBackgroundCanonical_(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(posProductBackgroundCanonical_).join(',') + ']';
  if (!posProductBackgroundObject_(value)) throw new Error('INVALID_WORKER_VALUE');
  return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + posProductBackgroundCanonical_(value[key]);
  }).join(',') + '}';
}

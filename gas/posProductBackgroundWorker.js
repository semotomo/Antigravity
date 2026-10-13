/**
 * 所有者の時間主導実行用。フラグは既定OFFで、トリガーを作成しない。
 * 1実行につき最大1受付だけ処理し、本文・鍵・POS認証情報を記録しない。
 */
function runPosProductBackgroundWorker() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('POS_PRODUCT_BACKGROUND_EDIT_ENABLED') !== 'true') return { processed: false, code: 'DISABLED' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1)) return { processed: false, code: 'BUSY' };
  var startedAt = Date.now(), reservation = null, result = null;
  try {
    reservation = beginPosProductBackgroundHealth_(properties, startedAt);
    result = reservation.paused ? { processed: false, code: 'BUDGET_PAUSED' }
      : executePosProductBackgroundJob_(properties, startedAt);
    return result;
  } finally {
    try {
      if (reservation) finishPosProductBackgroundHealth_(properties, reservation, result, Date.now());
    } finally { lock.releaseLock(); }
  }
}

/** 時間トリガー専用。固定エラーだけを投げ、GASの失敗通知を有効にする。 */
function runScheduledPosProductBackgroundWorker() {
  var result;
  try { result = runPosProductBackgroundWorker(); }
  catch (_) { throw new Error('POS_PRODUCT_BACKGROUND_ATTENTION_REQUIRED'); }
  if (['WORKER_RESPONSE_FAILED', 'POS_READ_FAILED', 'POS_PREPARE_FAILED', 'REVIEW_REQUIRED', 'EXECUTION_DISABLED', 'BUDGET_PAUSED'].indexOf(result.code) >= 0) {
    throw new Error('POS_PRODUCT_BACKGROUND_ATTENTION_REQUIRED');
  }
  return result;
}

/** 既存の保存・再送制御は監視処理と分離し、同じScriptLock内で実行する。 */
function executePosProductBackgroundJob_(properties, startedAt) {
  var intake = null, storeId = null, call = null, recoveryRequired = false;
  function current() {
    // 新たな通信開始を5分までに制限し、6分上限の結果通知用余裕を残す。
    if (Date.now() - startedAt >= 300000 || properties.getProperty('POS_PRODUCT_BACKGROUND_EDIT_ENABLED') !== 'true') {
      throw new Error('POS_PRODUCT_BACKGROUND_STOPPED');
    }
  }
  function readAllowed() {
    current();
    if (properties.getProperty('POS_PRODUCT_INSPECTION_ENABLED') !== 'true') throw new Error('POS_PRODUCT_BACKGROUND_READ_DISABLED');
    if (intake && !recoveryRequired && posProductBackgroundClassJob_(intake) &&
        properties.getProperty('POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED') !== 'true') throw new Error('CLASSIFICATION_DISABLED');
  }
  function executionAllowed() {
    current();
    return properties.getProperty('POS_PRODUCT_INSPECTION_ENABLED') === 'true' &&
      properties.getProperty('POS_PRODUCT_CONSUME_ENABLED') === 'true' &&
      (!posProductBackgroundClassJob_(intake) || properties.getProperty('POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED') === 'true');
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
      // 停止中もsend1の読取り復旧に対応できる能力を、署名payloadへ固定する。
      var claimed = call('claim', storeId, { workerId: workerId, classificationCapable: true });
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
    if (!recoveryRequired && posProductBackgroundClassJob_(intake) &&
        properties.getProperty('POS_PRODUCT_BACKGROUND_CLASSIFICATION_ENABLED') !== 'true') {
      fail('POS_CLASSIFICATION_DISABLED');
      return { processed: true, code: 'REVIEW_REQUIRED' };
    }
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
      validatePosProductBackgroundClassification_(intake, session.before.data.searches[1].formInspection);
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
      var fieldMap = { name: 'goodsName', price: 'gddGoodsPrice', cost: 'gddGoodsCost', groupId: 'goodsGroup', supplierId: 'gddSupplierCd' }, expectedPatch = {};
      Object.keys(intake.patch).forEach(function(key) {
        // 受付基準との競合はNextが検査する。現在値と同じ入力は保存patchに追加しない。
        if (intake.patch[key] !== session.before.data.searches[1].formInspection.fields[key]) expectedPatch[fieldMap[key]] = intake.patch[key] === null ? '' : intake.patch[key];
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
  }
}

/** 過去24時間の予約を含む実時間。破損・時計逆行・履歴過大は推測で初期化しない。 */
function readPosProductBackgroundHealth_(properties, now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
  var raw = properties.getProperty('POS_PRODUCT_BACKGROUND_WORKER_HEALTH');
  if (raw === null) return { version: 1, runs: [], last: null };
  if (typeof raw !== 'string' || raw.length > 8000) throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
  var state;
  try { state = JSON.parse(raw); } catch (_) { throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID'); }
  posProductBackgroundRecord_(state, ['version', 'runs', 'last']);
  if (state.version !== 1 || !Array.isArray(state.runs) || state.runs.length > 300) throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
  state.runs.forEach(function(run) {
    if (!Array.isArray(run) || run.length !== 2 || !Number.isSafeInteger(run[0]) || run[0] < 0 || run[0] > now ||
        !Number.isSafeInteger(run[1]) || run[1] < 0 || run[1] > 360000) throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
  });
  if (state.last !== null) {
    posProductBackgroundRecord_(state.last, ['startedAt', 'completedAt', 'durationMs', 'code', 'processed']);
    var last = state.last;
    if (!Number.isSafeInteger(last.startedAt) || last.startedAt < 0 || last.startedAt > now || typeof last.processed !== 'boolean' ||
        ['RUNNING', 'EMPTY', 'COMPLETED', 'REVIEW_REQUIRED', 'WORKER_RESPONSE_FAILED', 'POS_READ_FAILED', 'POS_PREPARE_FAILED', 'EXECUTION_DISABLED', 'BUDGET_PAUSED'].indexOf(last.code) < 0 ||
        (last.code === 'RUNNING' ? last.completedAt !== null || last.durationMs !== null :
          !Number.isSafeInteger(last.completedAt) || last.completedAt < last.startedAt || last.completedAt > now ||
          !Number.isSafeInteger(last.durationMs) || last.durationMs !== last.completedAt - last.startedAt)) {
      throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
    }
  }
  // 実行開始直前の6分を予約。途中で強制終了してfinallyが動かなくても消費を忘れない。
  // 強制終了の実終了時刻は不明なので、6分余分に保持して24h境界で過小計上しない。
  state.runs = state.runs.filter(function(run) { return run[0] > now - 86760000; });
  return state;
}

function beginPosProductBackgroundHealth_(properties, startedAt) {
  var state = readPosProductBackgroundHealth_(properties, startedAt);
  var used = state.runs.reduce(function(sum, run) { return sum + run[1]; }, 0);
  var paused = used + 360000 > 2700000 || state.runs.length >= 300;
  if (!paused) state.runs.push([startedAt, 360000]);
  state.last = { startedAt: startedAt, completedAt: null, durationMs: null, code: 'RUNNING', processed: false };
  var raw = JSON.stringify(state);
  if (raw.length > 8000) throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
  properties.setProperty('POS_PRODUCT_BACKGROUND_WORKER_HEALTH', raw);
  return { state: state, raw: raw, startedAt: startedAt, paused: paused };
}

function finishPosProductBackgroundHealth_(properties, reservation, result, completedAt) {
  if (!Number.isSafeInteger(completedAt) || completedAt < reservation.startedAt || completedAt - reservation.startedAt > 360000 ||
      properties.getProperty('POS_PRODUCT_BACKGROUND_WORKER_HEALTH') !== reservation.raw) {
    throw new Error('POS_PRODUCT_BACKGROUND_HEALTH_INVALID');
  }
  var state = reservation.state, duration = completedAt - reservation.startedAt;
  if (!reservation.paused) state.runs[state.runs.length - 1][1] = duration;
  state.last = { startedAt: reservation.startedAt, completedAt: completedAt, durationMs: duration,
    code: result ? result.code : 'WORKER_RESPONSE_FAILED', processed: result ? result.processed : false };
  var raw = JSON.stringify(state);
  // 固定summary以外（商品名・JAN・操作ID・鍵・例外本文）は記録しない。
  readPosProductBackgroundHealth_({ getProperty: function() { return raw; } }, completedAt);
  properties.setProperty('POS_PRODUCT_BACKGROUND_WORKER_HEALTH', raw);
  logPosProductBackgroundHealth_(state.last);
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
  if (!keys.length || keys.length > 5 || keys.some(function(key) {
    return ['name', 'price', 'cost', 'groupId', 'supplierId'].indexOf(key) < 0 ||
      (key === 'supplierId' && intake.patch[key] === null ? false : typeof intake.patch[key] !== 'string' || intake.patch[key].length > 1000);
  })) throw new Error('INVALID_INTAKE');
  validatePosProductBackgroundClassification_(intake, null);
}

function posProductBackgroundClassJob_(intake) {
  return intake && (Object.prototype.hasOwnProperty.call(intake.patch, 'groupId') || Object.prototype.hasOwnProperty.call(intake.patch, 'supplierId'));
}

/** 受付のID/表示名とfresh候補を照合し、同名候補や欠落を先頭候補で補わない。 */
function validatePosProductBackgroundClassification_(intake, inspection) {
  function reject() { throw new Error('INVALID_CLASSIFICATION'); }
  function choice(value) {
    posProductBackgroundRecord_(value, ['id', 'name']);
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.id) || typeof value.name !== 'string' ||
        !value.name || value.name.length > 1000 || value.name.trim() !== value.name || /[\x00-\x1f\x7f]/.test(value.name)) reject();
    return value;
  }
  if (!posProductBackgroundClassJob_(intake)) {
    if (intake.catalog_snapshot_id != null || intake.pos_choice_baseline != null) reject();
    return;
  }
  if (!posProductBackgroundUuid_(intake.catalog_snapshot_id)) reject();
  var baseline = intake.pos_choice_baseline;
  posProductBackgroundRecord_(baseline, ['groupId', 'groupName', 'supplierId', 'supplierName', 'requested']);
  choice({ id: baseline.groupId, name: baseline.groupName });
  if (baseline.supplierId === null) { if (baseline.supplierName !== null) reject(); }
  else choice({ id: baseline.supplierId, name: baseline.supplierName });
  var keys = ['groupId', 'supplierId'].filter(function(key) { return Object.prototype.hasOwnProperty.call(intake.patch, key); });
  posProductBackgroundRecord_(baseline.requested, keys);
  keys.forEach(function(key) {
    if (key === 'supplierId' && intake.patch[key] === null) { if (baseline.requested[key] !== null) reject(); }
    else if (choice(baseline.requested[key]).id !== intake.patch[key]) reject();
  });
  if (!inspection) return;
  [inspection.groups, inspection.suppliers].forEach(function(catalog) {
    if (!Array.isArray(catalog) || catalog.length > 5000) reject();
    var ids = {}, names = {};
    catalog.forEach(function(raw) {
      var item = choice(raw);
      if (Object.prototype.hasOwnProperty.call(ids, item.id) || Object.prototype.hasOwnProperty.call(names, item.name)) reject();
      Object.defineProperty(ids, item.id, { value: true }); Object.defineProperty(names, item.name, { value: true });
    });
  });
  keys.forEach(function(key) {
    if (inspection.fields[key] !== baseline[key]) reject();
    var catalog = key === 'groupId' ? inspection.groups : inspection.suppliers;
    if (baseline[key] !== null && (!catalog.some(function(item) { return item.id === baseline[key] && item.name === baseline[key === 'groupId' ? 'groupName' : 'supplierName']; }))) reject();
    if (baseline.requested[key] !== null && !catalog.some(function(item) { return item.id === baseline.requested[key].id && item.name === baseline.requested[key].name; })) reject();
  });
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

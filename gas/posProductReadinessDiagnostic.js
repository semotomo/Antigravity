/** 所有者がScript Editorで手動実行する本店CSV診断。Web App/トリガーへ接続しない。 */
function diagnoseHontenProductMasterReadiness() {
  var result = { success: false, stage: 'CONFIG', code: 'READINESS_CONFIG_INVALID', mutationFlagsOff: false,
    keyReadiness: { signingSecretValid: false, consumeSecretValid: false, masterSyncSecretValid: false,
      secretsDistinct: false, serviceKeyPresent: false } };
  try {
    var properties = PropertiesService.getScriptProperties();
    var keys = ['POS_PRODUCT_SIGNING_SECRET', 'POS_PRODUCT_CONSUME_SECRET', 'POS_PRODUCT_MASTER_SYNC_SECRET']
      .map(function(name) { return properties.getProperty(name); });
    var valid = keys.map(function(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); });
    result.keyReadiness.signingSecretValid = valid[0];
    result.keyReadiness.consumeSecretValid = valid[1];
    result.keyReadiness.masterSyncSecretValid = valid[2];
    result.keyReadiness.secretsDistinct = valid.every(function(value) { return value; }) &&
      keys[0] !== keys[1] && keys[0] !== keys[2] && keys[1] !== keys[2];
    var serviceKey = properties.getProperty('SUPABASE_SERVICE_ROLE_KEY');
    result.keyReadiness.serviceKeyPresent = typeof serviceKey === 'string' && serviceKey.trim().length > 0;
    result.stage = 'FLAGS';
    result.mutationFlagsOff = ['POS_PRODUCT_EDIT_GATEWAY_ENABLED', 'POS_PRODUCT_EDIT_EXECUTION_ENABLED',
      'POS_PRODUCT_CONSUME_ENABLED', 'POS_PRODUCT_MASTER_SYNC_ENABLED', 'POS_PRODUCT_SYNC_FENCE_ENABLED']
      .every(function(name) { var value = properties.getProperty(name); return value === null || value === 'false'; });
    if (!result.mutationFlagsOff) result.code = 'READINESS_FLAGS_ACTIVE';
    else if (!Object.keys(result.keyReadiness).every(function(name) { return result.keyReadiness[name]; })) {
      result.stage = 'KEYS'; result.code = 'READINESS_KEYS_INVALID';
    } else {
      result.stage = 'CONFIG';
      var config = getPOSConfig_();
      if (config && config.baseUrl === 'https://cg8.power-k.jp/0D890OGI' && config.tenpoGroupId === '11098' &&
          typeof config.tenpoGroupName === 'string' && config.tenpoGroupName.indexOf('本店') !== -1 &&
          ['loginId', 'password', 'companyCd'].every(function(name) { return typeof config[name] === 'string' && config[name].trim().length > 0; }) &&
          typeof config.companyKey === 'string') {
        result.stage = 'CSV'; result.code = 'READINESS_CSV_FAILED';
        // 同期IDを渡さず、既存の診断分岐でDB受付・Drive保存・商品適用前に終了する。
        var source = downloadProductMasterFromPOS_(config, '本店', { dryRun: true });
        if (source && source.success === true && source.dryRun === true && source.syncResult === null) {
          result.code = 'READINESS_CSV_INVALID';
          var counts = posProductReadinessCounts_(source.diagnostics, source.csvRowCount);
          result.storeConsistency = counts.storeConsistency;
          result.csv = counts.csv;
          if (!counts.storeConsistency.allExpectedStore) result.code = 'READINESS_STORE_MISMATCH';
          else { result.success = true; result.stage = 'COMPLETE'; result.code = 'READINESS_CSV_INSPECTED'; }
        }
      }
    }
  } catch (_) {
    // 元例外には資格情報やHTMLが含まれ得るため、固定工程・固定コードだけを残す。
  }
  Logger.log('KENNEL_POS_MASTER_READINESS ' + JSON.stringify(result));
  return result;
}

function posProductReadinessCount_(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error('READINESS_CSV_INVALID');
  return value;
}

function posProductReadinessRecord_(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('READINESS_CSV_INVALID');
  return value;
}

function posProductReadinessMap_(value, maximum, keyAllowed) {
  posProductReadinessRecord_(value);
  var output = Object.create(null);
  Object.keys(value).forEach(function(key) {
    if (!keyAllowed(key)) throw new Error('READINESS_CSV_INVALID');
    output[key] = posProductReadinessCount_(value[key], maximum);
  });
  return output;
}

function posProductReadinessCounts_(diagnostics, validRowCount) {
  posProductReadinessRecord_(diagnostics);
  var raw = posProductReadinessCount_(diagnostics.rawRowCount, 1000000);
  var valid = posProductReadinessCount_(validRowCount, raw);
  var skipped = posProductReadinessCount_(diagnostics.skippedRowCount, raw);
  if (valid + skipped !== raw || !Array.isArray(diagnostics.storeSummary) || !Array.isArray(diagnostics.columnStats)) {
    throw new Error('READINESS_CSV_INVALID');
  }
  var store = { storeCount: diagnostics.storeSummary.length, matchingStoreCount: 0, mismatchingStoreCount: 0,
    rowCount: 0, allExpectedStore: false };
  diagnostics.storeSummary.forEach(function(item) {
    posProductReadinessRecord_(item);
    store.rowCount += posProductReadinessCount_(item.rowCount, raw);
    if (item.storeCode === '11053' && item.storeName === 'からつケンネル本店') store.matchingStoreCount++;
    else store.mismatchingStoreCount++;
  });
  if (store.rowCount !== raw) throw new Error('READINESS_CSV_INVALID');
  store.allExpectedStore = store.storeCount === 1 && store.matchingStoreCount === 1 && store.mismatchingStoreCount === 0;
  var columnCounts = [3, 7].map(function(index) {
    var matching = diagnostics.columnStats.filter(function(item) { return item && item.columnIndex === index; });
    if (matching.length !== 1) throw new Error('READINESS_CSV_INVALID');
    var item = matching[0];
    var nonEmpty = posProductReadinessCount_(item.nonEmptyCount, raw);
    return { columnIndex: index, nonEmptyCount: nonEmpty,
      uniqueCount: posProductReadinessCount_(item.uniqueCount, nonEmpty),
      janLikeCount: posProductReadinessCount_(item.janLikeCount, nonEmpty) };
  });
  var numericColumn = function(key) { return /^(0|[1-9]\d{0,3})$/.test(key) && Number(key) <= 4096; };
  var widths = posProductReadinessMap_(diagnostics.rowWidthCounts, raw, numericColumn);
  if (Object.keys(widths).reduce(function(total, key) { return total + widths[key]; }, 0) !== raw) {
    throw new Error('READINESS_CSV_INVALID');
  }
  var safetySource = posProductReadinessRecord_(diagnostics.syncSafety), safety = {};
  ['duplicateGroups', 'duplicateExtraRows', 'identicalRowGroups', 'conflictingRowGroups', 'mixedKindGroups',
    'missingJanRows', 'missingNameRows', 'shortRows', 'invalidMoneyRows'].forEach(function(name) {
    safety[name] = posProductReadinessCount_(safetySource[name], raw);
  });
  safety.rowsByKind = posProductReadinessMap_(safetySource.rowsByKind, raw,
    function(key) { return ['1', '2', '3', 'unknown'].indexOf(key) !== -1; });
  safety.differingColumns = posProductReadinessMap_(safetySource.differingColumns, safety.duplicateGroups, numericColumn);
  if (safety.identicalRowGroups + safety.conflictingRowGroups !== safety.duplicateGroups ||
      safety.mixedKindGroups > safety.duplicateGroups ||
      Object.keys(safety.rowsByKind).reduce(function(total, key) { return total + safety.rowsByKind[key]; }, 0) !== raw) {
    throw new Error('READINESS_CSV_INVALID');
  }
  var profileSource = posProductReadinessRecord_(safetySource.duplicateProfile);
  var kindKeys = ['1', '2', '3', 'unknown', 'mixed'], transformKeys = ['whitespace', 'fullWidthDigits', 'trailingDotZero'];
  var profile = {
    groupsByKind: posProductReadinessMap_(profileSource.groupsByKind, safety.duplicateGroups,
      function(key) { return kindKeys.indexOf(key) !== -1; }),
    groupSizeCounts: posProductReadinessMap_(profileSource.groupSizeCounts, safety.duplicateGroups,
      function(key) { return /^[1-9]\d{0,6}$/.test(key) && Number(key) >= 2 && Number(key) <= raw; }),
    rawIdenticalGroups: posProductReadinessCount_(profileSource.rawIdenticalGroups, safety.duplicateGroups),
    normalizedVariantGroups: posProductReadinessCount_(profileSource.normalizedVariantGroups, safety.duplicateGroups),
    transformAffectedGroups: posProductReadinessMap_(profileSource.transformAffectedGroups, safety.duplicateGroups,
      function(key) { return transformKeys.indexOf(key) !== -1; }),
  };
  var sum = function(map) { return Object.keys(map).reduce(function(total, key) { return total + map[key]; }, 0); };
  if (Object.keys(profile.groupsByKind).length !== kindKeys.length ||
      Object.keys(profile.transformAffectedGroups).length !== transformKeys.length ||
      sum(profile.groupsByKind) !== safety.duplicateGroups || profile.groupsByKind.mixed !== safety.mixedKindGroups ||
      sum(profile.groupSizeCounts) !== safety.duplicateGroups ||
      safety.duplicateGroups + safety.duplicateExtraRows > raw - safety.missingJanRows ||
      Object.keys(profile.groupSizeCounts).some(function(size) { return profile.groupSizeCounts[size] === 0; }) ||
      kindKeys.slice(0, 4).some(function(kind) { return profile.groupsByKind[kind] * 2 > (safety.rowsByKind[kind] || 0); }) ||
      Object.keys(profile.groupSizeCounts).reduce(function(total, size) {
        return total + (Number(size) - 1) * profile.groupSizeCounts[size];
      }, 0) !== safety.duplicateExtraRows ||
      profile.rawIdenticalGroups + profile.normalizedVariantGroups !== safety.duplicateGroups ||
      profile.normalizedVariantGroups > sum(profile.transformAffectedGroups)) {
    throw new Error('READINESS_CSV_INVALID');
  }
  safety.duplicateProfile = profile;
  return { storeConsistency: store, csv: { rawRowCount: raw, validRowCount: valid, skippedRowCount: skipped,
    columnCounts: columnCounts, rowWidthCounts: widths, syncSafety: safety } };
}

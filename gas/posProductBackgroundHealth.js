/** workerの業務本文を受け取らず、検証済み固定summaryだけを記録する。 */
function logPosProductBackgroundHealth_(last) {
  var raw = JSON.stringify({ version: 1, runs: [], last: last });
  readPosProductBackgroundHealth_({ getProperty: function() { return raw; } }, Date.now());
  Logger.log('KENNEL_POS_BACKGROUND_HEALTH ' + JSON.stringify(last));
}

/** 管理者の手動読取り専用。商品・受付・トリガーを変更しない。 */
function showPosProductBackgroundWorkerHealth() {
  var properties = PropertiesService.getScriptProperties(), now = Date.now();
  var state = readPosProductBackgroundHealth_(properties, now);
  var summary = { enabled: properties.getProperty('POS_PRODUCT_BACKGROUND_EDIT_ENABLED') === 'true', last: state.last,
    chargedRuntimeMs: state.runs.reduce(function(sum, run) { return sum + run[1]; }, 0), budgetLimitMs: 2700000 };
  Logger.log('KENNEL_POS_BACKGROUND_STATUS ' + JSON.stringify(summary));
  return summary;
}

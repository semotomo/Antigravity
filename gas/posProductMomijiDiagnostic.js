/**
 * 所有者エディタ専用。本店の指定商品を読み、保存前の組立条件だけを確認する。
 * 保存本文はGAS内で破棄する。保存受付・DB更新・公開入口には接続しない。
 * 現在フォームの診断であり、保留中の操作やその送信前DTOの検証ではない。
 */
function diagnoseHontenMomijiEditPreparation() {
  var startedAt = Date.now(), phase = 'ARGUMENT_CHECK';
  var report = { success: false, code: 'UNEXPECTED_ERROR', phase: phase,
    storeId: 7, janCode: '4582107173062', completedSearches: 0, preparedCount: 0,
    productSaveSent: false, consumeCalled: false, heldOperationVerified: false,
    forms: [], phases: [] };
  var readPhases = ['LOGIN_GET', 'LOGIN_PAYLOAD', 'LOGIN_ACTION', 'LOGIN_POST', 'LIST_GET',
    'SEARCH_PAYLOAD', 'SEARCH_POST', 'SEARCH_PARSE', 'DETAIL_POST', 'EDIT_POST', 'EDIT_PARSE'];
  var localPhases = ['ARGUMENT_CHECK', 'CONFIG_READ', 'INSPECTION_PARSE', 'TARGET_CHECK',
    'SUBMISSION_PARSE', 'IMAGE_GUARD', 'SEARCH_COMPARE', 'IMAGE_COMPARE', 'INSPECTION_COMPARE',
    'BASELINE_CHECK', 'SUBMISSION_BUILD', 'COMPLETE'];
  var formPhases = ['CONTRACT', 'FORM_ATTRIBUTES', 'FORM_ACTION', 'CONTROL_SCAN', 'CONTROL_ATTRIBUTES',
    'SELECT_OPTIONS', 'SELECT_VALUE', 'CONTROL_VALUE', 'CONTROL_DUPLICATE', 'SAVE_CONTROL', 'IDENTITY',
    'CATALOG_VALUES', 'TAX_ID', 'CATALOG_SELECTION', 'GENERATED_FRAMEWORK_STATE',
    'GENERATED_FRAMEWORK_STATE_SCAN', 'GENERATED_FRAMEWORK_STATE_SCRIPT_CANDIDATES',
    'GENERATED_FRAMEWORK_STATE_FORM_REFERENCES', 'GENERATED_FRAMEWORK_STATE_SCRIPT_ATTRIBUTES',
    'GENERATED_FRAMEWORK_STATE_SCRIPT_GRAMMAR', 'GENERATED_FRAMEWORK_STATE_MARKUP',
    'GENERATED_FRAMEWORK_STATE_STATE_VALUE'];
  ['goodsId-30', 'goodsSalesKbn', 'gdsPublicGoodsCd', 'gdsManufacturerPartNumber', 'tenpoGroup',
    'tenpoGroupHid', 'goodsGroup', 'gddSupplierCd', 'goodsTax', 'goodsName', 'goodsNameKana',
    'abbreviateGoodsName', 'gddGoodsPrice', 'gddGoodsCost'].forEach(function(key) {
    formPhases.push('FIELD_' + key.replace(/-/g, '_').toUpperCase());
  });
  ['gdsGoodsPriceFlg', 'gddPriceInputFlg', 'gdsSupplierFlg'].forEach(function(key) {
    formPhases.push('RADIO_' + key.toUpperCase());
  });
  // parserが付ける属性重複の分類も固定列挙だけを許可する。
  ['CONTRACT', 'FORM_ATTRIBUTES', 'CONTROL_ATTRIBUTES', 'SELECT_OPTIONS',
    'GENERATED_FRAMEWORK_STATE_SCRIPT_ATTRIBUTES', 'GENERATED_FRAMEWORK_STATE_MARKUP'].forEach(function(parent) {
    ['ID', 'NAME', 'TYPE', 'VALUE', 'CHECKED', 'SELECTED', 'DISABLED', 'READONLY', 'ONCLICK', 'ONCHANGE', 'OTHER'].forEach(function(attribute) {
      formPhases.push(parent + '_DUPLICATE_' + attribute);
    });
  });
  var knownCodes = ['INVALID_POS_READ_TARGET', 'INVALID_POS_READ_HTML', 'INVALID_POS_READ_REDIRECT', 'POS_READ_HTTP_FAILURE',
    'POS_READ_REDIRECT_LIMIT', 'POS_LOGIN_ACTION_MISSING', 'POS_SEARCH_COUNT_UNKNOWN', 'POS_SEARCH_NOT_UNIQUE',
    'POS_READ_IDENTITY_MISMATCH', 'UNEXPECTED_POS_READ_URL', 'UNEXPECTED_POS_READ_FORM',
    'POS_READ_ACTION_MISSING', 'POS_READ_FIELD_MISSING', 'POS_WRITE_ACTION_FORBIDDEN',
    'POS_PRODUCT_FORM_REJECTED', 'POS_PRODUCT_FORM_REJECTED_STATE_COUNTS', 'POS_PRODUCT_SUBMISSION_REJECTED',
    'MOMIJI_DIAGNOSTIC_ARGUMENTS_REJECTED', 'MOMIJI_TARGET_REJECTED', 'MOMIJI_IMAGE_GUARD_REJECTED',
    'MOMIJI_SEARCH_COMPARE_REJECTED', 'MOMIJI_IMAGE_COMPARE_REJECTED', 'MOMIJI_INSPECTION_COMPARE_REJECTED',
    'MOMIJI_BASELINE_CHANGED', 'MOMIJI_PHASE_REJECTED'];
  formPhases.forEach(function(value) { knownCodes.push('POS_PRODUCT_FORM_REJECTED_' + value); });
  function reject(code) { throw new Error(code); }
  function stage(value) {
    if (readPhases.indexOf(value) < 0 && localPhases.indexOf(value) < 0) reject('MOMIJI_PHASE_REJECTED');
    phase = value;
    report.phase = value;
    var progress = { phase: value, elapsedMs: Math.max(0, Date.now() - startedAt) };
    report.phases.push(progress);
    Logger.log('KENNEL_POS_MOMIJI_DIAGNOSTIC_STAGE ' + JSON.stringify(progress));
  }
  // 比較はprivate内だけ。業務値・hidden・画像名・指紋はログへ渡さない。
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + canonical(value[key]);
    }).join(',') + '}';
  }
  var privateForms = [];
  try {
    stage('ARGUMENT_CHECK');
    if (arguments.length !== 0) reject('MOMIJI_DIAGNOSTIC_ARGUMENTS_REJECTED');
    stage('CONFIG_READ');
    var result = posReadDiagnostic_(getPOSConfig_(), 7, '4582107173062', stage, function(html, storeId, jan) {
      var counts = { searchNumber: report.forms.length + 1 };
      report.forms.push(counts);
      stage('INSPECTION_PARSE');
      var inspection = readPosProductEditForm_(html, storeId, jan);
      stage('TARGET_CHECK');
      if (storeId !== 7 || jan !== '4582107173062' || inspection.identity.officeId !== '11053' ||
          inspection.identity.groupId !== '11098' || inspection.identity.salesKind !== 'retail' ||
          inspection.identity.exclusiveStore !== true || inspection.identity.productCode !== jan ||
          inspection.identity.manufacturerCode !== jan) reject('MOMIJI_TARGET_REJECTED');
      // 補助件数の取得失敗で、本体parserの停止工程を隠さない。
      try { counts.frameworkState = posReadSubmissionStateCounts_(html, []); }
      catch (_) { counts.frameworkStateUnavailable = true; }
      stage('SUBMISSION_PARSE');
      var parsed = parsePosProductEditForm_(html, storeId, jan, true);
      counts.frameworkState = posReadSubmissionStateCounts_(html, parsed.submission.entries);
      counts.successfulControlCount = parsed.submission.entries.length;
      counts.emptyFilePartCount = parsed.submission.entries.filter(function(entry) { return entry.file; }).length;
      counts.updateActionCount = parsed.submission.entries.filter(function(entry) {
        return entry.name === 'includeChildBody:hmma02403Form:doUpdate';
      }).length;
      stage('IMAGE_GUARD');
      var imageKeys = ['imageFileName', 'thumbnailImageUrl-30', 'imageFileCnt-30', 'delImageFileUrl', 'goodsImageItemsSave'];
      var imageControls = imageKeys.reduce(function(all, key) { return all.concat(parsed.submission.controls[key] || []); }, []);
      var imageEntries = parsed.submission.entries.filter(function(entry) { return imageKeys.indexOf(entry.key) >= 0; });
      counts.imageControlCount = imageControls.length;
      counts.imageEntryCount = imageEntries.length;
      counts.imageTypeIsHidden = imageControls.length > 0 && imageControls.every(function(control) { return control.type === 'hidden'; });
      var imageState;
      try { imageState = readPosProductImageState_(parsed); }
      catch (_) { reject('MOMIJI_IMAGE_GUARD_REJECTED'); }
      counts.imageValueMatches = true;
      counts.imageContract = imageState.family;
      privateForms.push({ html: html, inspection: parsed.inspection, image: JSON.stringify(imageState) });
      report.completedSearches++;
      return inspection;
    });
    stage('SEARCH_COMPARE');
    if (result.storeId !== 7 || result.janCode !== '4582107173062' || result.searches.length !== 2 ||
        privateForms.length !== 2 || result.searches.some(function(search, index) {
          return search.field !== ['schGoodsId', 'schMakerCd'][index] || search.count !== 1 || !search.inspected ||
            !search.internalIdPresent || search.internalId !== privateForms[index].inspection.identity.posProductId;
        })) reject('MOMIJI_SEARCH_COMPARE_REJECTED');
    stage('IMAGE_COMPARE');
    report.imageValuesMatch = privateForms[0].image === privateForms[1].image;
    if (!report.imageValuesMatch) reject('MOMIJI_IMAGE_COMPARE_REJECTED');
    stage('INSPECTION_COMPARE');
    report.identicalInspections = canonical(privateForms[0].inspection) === canonical(privateForms[1].inspection) &&
      result.searches.every(function(search, index) { return canonical(search.formInspection) === canonical(privateForms[index].inspection); });
    if (!report.identicalInspections) reject('MOMIJI_INSPECTION_COMPARE_REJECTED');
    stage('BASELINE_CHECK');
    var before = privateForms[1].inspection;
    report.baselineMatchesApproved = before.fields.name === '95ミツヤ もみじ焼き' && before.fields.price === '199' && before.fields.cost === '95';
    if (!report.baselineMatchesApproved) reject('MOMIJI_BASELINE_CHANGED');
    stage('SUBMISSION_BUILD');
    var prepared = buildPosProductEditSubmission_(privateForms[1].html, 7, '4582107173062', before,
      { goodsName: 'ミツヤ もみじ焼き', gddGoodsPrice: '200', gddGoodsCost: '100' });
    report.encoding = prepared.contentType.split(';')[0];
    report.preparedCount = 1;
    report.success = true;
    report.code = 'MOMIJI_EDIT_PREPARATION_INSPECTED';
    stage('COMPLETE');
  } catch (error) {
    var code = error && error.message;
    report.code = knownCodes.indexOf(code) >= 0 ? code : 'UNEXPECTED_ERROR';
    report.success = false;
  }
  report.elapsedMs = Math.max(0, Date.now() - startedAt);
  Logger.log('KENNEL_POS_MOMIJI_DIAGNOSTIC ' + JSON.stringify(report));
  return report;
}

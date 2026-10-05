/**
 * 所有者がScript Editorから手動実行する読取り診断。Web App/トリガーへ接続しない。
 * 対象は実画面で確認済みの本店JAN。保存・削除・CSV出力・DB/Drive書込みは行わない。
 */
function diagnoseHontenProductReadContract() {
  var stage = 'CONFIG';
  try {
    var result = posReadDiagnostic_(getPOSConfig_(), 7, '4902397868767', function(next) {
      // 固定工程名以外の値をログへ持ち込まない。
      stage = /^(LOGIN_GET|LOGIN_PAYLOAD|LOGIN_ACTION|LOGIN_POST|LIST_GET|SEARCH_PAYLOAD|SEARCH_POST|SEARCH_PARSE|DETAIL_POST|EDIT_POST|EDIT_PARSE)$/.test(next) ? next : 'UNKNOWN';
    });
    Logger.log(JSON.stringify(result));
    return result;
  } catch (error) {
    // 通信例外にはCookieやHTMLが含まれる可能性があるため、原文をログに残さない。
    var allowed = ['UNEXPECTED_POS_READ_URL', 'INVALID_POS_READ_HTML', 'UNEXPECTED_POS_READ_FORM',
      'POS_WRITE_ACTION_FORBIDDEN', 'POS_READ_ACTION_MISSING', 'POS_READ_FIELD_MISSING',
      'INVALID_POS_READ_TARGET', 'INVALID_POS_READ_REDIRECT', 'POS_READ_HTTP_FAILURE',
      'POS_READ_REDIRECT_LIMIT', 'POS_LOGIN_ACTION_MISSING', 'POS_SEARCH_COUNT_UNKNOWN',
      'POS_SEARCH_NOT_UNIQUE', 'POS_READ_IDENTITY_MISMATCH'];
    var code = error && allowed.indexOf(error.message) !== -1 ? error.message : 'UNEXPECTED_ERROR';
    throw new Error('POS読取り診断を中止しました [' + stage + '/' + code + ']。商品への保存・DB反映は行っていません。');
  }
}

function posReadDiagnosticUrl_(url) {
  // 既知画面に限りPOSのセッション接尾辞を認める。別パス・追加パラメータは許可しない。
  if (typeof url !== 'string' || !/^https:\/\/cg8\.power-k\.jp\/(?:0D890OGI|hm-hmma\/view\/hmma\/hmma(?:000\/hmma00000|030\/hmma03000|024\/hmma0240[023])\.html(?:;jsessionid=[A-Za-z0-9_-]{1,128}(?:\.[A-Za-z0-9_-]{1,32})?)?)(?:\?[^#\s]*)?$/.test(url)) {
    throw new Error('UNEXPECTED_POS_READ_URL');
  }
  return url;
}

function posReadDecode_(text) {
  return text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, function(entity) {
    var named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    entity = entity.toLowerCase();
    if (named[entity]) return named[entity];
    return String.fromCodePoint(parseInt(entity.slice(entity[2] === 'x' ? 3 : 2, -1), entity[2] === 'x' ? 16 : 10));
  });
}

function posReadForm_(html, id) {
  if (typeof html !== 'string' || html.length > 2000000) throw new Error('INVALID_POS_READ_HTML');
  var forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  var selected = forms.filter(function(form) { return new RegExp('\\bid=["\']' + id + '["\']', 'i').test(form.split('>')[0]); });
  if (selected.length !== 1) throw new Error('UNEXPECTED_POS_READ_FORM');
  return selected[0];
}

// 引用符内の > や属性名に似た文字列を属性として誤認しない。
function posReadAttributes_(tag) {
  var attributes = {};
  var body = tag.replace(/^<\w+\b/, '').replace(/\/?\s*>$/, '');
  var pattern = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  var match;
  while ((match = pattern.exec(body)) !== null) {
    var key = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attributes, key)) throw new Error('UNEXPECTED_POS_READ_FORM');
    attributes[key] = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : '';
  }
  return attributes;
}

function posReadSelectedValue_(html, name) {
  var clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  var pattern = /<select\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  var values = [];
  var match;
  while ((match = pattern.exec(clean)) !== null) {
    if (posReadAttributes_(match[0]).name !== name) continue;
    var rest = clean.slice(pattern.lastIndex);
    var end = rest.search(/<\/select\s*>/i);
    if (end === -1 || /<select\b/i.test(rest.slice(0, end))) throw new Error('UNEXPECTED_POS_READ_FORM');
    var selected = (rest.slice(0, end).match(/<option\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) || [])
      .map(posReadAttributes_).filter(function(option) { return Object.prototype.hasOwnProperty.call(option, 'selected'); });
    if (selected.length !== 1 || !Object.prototype.hasOwnProperty.call(selected[0], 'value')) throw new Error('UNEXPECTED_POS_READ_FORM');
    values.push(selected[0].value);
  }
  if (values.length !== 1) throw new Error('UNEXPECTED_POS_READ_FORM');
  return values[0];
}

function posReadPayload_(html, formId, action, changes) {
  var allowed = {
    hmma00000Form: /^doLogin$/,
    hmma02400Form: /^(doSerchNormal|goodsItems:\d+:doHmma02402)$/,
    hmma02402Form: /^doHmma02403$/,
  };
  if (!allowed[formId] || !allowed[formId].test(action)) throw new Error('POS_WRITE_ACTION_FORBIDDEN');
  var form = posReadForm_(html, formId);
  var fields = extractAllFormFields_(form, formId);
  var prefix = formId === 'hmma00000Form' ? formId + ':' : 'includeChildBody:' + formId + ':';
  var actionKey = prefix + action;
  if (!Object.prototype.hasOwnProperty.call(fields, actionKey)) throw new Error('POS_READ_ACTION_MISSING');
  var buttons = {};
  (form.match(/<(?:input|button)\b[^>]*>/gi) || []).forEach(function(tag) {
    var type = tag.match(/\s+type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    var kind = type ? (type[1] || type[2] || type[3] || '').toLowerCase() : '';
    if (!/^<button\b/i.test(tag) && !/^(submit|image|button|reset)$/.test(kind)) return;
    var name = tag.match(/\s+name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (name) buttons[name[1] || name[2] || name[3]] = true;
  });
  var payload = {};
  Object.keys(fields).forEach(function(key) {
    // 全submitと削除対象チェックを除外し、許可された一つの読取りボタンだけを送る。
    if (!buttons[key] && !/:do[A-Z]|:delflg$/.test(key)) payload[key] = posReadDecode_(fields[key]);
  });
  Object.keys(changes || {}).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(fields, prefix + key) || /:|^do[A-Z]/.test(key)) throw new Error('POS_READ_FIELD_MISSING');
    payload[prefix + key] = changes[key];
  });
  payload[actionKey] = '';
  return payload;
}

function posReadDiagnostic_(config, storeId, jan, onStage, onEditForm) {
  function stage(name) { if (onStage) onStage(name); }
  if (!config || config.baseUrl !== 'https://cg8.power-k.jp/0D890OGI' || (storeId !== 6 && storeId !== 7) ||
      typeof jan !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(jan)) throw new Error('INVALID_POS_READ_TARGET');
  var origin = 'https://cg8.power-k.jp';
  var cookies = '';
  function request(url, payload) {
    for (var redirects = 0; redirects < 4; redirects++) {
      posReadDiagnosticUrl_(url);
      var response = UrlFetchApp.fetch(url, { method: payload ? 'post' : 'get', payload: payload || undefined,
        headers: { Cookie: cookies }, followRedirects: false, muteHttpExceptions: true });
      cookies = mergeCookies_(cookies, response);
      var code = response.getResponseCode();
      if (code === 302 || code === 303) {
        var headers = response.getHeaders();
        var location = headers.Location || headers.location;
        if (typeof location !== 'string') throw new Error('INVALID_POS_READ_REDIRECT');
        url = location[0] === '/' ? origin + location : location;
        payload = null;
        continue;
      }
      if (code !== 200) throw new Error('POS_READ_HTTP_FAILURE');
      return response.getContentText();
    }
    throw new Error('POS_READ_REDIRECT_LIMIT');
  }
  stage('LOGIN_GET');
  var html = request(config.baseUrl);
  stage('LOGIN_PAYLOAD');
  var login = posReadPayload_(html, 'hmma00000Form', 'doLogin', { loginId: config.loginId, password: config.password });
  stage('LOGIN_ACTION');
  var action = extractFormAction_(posReadForm_(html, 'hmma00000Form'), 'hmma00000Form');
  if (!action) throw new Error('POS_LOGIN_ACTION_MISSING');
  action = posReadDecode_(action);
  stage('LOGIN_POST');
  request(action[0] === '/' ? origin + action : action, login);
  var listUrl = origin + '/hm-hmma/view/hmma/hmma024/hmma02400.html';
  var result = { storeId: storeId, janCode: jan, searches: [] };
  ['schGoodsId', 'schMakerCd'].forEach(function(searchField) {
    stage('LIST_GET');
    html = request(listUrl);
    var filters = { schOfficeCd: storeId === 7 ? '11053' : '11054', schTenpoGroupNoSingle: storeId === 7 ? '11098' : '11099', schGoodsId: '', schMakerCd: '', schGoodsName: '' };
    filters[searchField] = jan;
    stage('SEARCH_PAYLOAD');
    var searchPayload = posReadPayload_(html, 'hmma02400Form', 'doSerchNormal', filters);
    stage('SEARCH_POST');
    html = request(listUrl, searchPayload);
    stage('SEARCH_PARSE');
    var text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '');
    var count = text.match(/([\d,]+)\s*件中/);
    if (!count) throw new Error('POS_SEARCH_COUNT_UNKNOWN');
    var n = Number(count[1].replace(/,/g, ''));
    if (n !== 1) { result.searches.push({ field: searchField, count: n, inspected: false }); return; }
    var form = posReadForm_(html, 'hmma02400Form');
    var fields = extractAllFormFields_(form, 'hmma02400Form');
    var buttons = Object.keys(fields).filter(function(key) { return /^includeChildBody:hmma02400Form:goodsItems:\d+:doHmma02402$/.test(key); });
    if (buttons.length !== 1) throw new Error('POS_SEARCH_NOT_UNIQUE');
    stage('DETAIL_POST');
    html = request(listUrl, posReadPayload_(html, 'hmma02400Form', buttons[0].replace('includeChildBody:hmma02400Form:', ''), {}));
    stage('EDIT_POST');
    html = request(origin + '/hm-hmma/view/hmma/hmma024/hmma02402.html', posReadPayload_(html, 'hmma02402Form', 'doHmma02403', {}));
    stage('EDIT_PARSE');
    // DOMとの構造差分を調べる。属性値は識別子だけに限定し、商品値・hidden値は出力しない。
    var controlShapes = (posReadForm_(html, 'hmma02403Form').match(/<(?:select|input)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) || []).map(function(tag) {
      function attr(key) {
        var match = tag.match(new RegExp('\\s' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
        var raw = match ? (match[1] || match[2] || '') : '';
        return /^[A-Za-z0-9_:.-]{1,160}$/.test(raw) ? raw : null;
      }
      return { kind: /^<select\b/i.test(tag) ? 'select' : 'input', id: attr('id'), name: attr('name') };
    }).filter(function(control) { return control.kind === 'select' || /tenpoGroup|goodsId/i.test((control.id || '') + ' ' + (control.name || '')); });
    Logger.log('POS_READ_CONTROL_SHAPES ' + JSON.stringify(controlShapes));
    fields = extractAllFormFields_(posReadForm_(html, 'hmma02403Form'), 'hmma02403Form');
    var prefix = 'includeChildBody:hmma02403Form:';
    // 店舗は受信フォームの明示的な選択値を読む。検索条件からは補完しない。
    fields[prefix + 'tenpoGroup'] = posReadSelectedValue_(posReadForm_(html, 'hmma02403Form'), prefix + 'tenpoGroup');
    function value(key) { return posReadDecode_(fields[prefix + key] || ''); }
    // 値やHTMLは出さず、固定した3項目の存在・空欄・一致だけを記録する。
    var identityChecks = {};
    ['tenpoGroup', 'gdsPublicGoodsCd', 'gdsManufacturerPartNumber'].forEach(function(key) {
      identityChecks[key] = {
        present: Object.prototype.hasOwnProperty.call(fields, prefix + key),
        nonEmpty: value(key).length > 0,
        matches: value(key) === (key === 'tenpoGroup' ? filters.schTenpoGroupNoSingle : jan),
      };
    });
    Logger.log('POS_READ_IDENTITY_CHECK ' + JSON.stringify(identityChecks));
    if (value('tenpoGroup') !== filters.schTenpoGroupNoSingle || (value('gdsPublicGoodsCd') !== jan && value('gdsManufacturerPartNumber') !== jan)) throw new Error('POS_READ_IDENTITY_MISMATCH');
    var internalId = value('goodsId-30');
    var searchResult = { field: searchField, count: 1, inspected: true,
      internalId: /^[A-Za-z0-9._:-]{1,128}$/.test(internalId) ? internalId : null,
      internalIdPresent: internalId.length > 0, salesKind: /^[123]$/.test(value('goodsSalesKbn')) ? value('goodsSalesKbn') : null,
      storeGroupId: value('tenpoGroup'), productCodeMatches: value('gdsPublicGoodsCd') === jan, manufacturerCodeMatches: value('gdsManufacturerPartNumber') === jan };
    // 任意callbackはサーバー内部の読取り専用。既存診断の結果/ログは変更しない。
    if (onEditForm) searchResult.formInspection = onEditForm(html, storeId, jan);
    result.searches.push(searchResult);
  });
  return result;
}

/** 公開入口へ未接続。業務DTOだけ返し、フォーム/資格情報を返さない。 */
function inspectPosProductEdit_(config, storeId, jan) {
  var result = posReadDiagnostic_(config, storeId, jan, null, readPosProductEditForm_);
  return { storeId: result.storeId, janCode: result.janCode, capturedAt: Date.now(), searches: result.searches };
}

/** 商品保存を伴わない手動確認。変更・デプロイ承認後に所有者が実行する。 */
function diagnoseHontenProductEditInspection() {
  try {
    var result = inspectPosProductEdit_(getPOSConfig_(), 7, '4902397868767');
    var found = result.searches.filter(function(search) { return search.count === 1 && search.formInspection; });
    if (result.searches.length !== 2 || result.searches.some(function(search) { return search.count !== 0 && search.count !== 1; }) ||
        found.length === 0 || found.some(function(search) { return JSON.stringify(search.formInspection) !== JSON.stringify(found[0].formInspection); })) {
      throw new Error('POS_PRODUCT_FORM_REJECTED');
    }
    var form = found[0].formInspection;
    var summary = { storeId: result.storeId, janCode: result.janCode, internalId: form.identity.posProductId,
      bothSearchesCompleted: true, identicalInspections: true, fields: form.fields,
      groupCount: form.groups.length, supplierCount: form.suppliers.length,
      taxId: form.settings.taxId, priceScope: form.settings.priceScope, priceMode: form.settings.priceMode,
      supplierScope: form.settings.supplierScope, nameKanaPresent: form.settings.nameKana.length > 0,
      abbreviationPresent: form.settings.abbreviation.length > 0 };
    Logger.log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    // 専用解析の固定工程コードだけを表示し、例外原文は引き継がない。
    var allowed = ['UNEXPECTED_POS_READ_FORM', 'POS_READ_IDENTITY_MISMATCH', 'INVALID_POS_READ_HTML'];
    var code = error && (/^POS_PRODUCT_FORM_REJECTED(?:_[A-Z_0-9]+)?$/.test(error.message) || allowed.indexOf(error.message) !== -1) ? error.message : 'UNEXPECTED_ERROR';
    throw new Error('POS商品編集の読取り確認を中止しました [' + code + ']。商品への保存・DB反映は行っていません。');
  }
}

/** 状態項目は固定名の件数だけを返す。値・HTML・script本文は出力しない。 */
function posReadSubmissionStateCounts_(html, entries) {
  if (typeof html !== 'string' || html.length > 2000000 || !Array.isArray(entries)) {
    throw new Error('POS_PRODUCT_FORM_REJECTED_STATE_COUNTS');
  }
  var scripts = [];
  // script内の旧式HTMLコメントは残し、実コメント/textarea/属性内の偽タグは除外する。
  var tokens = /<!--[\s\S]*?-->|<(script|style|textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>|<[A-Za-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  var markup = html.replace(tokens, function(tag, blockType) {
    if (blockType) {
      if (blockType.toLowerCase() === 'script') scripts.push(tag);
      return '';
    }
    return /^<!--/.test(tag) ? '' : tag;
  });
  var targetForm = posReadForm_(markup, 'hmma02403Form');
  function countInputs(source, name) {
    var count = 0, enabledHidden = 0, tag;
    var tags = /<([A-Za-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g;
    while ((tag = tags.exec(source)) !== null) {
      if (tag[1].toLowerCase() !== 'input') continue;
      // 状態の値は使用せず、名前・type・disabledだけを確認する。
      var attributes = Object.create(null), attribute, matchesName = false, ambiguous = false;
      var attributePattern = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      var body = tag[0].replace(/^<\w+\b/, '').replace(/\/?\s*>$/, '');
      while ((attribute = attributePattern.exec(body)) !== null) {
        var key = attribute[1].toLowerCase();
        if (['name', 'type', 'disabled'].indexOf(key) < 0) continue;
        var attributeValue = attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] : attribute[4] !== undefined ? attribute[4] : '';
        if (key === 'name') {
          // 固定のASCII項目名になり得ない文字参照は、対象外として扱う。
          try { if (posReadDecode_(attributeValue) === name) matchesName = true; }
          catch (_) { /* 対象外の別フォームは診断の停止条件にしない。 */ }
        }
        if (Object.prototype.hasOwnProperty.call(attributes, key)) {
          // 読取りアダプターと同じ、完全一致type重複だけは解釈が一意。
          if (key === 'type' && attributes[key] === attributeValue) continue;
          ambiguous = true;
          continue;
        }
        attributes[key] = attributeValue;
      }
      // 対象外の別フォームの属性不備で、既存の組立診断を新たに停止しない。
      if (!matchesName) continue;
      if (ambiguous) throw new Error('POS_PRODUCT_FORM_REJECTED_STATE_COUNTS');
      count++;
      if ((attributes.type || '').toLowerCase() === 'hidden' && !Object.prototype.hasOwnProperty.call(attributes, 'disabled')) enabledHidden++;
    }
    return { count: count, enabledHidden: enabledHidden };
  }
  function describe(name) {
    var all = countInputs(markup, name), form = countInputs(targetForm, name);
    return { htmlInputCount: all.count, formInputCount: form.count, formEnabledHiddenCount: form.enabledHidden,
      preparedEntryCount: entries.filter(function(entry) { return entry.name === name; }).length,
      // 文字列の参照件数だけ。scriptを実行せず、DOM生成の証明には使わない。
      scriptMentionCount: scripts.reduce(function(count, script) { return count + script.split(name).length - 1; }, 0) };
  }
  return { conditions: describe('te-conditions'),
    viewState: describe('includeChildBody:hmma02403Form/view/hmma/hmma024/hmma02403.html') };
}

/**
 * 所有者用の送信データ組立診断。商品保存はせず、本文/hidden/Cookieは出力しない。
 * HEAD反映と実行の別承認後に使う。公開入口や同期トリガーには接続しない。
 */
function diagnoseHontenProductEditSubmission() {
  try {
    var result = posReadDiagnostic_(getPOSConfig_(), 7, '4902397868767', null, function(html, storeId, jan) {
      var parsed = parsePosProductEditForm_(html, storeId, jan, true);
      var price = Number(parsed.inspection.fields.price);
      // 差分の組立だけを試す値。POSへは送信しない。
      var prepared = buildPosProductEditSubmission_(html, storeId, jan, parsed.inspection,
        { gddGoodsPrice: String(price === 999999999 ? price - 1 : price + 1) });
      return { inspection: parsed.inspection, contract: {
        encoding: prepared.contentType.split(';')[0], successfulControlCount: parsed.submission.entries.length,
        emptyFilePartCount: parsed.submission.entries.filter(function(entry) { return entry.file; }).length,
        updateActionCount: parsed.submission.entries.filter(function(entry) { return entry.name === 'includeChildBody:hmma02403Form:doUpdate'; }).length,
        hasFrameworkState: parsed.submission.entries.some(function(entry) { return entry.name === 'te-conditions'; }),
        stateControls: posReadSubmissionStateCounts_(html, parsed.submission.entries),
        productSaveSent: false,
      } };
    });
    if (result.searches.length !== 2 || result.searches.some(function(search) { return search.count !== 1 || !search.inspected || !search.formInspection; }) ||
        JSON.stringify(result.searches[0].formInspection) !== JSON.stringify(result.searches[1].formInspection) ||
        result.searches.some(function(search) { return search.internalId !== search.formInspection.inspection.identity.posProductId; })) {
      throw new Error('POS_PRODUCT_SUBMISSION_REJECTED');
    }
    var summary = { storeId: result.storeId, janCode: result.janCode, bothSearchesCompleted: true,
      identicalInspections: true, preparedCount: 2, contract: result.searches[0].formInspection.contract };
    Logger.log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    var code = error && (/^POS_PRODUCT_FORM_REJECTED(?:_[A-Z_0-9]+)?$/.test(error.message) || error.message === 'POS_PRODUCT_SUBMISSION_REJECTED') ? error.message : 'UNEXPECTED_ERROR';
    throw new Error('POS商品保存データの組立確認を中止しました [' + code + ']。商品への保存・DB反映は行っていません。');
  }
}

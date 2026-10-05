/**
 * POS編集フォームの読取り専用アダプター。通信・保存・DB更新は行わない。
 * 生HTML、Cookie、シリアライズされたhidden状態は返却・記録しない。
 * posProductReadDiagnostic.jsの属性/文字参照解析を使用する。
 */
function readPosProductEditForm_(html, storeId, jan) {
  return parsePosProductEditForm_(html, storeId, jan, false).inspection;
}

/** 保存準備専用の状態はGAS内部でのみ扱い、読取りDTOには含めない。 */
function parsePosProductEditForm_(html, storeId, jan, includeSubmission) {
  var phase = 'CONTRACT';
  // 固定工程名だけを例外へ出し、受信値・HTML・資格情報は出さない。
  function reject() { throw new Error('POS_PRODUCT_FORM_REJECTED_' + phase); }
  function attributes(tag, strict) {
    // legacy POSで重複する表示用class/styleは値判定に使わない。
    // name/value/selected等、成功コントロールに影響する属性の重複は拒否する。
    var result = Object.create(null), body = tag.replace(/^<\w+\b/, '').replace(/\/?\s*>$/, '');
    var pattern = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    var item;
    while ((item = pattern.exec(body)) !== null) {
      var key = item[1].toLowerCase();
      var attributeValue = item[2] !== undefined ? item[2] : item[3] !== undefined ? item[3] : item[4] !== undefined ? item[4] : '';
      if (key === 'class' || key === 'style') { if (strict) reject(); continue; }
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        // 同じtypeの重複は完全一致なら解釈が一意。異なるtypeは拒否する。
        if (key === 'type' && result[key] === attributeValue) continue;
        // 属性名の固定分類だけを出す。属性値は診断へ渡さない。
        var diagnosticAttributes = ['id', 'name', 'type', 'value', 'checked', 'selected', 'disabled', 'readonly', 'onclick', 'onchange'];
        phase += '_DUPLICATE_' + (diagnosticAttributes.indexOf(key) !== -1 ? key.toUpperCase() : 'OTHER');
        reject();
      }
      result[key] = attributeValue;
    }
    return result;
  }
  function decode(value) {
    // 未対応の文字参照を文字列のまま編集値へ渡さない。二重decodeもしない。
    if (/&[A-Za-z][A-Za-z0-9]*;/.test(value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, '')) ||
        /&(?:amp|quot|apos|lt|gt|nbsp)(?![A-Za-z0-9=;])/i.test(value)) reject();
    return posReadDecode_(value.replace(/&nbsp;/gi, '\u00a0'));
  }
  if ((storeId !== 6 && storeId !== 7) || typeof jan !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(jan) ||
      typeof html !== 'string' || html.length > 2000000) reject();
  // textarea中の生タグをscriptとして削除して業務値を変えない。現行のescaped形式に限定する。
  (html.match(/<textarea\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/textarea\s*>/gi) || []).forEach(function(area) {
    var openingTag = area.match(/^<textarea\b(?:"[^"]*"|'[^']*'|[^'">])*>/i)[0];
    if (/<[^>]*>/.test(area.slice(openingTag.length).replace(/<\/textarea\s*>$/i, ''))) reject();
  });
  var clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // 全タグを引用符ごと消費し、他タグの属性内にある偽コントロールを読まない。
  var opening = /<([A-Za-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  var match, forms = [];
  while ((match = opening.exec(clean)) !== null) {
    if (/^(template|noscript)$/i.test(match[1])) reject();
    if (includeSubmission && /^(input|select|textarea|button)$/i.test(match[1]) && /\bform\s*=/i.test(match[0])) {
      // 未引用/文字参照のform所有者も解釈する。フォーム外の関連項目を黙って省略しない。
      var ownerAttributes = attributes(match[0]);
      if (ownerAttributes.form !== undefined && decode(ownerAttributes.form) === 'hmma02403Form') reject();
    }
    if (match[1].toLowerCase() !== 'form') continue;
    phase = 'FORM_ATTRIBUTES';
    var formAttributes = attributes(match[0]);
    if (formAttributes.id !== 'hmma02403Form') continue;
    var rest = clean.slice(opening.lastIndex), end = rest.search(/<\/form\s*>/i);
    if (end < 0 || /<form\b/i.test(rest.slice(0, end))) reject();
    forms.push({ attributes: formAttributes, body: rest.slice(0, end) });
  }
  if (forms.length !== 1) reject();
  phase = 'FORM_ACTION';
  var form = forms[0], action = decode(form.attributes.action || '');
  // 会社・画面の固定契約。relative actionの解決を曖昧にしない。
  if ((form.attributes.method || '').toLowerCase() !== 'post' ||
      !/^(?:https:\/\/cg8\.power-k\.jp)?\/hm-hmma\/view\/hmma\/hmma024\/hmma02403\.html(?:;jsessionid=[A-Za-z0-9_-]{1,128}(?:\.[A-Za-z0-9_-]{1,32})?)?(?:\?te-uniquekey=[A-Za-z0-9_-]{1,128})?$/.test(action)) reject();
  var prefix = 'includeChildBody:hmma02403Form:';
  var controls = Object.create(null), business = [], submitCount = 0;
  var submission = [], submissionNames = Object.create(null);
  var encoding = (form.attributes.enctype || 'application/x-www-form-urlencoded').toLowerCase();
  if (includeSubmission && ['application/x-www-form-urlencoded', 'multipart/form-data'].indexOf(encoding) < 0) reject();
  var tags = /<([A-Za-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  while ((match = tags.exec(form.body)) !== null) {
    phase = 'CONTROL_SCAN';
    var tag = match[1].toLowerCase();
    if (!/^(input|select|textarea|button|fieldset)$/.test(tag)) continue;
    phase = 'CONTROL_ATTRIBUTES';
    var a = attributes(match[0]);
    // fieldset/form所有者の変更は成功コントロールの解釈が変わるため未対応。
    if (tag === 'fieldset') { if (Object.prototype.hasOwnProperty.call(a, 'disabled')) reject(); continue; }
    if (Object.prototype.hasOwnProperty.call(a, 'form')) reject();
    var content = '';
    if (tag === 'select' || tag === 'textarea' || tag === 'button') {
      rest = form.body.slice(tags.lastIndex);
      end = rest.search(new RegExp('</' + tag + '\\s*>', 'i'));
      if (end < 0) reject();
      content = rest.slice(0, end);
      if (tag === 'select' && /<select\b/i.test(content)) reject();
      tags.lastIndex += end + rest.slice(end).match(new RegExp('^</' + tag + '\\s*>', 'i'))[0].length;
    }
    var name = a.name === undefined ? '' : decode(a.name);
    if (!name || Object.prototype.hasOwnProperty.call(a, 'disabled')) continue;
    var owned = name.indexOf(prefix) === 0;
    var key = owned ? name.slice(prefix.length) : name, type = tag === 'input' ? (a.type || 'text').toLowerCase() : tag;
    if (!owned) {
      if (!includeSubmission) continue;
      // Teedaのフォーム状態だけを保持する。未対応の業務項目は省略せず停止する。
      var frameworkNames = ['te-conditions', 'includeChildBody:hmma02403Form/view/hmma/hmma024/hmma02403.html'];
      if (tag !== 'input' || type !== 'hidden' || frameworkNames.indexOf(name) < 0 || submissionNames[name]) reject();
      var hiddenValue = decode(a.value || '');
      if (hiddenValue.length > 200000) reject();
      submission.push({ name: name, value: hiddenValue });
      submissionNames[name] = true;
      continue;
    }
    // 操作名をhidden等に偽装して、更新と削除/遷移を同時に送らない。
    if (includeSubmission && /^(?:do[A-Z]|delflg$)/.test(key) && !/^(submit|image|button|reset)$/.test(type) && tag !== 'button') reject();
    if (tag === 'button' || /^(submit|image|button|reset)$/.test(type)) {
      if (key === 'doUpdate' && type === 'submit') {
        submitCount++;
        if (includeSubmission) {
          if (submissionNames[name] || a.formaction !== undefined || a.formmethod !== undefined || a.formenctype !== undefined || a.formtarget !== undefined) reject();
          submission.push({ name: name, value: decode(a.value || '') });
          submissionNames[name] = true;
        }
      }
      continue;
    }
    if (type === 'file') {
      if (includeSubmission) {
        // 現行フォームで確認した未選択のサムネイル欄のみ、ブラウザ同様の空file partを作る。
        // 実ファイル/未知のアップロード欄の変更は対象外。画像保持の最終確認は実保存後に行う。
        if (encoding !== 'multipart/form-data' || key !== 'uploadThumbnailFile' || submissionNames[name] ||
            Object.prototype.hasOwnProperty.call(a, 'multiple') || (a.value !== undefined && a.value !== '')) reject();
        submission.push({ name: name, value: '', file: true });
        submissionNames[name] = true;
      }
      continue;
    }
    if (!/^(hidden|text|number|radio|checkbox|select|textarea)$/.test(type)) reject();
    var value, options = null;
    if (tag === 'select') {
      phase = 'SELECT_OPTIONS';
      if (Object.prototype.hasOwnProperty.call(a, 'multiple') || /<optgroup\b[^>]*\bdisabled\b/i.test(content)) reject();
      options = [];
      var optionPattern = /(<option\b(?:"[^"]*"|'[^']*'|[^'">])*?>)([\s\S]*?)(?=<option\b|<\/option\s*>|$)/gi;
      var optionMatch;
      while ((optionMatch = optionPattern.exec(content)) !== null) {
        var oa = attributes(optionMatch[1]);
        if (oa.value === undefined || /<[^>]+>/.test(optionMatch[2])) reject();
        var optionValue = decode(oa.value);
        if (options.some(function(o) { return o.value === optionValue; })) reject();
        options.push({ value: optionValue, name: decode(optionMatch[2]).trim(),
          selected: Object.prototype.hasOwnProperty.call(oa, 'selected'), disabled: Object.prototype.hasOwnProperty.call(oa, 'disabled') });
      }
      var selected = options.filter(function(o) { return o.selected; });
      phase = 'SELECT_VALUE';
      if (selected.length > 1 || (key === 'tenpoGroup' && selected.length !== 1)) reject();
      // 非identity selectだけはHTML単一selectの既定動作を適用する（税等）。
      var chosen = selected[0] || options.filter(function(o) { return !o.disabled; })[0];
      if (!chosen || chosen.disabled) reject();
      value = chosen.value;
    } else if (tag === 'textarea') {
      value = decode(content.replace(/^\r?\n/, '').replace(/\r\n?/g, '\n'));
    } else {
      value = decode(a.value === undefined ? (/^(radio|checkbox)$/.test(type) ? 'on' : '') : a.value);
    }
    phase = 'CONTROL_VALUE';
    if (typeof value !== 'string' || value.length > 200000) reject();
    var checked = Object.prototype.hasOwnProperty.call(a, 'checked');
    var control = { type: type, value: value, options: options, checked: checked,
      readonly: Object.prototype.hasOwnProperty.call(a, 'readonly'), maxLength: a.maxlength };
    phase = 'CONTROL_DUPLICATE';
    if (controls[key]) {
      if (type !== 'radio' || controls[key].some(function(c) { return c.type !== 'radio' || c.value === value; })) reject();
      controls[key].push(control);
    } else controls[key] = [control];
    if (includeSubmission && (!/^(radio|checkbox)$/.test(type) || checked)) {
      if (name.length > 4096 || /[\x00-\x1f\x7f]/.test(name) || submissionNames[name]) reject();
      submission.push({ name: name, value: value, key: key });
      submissionNames[name] = true;
    }
    // hiddenは通信状態を含む。非対象の業務コントロールだけを安定した順で指紋化する。
    if (type !== 'hidden' && ['goodsName', 'goodsGroup', 'gddGoodsPrice', 'gddGoodsCost', 'gddSupplierCd'].indexOf(key) < 0) {
      business.push([key, type, value, checked]);
    }
  }
  phase = 'SAVE_CONTROL';
  if (submitCount !== 1) reject();
  function scalar(key, kind) {
    // keyは下記の固定呼出箇所からのみ指定される。
    phase = 'FIELD_' + key.replace(/-/g, '_').toUpperCase();
    var items = controls[key];
    if (!items || items.length !== 1 || (kind && items[0].type !== kind)) reject();
    return items[0].value;
  }
  function radio(key) {
    phase = 'RADIO_' + key.toUpperCase();
    var items = controls[key];
    if (!items || items.some(function(c) { return c.type !== 'radio'; })) reject();
    var checked = items.filter(function(c) { return c.checked; });
    if (checked.length !== 1) reject();
    return checked[0].value;
  }
  function text(key, max, allowEmpty) {
    var value = scalar(key, 'text');
    if (value.length > max || /[\x00-\x1f\x7f]/.test(value) || (!allowEmpty && !value.trim())) reject();
    return value;
  }
  var storeGroup = storeId === 7 ? '11098' : '11099';
  var internalId = scalar('goodsId-30', 'hidden'), salesKind = scalar('goodsSalesKbn', 'hidden');
  var productCode = text('gdsPublicGoodsCd', 13, true), manufacturerCode = text('gdsManufacturerPartNumber', 13, true);
  phase = 'IDENTITY';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(internalId) || salesKind !== '2' || scalar('tenpoGroup', 'select') !== storeGroup ||
      scalar('tenpoGroupHid', 'hidden') !== storeGroup ||
      (productCode !== jan && manufacturerCode !== jan) ||
      [productCode, manufacturerCode].some(function(code) { return code !== '' && code !== jan; })) reject();
  if (radio('gdsGoodsPriceFlg') !== '0' || radio('gddPriceInputFlg') !== 'false' || radio('gdsSupplierFlg') !== '0') reject();
  function money(key) {
    var value = text(key, 9, false);
    if (!/^\d{1,9}$/.test(value)) reject();
    return String(Number(value));
  }
  function choices(key) {
    phase = 'CATALOG_VALUES';
    return controls[key][0].options.filter(function(o) { return !o.disabled && o.value !== ''; }).map(function(o) {
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(o.value) || !o.name || o.name.length > 1000 || /[\x00-\x1f\x7f]/.test(o.name)) reject();
      return { id: o.value, name: o.name };
    });
  }
  var groupId = scalar('goodsGroup', 'select'), supplierId = scalar('gddSupplierCd', 'select');
  var taxId = scalar('goodsTax', 'select');
  phase = 'TAX_ID';
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(taxId)) reject();
  var groups = choices('goodsGroup'), suppliers = choices('gddSupplierCd');
  phase = 'CATALOG_SELECTION';
  if (!groups.some(function(g) { return g.id === groupId; }) ||
      (supplierId !== '' && !suppliers.some(function(s) { return s.id === supplierId; }))) reject();
  business.sort(function(a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(business), Utilities.Charset.UTF_8);
  var fingerprint = bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  var inspection = {
    identity: { posProductId: internalId, officeId: storeId === 7 ? '11053' : '11054', groupId: storeGroup,
      salesKind: 'retail', productCode: productCode, manufacturerCode: manufacturerCode, exclusiveStore: true },
    fields: { name: text('goodsName', 200, false), groupId: groupId, price: money('gddGoodsPrice'), cost: money('gddGoodsCost'), supplierId: supplierId || null },
    settings: { nameKana: text('goodsNameKana', 1000, true), abbreviation: text('abbreviateGoodsName', 1000, true),
      taxId: taxId, priceScope: 'all', priceMode: 'fixed', supplierScope: 'all', otherSettingsFingerprint: fingerprint },
    groups: groups, suppliers: suppliers,
  };
  if (includeSubmission) {
    phase = 'GENERATED_FRAMEWORK_STATE';
    var generated = generatedConditions();
    phase = 'GENERATED_FRAMEWORK_STATE';
    if (generated !== null) {
      if (submissionNames['te-conditions']) reject();
      submission.push({ name: 'te-conditions', value: generated });
      submissionNames['te-conditions'] = true;
    }
    // 未知の生成方式や欠落を、状態なしの送信準備として通さない。
    if (!submissionNames['te-conditions']) reject();
  }
  return { inspection: inspection, submission: includeSubmission ? { action: action, encoding: encoding, entries: submission, controls: controls } : null };

  /** 確認済みTeeda定型文法だけを読む。eval/DOM実行・任意scriptの解釈は行わない。 */
  function generatedConditions() {
    phase = 'GENERATED_FRAMEWORK_STATE_SCAN';
    var candidates = [], formStack = [], anchors = { hmmaLayoutForm: [], hmma02403Form: [] };
    // 実コメント/属性/textarea内の偽scriptを除き、script内の旧式コメントは保持する。
    var blocks = /<!--[\s\S]*?-->|<(script|style|textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>|<\/?[A-Za-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    html.replace(blocks, function(block, kind, offset) {
      if (!kind) {
        if (/^<!--/.test(block)) return block;
        if (/^<\/form\s*>$/i.test(block)) {
          if (formStack.length) formStack.pop().end = offset + block.length;
          return block;
        }
        if (/^<\//.test(block)) return block;
        var record = { isForm: /^<form\b/i.test(block), start: offset, end: null, nested: formStack.length > 0 };
        if (record.isForm) {
          formStack.forEach(function(parent) { parent.nested = true; });
          formStack.push(record);
        }
        // getElementByIdと同じ参照先を確認。別項目の不備ではなく固定IDだけを調べる。
        var idPattern = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        var attribute, ids = [], tagBody = block.replace(/^<\w+\b/, '').replace(/\/?\s*>$/, '');
        while ((attribute = idPattern.exec(tagBody)) !== null) {
          if (attribute[1].toLowerCase() !== 'id') continue;
          var rawId = attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] : attribute[4] || '';
          try { ids.push(posReadDecode_(rawId)); } catch (_) { ids.push(null); }
        }
        ids.forEach(function(id) {
          if (Object.prototype.hasOwnProperty.call(anchors, id)) {
            if (ids.length !== 1) reject();
            anchors[id].push(record);
          }
        });
        return block;
      }
      if (kind.toLowerCase() !== 'script') return block;
      var start = block.match(/^<script\b(?:"[^"]*"|'[^']*'|[^'">])*>/i)[0];
      var body = block.slice(start.length).replace(/<\/script\s*>$/i, '');
      if (/te-conditions/.test(body) || /span\s*\.\s*innerHTML/.test(body)) candidates.push({ tag: start, body: body, start: offset, nested: formStack.length > 0 });
      return block;
    });
    if (!candidates.length) return null;
    phase = 'GENERATED_FRAMEWORK_STATE_SCRIPT_CANDIDATES';
    if (candidates.length !== 1) reject();
    var candidate = candidates[0];
    phase = 'GENERATED_FRAMEWORK_STATE_FORM_REFERENCES';
    if (candidate.nested) reject();
    Object.keys(anchors).forEach(function(id) {
      var matches = anchors[id];
      if (matches.length !== 1 || !matches[0].isForm || matches[0].nested || matches[0].end === null || matches[0].end > candidate.start) reject();
    });
    phase = 'GENERATED_FRAMEWORK_STATE_SCRIPT_ATTRIBUTES';
    var scriptAttributes = attributes(candidate.tag, true);
    // 実POSの旧式language属性はJavaScriptだけ許可。外部srcや未知属性は通さない。
    if (Object.keys(scriptAttributes).some(function(key) { return key !== 'type' && key !== 'language'; }) ||
        (scriptAttributes.type !== undefined && scriptAttributes.type.toLowerCase() !== 'text/javascript') ||
        (scriptAttributes.language !== undefined && scriptAttributes.language.toLowerCase() !== 'javascript')) reject();
    phase = 'GENERATED_FRAMEWORK_STATE_SCRIPT_GRAMMAR';
    var body = candidate.body.trim();
    if (body.indexOf('<!--') === 0) {
      if (!/\/\/-->$/.test(body)) reject();
      body = body.slice(4, -5).trim();
    }
    function tokens(source) {
      return source.match(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_$][\w$]*|\d+|\+\+|[^\s]/g) || [];
    }
    function stringLiteral(token) {
      if (!/^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')$/.test(token) || /[\r\n]/.test(token)) reject();
      // 実画面は通常文字列。引用符とbackslash以外のJS escapeは未対応として停止する。
      return token.slice(1, -1).replace(/\\([\s\S])/g, function(_, escaped) {
        if (escaped !== '\\' && escaped !== "'" && escaped !== '"') reject();
        return escaped;
      });
    }
    var grammar = "var forms = ['hmmaLayoutForm', 'hmma02403Form'];" +
      "for (var i = 0, len = forms.length; i < len; ++i) {" +
      "var span = document.createElement('span'); span.style.display = 'none'; span.style.position = 'absolute';" +
      "var form = document.getElementById(forms[i]); form.appendChild(span); span.innerHTML = __MARKUP__; }";
    var expected = tokens(grammar), actual = tokens(body), markup = null;
    if (actual.length !== expected.length) reject();
    expected.forEach(function(token, index) {
      if (token === '__MARKUP__') { markup = stringLiteral(actual[index]); return; }
      if (token[0] === '"' || token[0] === "'") {
        if (stringLiteral(actual[index]) !== stringLiteral(token)) reject();
      } else if (actual[index] !== token) reject();
    });
    phase = 'GENERATED_FRAMEWORK_STATE_MARKUP';
    if (typeof markup !== 'string' || markup.length > 300000 ||
        !/^\s*<input\b(?:"[^"]*"|'[^']*'|[^'">])*>\s*$/i.test(markup)) reject();
    var inputAttributes = attributes(markup.trim(), true);
    if (Object.keys(inputAttributes).some(function(key) { return ['name', 'type', 'value'].indexOf(key) < 0; }) ||
        inputAttributes.name === undefined || decode(inputAttributes.name) !== 'te-conditions' ||
        (inputAttributes.type || '').toLowerCase() !== 'hidden') reject();
    phase = 'GENERATED_FRAMEWORK_STATE_STATE_VALUE';
    var stateValue = decode(inputAttributes.value || '');
    if (stateValue.length > 200000) reject();
    return stateValue;
  }
}

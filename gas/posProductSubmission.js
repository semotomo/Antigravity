/**
 * 通信しない保存準備。新しく取得したフォームの成功コントロールを保持する。
 * 戻り値には非公開の状態があるため、Web応答・ログ・DBへ出してはいけない。
 * multipartは現行の未選択サムネイル欄だけ対応。実保存・画像保持の実確認は未接続。
 */
function buildPosProductEditSubmission_(html, storeId, jan, expectedInspection, patch) {
  function reject() { throw new Error('POS_PRODUCT_SUBMISSION_REJECTED'); }
  function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (!value || typeof value !== 'object') reject();
    return '{' + Object.keys(value).sort().map(function(key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
  }
  var parsed = parsePosProductEditForm_(html, storeId, jan, true);
  // 通信hiddenの更新は許すが、業務値・所属・JAN・候補の外部変更は拒否する。
  if (canonical(parsed.inspection) !== canonical(expectedInspection)) reject();
  var fieldMap = { goodsName: 'name', goodsGroup: 'groupId', gddGoodsPrice: 'price', gddGoodsCost: 'cost', gddSupplierCd: 'supplierId' };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) reject();
  var keys = Object.keys(patch);
  if (!keys.length || keys.length > 5) reject();
  var changed = false;
  keys.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(fieldMap, key) || typeof patch[key] !== 'string') reject();
    var value = patch[key], items = parsed.submission.controls[key];
    if (!items || items.length !== 1 || items[0].readonly || /[\x00-\x1f\x7f]/.test(value)) reject();
    var control = items[0];
    if (control.maxLength !== undefined && (!/^\d{1,6}$/.test(control.maxLength) || value.length > Number(control.maxLength))) reject();
    if (key === 'goodsName' && (!value.trim() || value !== value.trim() || value.length > 200)) reject();
    if (/^(gddGoodsPrice|gddGoodsCost)$/.test(key) && (!/^\d{1,9}$/.test(value) || value !== String(Number(value)))) reject();
    if (key === 'goodsGroup' || key === 'gddSupplierCd') {
      if (!control.options || !control.options.some(function(option) { return !option.disabled && option.value === value; }) ||
          (key === 'goodsGroup' && value === '')) reject();
    }
    var previous = parsed.inspection.fields[fieldMap[key]];
    if (value !== (previous === null ? '' : previous)) changed = true;
    var targets = parsed.submission.entries.filter(function(entry) { return entry.key === key; });
    if (targets.length !== 1) reject();
    targets[0].value = value;
  });
  if (!changed) reject();
  function encode(value) {
    // ブラウザのurlencoded形式に合わせる。改行はCRLF、空白は+。
    return encodeURIComponent(value.replace(/\r\n?|\n/g, '\r\n')).replace(/%20/g, '+').replace(/[!'()~]/g, function(c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }
  var payload, contentType = 'application/x-www-form-urlencoded';
  try {
    // UTF-8変換時に置換される不正Unicodeは、multipartでも黙って値を変えない。
    parsed.submission.entries.forEach(function(entry) { encodeURIComponent(entry.name); encodeURIComponent(entry.value); });
    if (parsed.submission.encoding === 'multipart/form-data') {
      var boundary = '----KennelPosProduct' + Utilities.getUuid().replace(/-/g, '');
      if (!/^[A-Za-z0-9-]{20,70}$/.test(boundary)) reject();
      contentType = 'multipart/form-data; boundary=' + boundary;
      payload = parsed.submission.entries.map(function(entry) {
        // boundary衝突は再生成や省略で回避せず停止する。名前へCRLFは許可しない。
        if (entry.name.indexOf(boundary) >= 0 || entry.value.indexOf(boundary) >= 0 || /[\r\n\\]/.test(entry.name)) reject();
        var name = entry.name.replace(/"/g, '%22');
        var disposition = 'Content-Disposition: form-data; name="' + name + '"';
        if (entry.file) return '--' + boundary + '\r\n' + disposition + '; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n';
        return '--' + boundary + '\r\n' + disposition + '\r\n\r\n' + entry.value.replace(/\r\n?|\n/g, '\r\n') + '\r\n';
      }).join('') + '--' + boundary + '--\r\n';
    } else {
      payload = parsed.submission.entries.map(function(entry) { return encode(entry.name) + '=' + encode(entry.value); }).join('&');
    }
  }
  catch (_) { reject(); }
  if (payload.length > 2000000 || Utilities.newBlob(payload, 'application/octet-stream').getBytes().length > 2000000) reject();
  return { url: parsed.submission.action.indexOf('https://') === 0 ? parsed.submission.action : 'https://cg8.power-k.jp' + parsed.submission.action,
    contentType: contentType, payload: payload };
}

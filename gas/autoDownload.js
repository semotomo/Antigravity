/**
 * =============================================================
 * 【POSポータル自動ダウンロードスクリプト】
 *
 * パワーナレッジPOSポータルに自動ログインし、
 * 売上CSVをダウンロードしてGoogleドライブに保存する
 *
 * セットアップ:
 *   1. メニュー「📊 売上CSV取込 → ⚙️ POS接続設定」を実行
 *   2. URL・ID・パスワードを入力（安全に保存されます）
 *   3. メニュー「🤖 POSから自動取得＆月計シート転記」を実行
 *
 * セキュリティ:
 *   接続情報は ScriptProperties に保存されます。
 *   コード内にはパスワード等は一切記載されません。
 * =============================================================
 */


// ===================================================================
// POS接続用の固定パラメータ
// （ポータルの仕様に基づくパス。変更の必要は通常ありません）
// ===================================================================
const POS_PATHS = {
  // ログインページはベースURL自体（例: https://cg8.power-k.jp/会社名）
  LOGIN: '',

  // ログイン後のアプリケーションパス（ドメインルートからの絶対パス）
  CSV_DOWNLOAD: '/hm-hmma/view/hmma/hmma021/hmma02180.html',
  REPORT_PAGE: '/hm-hmma/view/hmma/hmma021/hmma02181.html',
  REPORT_CONFIG: '/hm-hmma/view/hmma/hmma021/hmma02100.html',

  // 商品マスタ（商品検索・エクスポート）
  PRODUCT_MASTER: '/hm-hmma/view/hmma/hmma024/hmma02405.html',

  // 入出庫履歴（当日売上履歴など）
  SALES_HISTORY: '/hm-hmma/view/hmma/hmma024/hmma0244A.html',
};

// ===================================================================
// Supabase接続設定（ScriptPropertiesで管理するため直書き不要）
// ===================================================================
// const SUPABASE_URL = 'https://[あなたのプロジェクトID].supabase.co';
// const SUPABASE_KEY = 'eyJhbG...[あなたのAnon_Key]...';


// ===================================================================
// メニューにPOS自動取得を追加（onOpenを拡張）
// ※ importCSV.gs の onOpen と統合して使用
// ===================================================================
function onOpen_autoDownload() {
  // importCSV.gs の onOpen() に以下のメニュー項目を追加してください:
  //   .addItem('🤖 POSから自動取得＆月計シート転記', 'autoDownloadAndImport')
  //   .addItem('⚙️ POS接続設定', 'setupPOSConnection')
}


// ===================================================================
// 【メイン】POSポータルからCSVを自動取得→月計シートに転記
// ===================================================================
function autoDownloadAndImport() {
  const ui = SpreadsheetApp.getUi();

  // --- 接続設定の確認 ---
  var posConfig = getPOSConfig_();
  if (!posConfig) {
    ui.alert('⚙️ 設定が必要です',
      'POS接続情報が設定されていません。\n\n' +
      '「⚙️ POS接続設定」を先に実行してください。',
      ui.ButtonSet.OK);
    return;
  }

  // --- 対象月の選択 ---
  var now = new Date();
  var defaultMonth = now.getMonth(); // 前月（0-indexed なので今月-1と同じ）
  var defaultYear = defaultMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
  if (defaultMonth === 0) defaultMonth = 12;

  var promptResult = ui.prompt('🤖 POS自動取得',
    '取得する月を入力してください（1〜12）。\n\n' +
    '空欄の場合は前月（' + defaultMonth + '月）を取得します。\n' +
    '年を変更する場合は「年/月」形式で入力（例: 2026/1）',
    ui.ButtonSet.OK_CANCEL);

  if (promptResult.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  var input = promptResult.getResponseText().trim();
  var targetYear = defaultYear;
  var targetMonth = defaultMonth;

  if (input !== '') {
    if (input.indexOf('/') !== -1) {
      var parts = input.split('/');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    } else {
      targetMonth = parseInt(input, 10);
      targetYear = now.getFullYear();
    }
  }

  if (isNaN(targetMonth) || targetMonth < 1 || targetMonth > 12) {
    ui.alert('❌ エラー', '正しい月を入力してください。', ui.ButtonSet.OK);
    return;
  }

  // --- 確認 ---
  var response = ui.alert('🤖 POS自動取得確認',
    'POSポータルから ' + targetYear + '年' + targetMonth + '月のCSVを取得します。\n\n' +
    '処理内容:\n' +
    '  1. POSポータルにログイン\n' +
    '  2. CSVデータをダウンロード\n' +
    '  3. Googleドライブに保存\n' +
    '  4. 月計シートに自動転記\n\n' +
    'よろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) {
    return;
  }

  // --- 実行 ---
  try {
    var result = downloadFromPOS_(posConfig, targetYear, targetMonth);

    if (result.success) {
      ui.alert('✅ 自動取得完了',
        'POSからのCSV取得と月計表への転記が完了しました！\n\n' +
        '対象: ' + targetYear + '年' + targetMonth + '月\n' +
        'ファイル: ' + result.fileName + '\n\n' +
        (result.importResult ? result.importResult.message : ''),
        ui.ButtonSet.OK);
    } else {
      ui.alert('❌ 取得失敗',
        'CSVの取得に失敗しました。\n\n原因: ' + result.message + '\n\n' +
        'POS接続設定を確認してください。',
        ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('❌ エラー',
      '処理中にエラーが発生しました。\n\n' + e.message + '\n\n' +
      '接続設定やPOSポータルの状態を確認してください。',
      ui.ButtonSet.OK);
  }
}


// ===================================================================
// POSポータルからCSVをダウンロード
// ===================================================================
function downloadFromPOS_(posConfig, year, month) {

  // === STEP 1: ログイン ===
  Logger.log('STEP 1: POSポータルにログイン中...');

  var loginUrl = posConfig.baseUrl + POS_PATHS.LOGIN;
  var cookies = '';

  // STEP 1a: GETでログインページにアクセス → セッション確立 + フォームフィールド取得
  var getLoginResponse = UrlFetchApp.fetch(loginUrl, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
  });
  cookies = extractCookies_(getLoginResponse) || '';
  var loginPageHtml = getLoginResponse.getContentText();
  Logger.log('ログインページGET: Status=' + getLoginResponse.getResponseCode() + ', Size=' + loginPageHtml.length);

  // ページ内のフォーム名を自動検出
  var formNameMatch = loginPageHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var formName = formNameMatch ? formNameMatch[1] : 'hmma00000Form';
  Logger.log('検出フォーム名: ' + formName);

  // フォームの全hiddenフィールドを抽出
  var loginPayload = extractAllFormFields_(loginPageHtml, formName);
  Logger.log('フォームフィールド数: ' + Object.keys(loginPayload).length);

  // フォームのaction URLを取得
  var formAction = extractFormAction_(loginPageHtml, formName);
  Logger.log('フォームaction: ' + (formAction || 'なし'));

  // ユーザーのログイン情報を追加
  loginPayload[formName + ':loginId'] = posConfig.loginId;
  loginPayload[formName + ':password'] = posConfig.password;
  loginPayload[formName + ':saveLoginStatFlg'] = 'true';
  loginPayload[formName + ':doLogin'] = '送信';
  loginPayload[formName + ':companyCd'] = posConfig.companyCd;
  loginPayload[formName + ':loginMissCnt'] = '0';
  loginPayload[formName + ':companyKey'] = posConfig.companyKey;

  // STEP 1b: ログインフォームをPOST
  var postUrl = formAction ? resolveUrl_(posConfig.baseUrl, formAction) : loginUrl;
  Logger.log('ログインPOST先: ' + postUrl);
  Logger.log('Payload項目数: ' + Object.keys(loginPayload).length);

  var loginResponse = UrlFetchApp.fetch(postUrl, {
    method: 'post',
    payload: loginPayload,
    headers: { 'Cookie': cookies },
    followRedirects: false,
    muteHttpExceptions: true,
  });

  cookies = mergeCookies_(cookies, loginResponse);

  // ログイン成功判定
  var loginHtml = loginResponse.getContentText();
  var loginStatus = loginResponse.getResponseCode();
  Logger.log('ログイン応答: Status=' + loginStatus + ', Size=' + loginHtml.length);

  if (loginStatus === 200 && loginHtml.indexOf('ログイン画面') !== -1) {
    Logger.log('ログイン失敗: ログインページに戻されました');
    var errMsgMatch = loginHtml.match(/class="[^"]*(?:err|error|alert|warning)[^"]*"[^>]*>([^<]+)</i);
    Logger.log('エラーメッセージ: ' + (errMsgMatch ? errMsgMatch[1] : 'なし'));
    return { success: false, message: 'ログインに失敗しました（ID/パスワードを確認してください）\n\nフォームフィールド数: ' + Object.keys(loginPayload).length };
  }

  Logger.log('ログイン成功');

  // リダイレクト先をフォロー（ダッシュボードを取得）
  var dashHtml = '';
  if (loginStatus === 302) {
    var redirectUrl = resolveUrl_(posConfig.baseUrl, loginResponse.getHeaders()['Location']);
    var dashResponse = fetchWithCookies_(redirectUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, dashResponse);
    dashHtml = dashResponse.getContentText();
    Logger.log('ダッシュボード: Status=' + dashResponse.getResponseCode() + ', Size=' + dashHtml.length);
  } else {
    dashHtml = loginHtml;
  }


  // === STEP 2: エクスポートページに直接アクセス ===
  Logger.log('STEP 2: エクスポートページに直接アクセス中...');

  var exportPageUrl = resolveUrl_(posConfig.baseUrl, POS_PATHS.CSV_DOWNLOAD);
  Logger.log('エクスポートページURL: ' + exportPageUrl);

  var exportResponse = fetchWithCookies_(exportPageUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, exportResponse);
  var exportStatus = exportResponse.getResponseCode();
  var exportHtml = exportResponse.getContentText();

  // 302リダイレクトの場合はフォロー
  if (exportStatus === 302) {
    var redirUrl = resolveUrl_(posConfig.baseUrl, exportResponse.getHeaders()['Location']);
    Logger.log('リダイレクト先: ' + redirUrl);
    exportResponse = fetchWithCookies_(redirUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, exportResponse);
    exportStatus = exportResponse.getResponseCode();
    exportHtml = exportResponse.getContentText();
  }

  Logger.log('エクスポートページ: Status=' + exportStatus + ', Size=' + exportHtml.length);

  // セッション切れチェック
  if (exportHtml.indexOf('ログイン画面') !== -1) {
    Logger.log('セッション切れ: ログインページに戻されました');
    return { success: false, message: 'セッションが切れています。再度お試しください。' };
  }

  // ページにhmma02180フォームがあるか確認
  var hasExportForm = exportHtml.indexOf('hmma02180') !== -1;
  Logger.log('エクスポートフォーム検出: ' + hasExportForm);

  if (!hasExportForm) {
    Logger.log('ページ内容プレビュー: ' + exportHtml.substring(0, 500));
  }



  // === STEP 4: 月を切替え → エクスポート（hmma02180上で2段階処理） ===
  // ブラウザのフロー: カレンダーで月選択(ボタンなし送信) → doExportでCSV取得
  Logger.log('STEP 4-1: 月変更リクエスト (year=' + year + ', month=' + month + ')');

  var formFields = extractAllFormFields_(exportHtml, 'hmma02180Form');
  Logger.log('フォームフィールド数: ' + Object.keys(formFields).length);

  // 基準日は対象月の初日
  var kijyunDate = year + '/' + (month < 10 ? '0' : '') + month + '/01';
  Logger.log('基準日: ' + kijyunDate);

  // --- 4-1: 月変更POST ---
  var monthPayload = {};
  var prefix = 'includeChildBody:hmma02180Form:';
  var removedButtons02180 = [];
  if (Object.keys(formFields).length > 0) {
    for (var key in formFields) {
      if (key.match(/:do[A-Z]/)) {
        removedButtons02180.push(key.split(':').pop());
        continue;  // submitボタンは除外
      }
      monthPayload[key] = formFields[key];
    }
  }
  Logger.log('hmma02180ボタン一覧(' + removedButtons02180.length + '): ' + removedButtons02180.join(', '));

  // HTMLからもsubmit/imageボタンを調査
  var allBtns02180 = [];
  var btn02180Regex = /<(?:input|button)[^>]*type\s*=\s*["'](?:submit|image)['"'][^>]*>/gi;
  var btn02180Match;
  while ((btn02180Match = btn02180Regex.exec(exportHtml)) !== null) {
    var nm = btn02180Match[0].match(/name\s*=\s*["']([^"']+)["']/i);
    if (nm && nm[1].indexOf('hmma02180') !== -1) {
      allBtns02180.push(nm[1].split(':').pop());
    }
  }
  Logger.log('HTML内hmma02180ボタン(' + allBtns02180.length + '): ' + allBtns02180.join(', '));

  // ブラウザの実ペイロードに準拠して値を上書き
  var today = new Date();
  var todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  monthPayload[prefix + 'year'] = String(year);
  monthPayload[prefix + 'month'] = String(month);
  monthPayload[prefix + 'selDateKbn'] = '';       // ブラウザ: 空
  monthPayload[prefix + 'selMonthlyKbn'] = '';     // ブラウザ: 空
  monthPayload[prefix + 'selYearKbn'] = '';        // ブラウザ: 空
  monthPayload[prefix + 'kijyunDate'] = todayStr;  // ブラウザ: 今日の日付
  monthPayload[prefix + 'monthlySelected'] = 'true';      // ブラウザ: true
  monthPayload[prefix + 'listSelected'] = 'false';        // ブラウザ: false
  monthPayload[prefix + 'calendarDispIndex'] = '1';        // ブラウザ: 1
  monthPayload[prefix + 'schTenpoGroup'] = posConfig.tenpoGroupId;
  monthPayload[prefix + 'selectTenpoGroupName'] = posConfig.tenpoGroupName;

  // calendarSelectedは除去（ブラウザのペイロードに含まれない）
  delete monthPayload[prefix + 'calendarSelected'];

  // ※ ボタンなし送信（ブラウザのカレンダー月クリックと同じ）

  // srItems
  if (!monthPayload[prefix + 'srItems:0:srIndex-x']) {
    for (var i = 0; i <= 18; i++) {
      monthPayload[prefix + 'srItems:' + i + ':srIndex-x'] = String(i);
    }
  }

  var formAction = extractFormAction_(exportHtml, 'hmma02180');
  var csvUrl = formAction
    ? resolveUrl_(posConfig.baseUrl, formAction)
    : resolveUrl_(posConfig.baseUrl, POS_PATHS.CSV_DOWNLOAD);

  Logger.log('月変更POST先: ' + csvUrl);
  Logger.log('Payloadフィールド数: ' + Object.keys(monthPayload).length);

  var monthResponse = fetchWithCookies_(csvUrl, 'post', monthPayload, cookies);
  cookies = mergeCookies_(cookies, monthResponse);

  // 302リダイレクトをフォロー
  var reloadedPageUrl = '';
  if (monthResponse.getResponseCode() === 302) {
    reloadedPageUrl = resolveUrl_(posConfig.baseUrl, monthResponse.getHeaders()['Location']);
    Logger.log('月変更302リダイレクト先: ' + reloadedPageUrl);
    monthResponse = fetchWithCookies_(reloadedPageUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, monthResponse);
  }

  var reloadedHtml = monthResponse.getContentText();
  Logger.log('月変更後ページ: Status=' + monthResponse.getResponseCode() + ', Size=' + reloadedHtml.length);

  // --- 4-2: エクスポートPOST（doExportでCSV取得） ---
  Logger.log('STEP 4-2: エクスポートリクエスト');

  var exportFields = extractAllFormFields_(reloadedHtml, 'hmma02180Form');
  Logger.log('エクスポートフォームフィールド数: ' + Object.keys(exportFields).length);

  var exportPayload = {};
  for (var key2 in exportFields) {
    if (key2.match(/:do[A-Z]/)) {
      if (key2.indexOf('doExport') !== -1) {
        exportPayload[key2] = '';  // doExportだけ残す
      }
      continue;
    }
    exportPayload[key2] = exportFields[key2];
  }

  // エクスポートPOST先URL（リダイレクト後のte-uniquekey付きURL優先）
  var exportFormAction = extractFormAction_(reloadedHtml, 'hmma02180');
  var exportUrl = reloadedPageUrl || (exportFormAction ? resolveUrl_(posConfig.baseUrl, exportFormAction) : csvUrl);

  Logger.log('エクスポートPOST先: ' + exportUrl);
  Logger.log('エクスポートPayloadフィールド数: ' + Object.keys(exportPayload).length);

  var csvResponse = fetchWithCookies_(exportUrl, 'post', exportPayload, cookies);

  // 302リダイレクトの場合はフォロー
  var csvStatus = csvResponse.getResponseCode();
  if (csvStatus === 302) {
    var csvRedirectUrl = resolveUrl_(posConfig.baseUrl, csvResponse.getHeaders()['Location']);
    Logger.log('エクスポート302リダイレクト先: ' + csvRedirectUrl);
    csvResponse = fetchWithCookies_(csvRedirectUrl, 'get', null, cookies);
    csvStatus = csvResponse.getResponseCode();
  }

  var respHeaders = csvResponse.getHeaders();
  var contentType = respHeaders['Content-Type'] || respHeaders['content-type'] || '';
  var contentDisposition = respHeaders['Content-Disposition'] || respHeaders['content-disposition'] || '';

  Logger.log('応答: Status=' + csvStatus + ', Type=' + contentType);
  Logger.log('Content-Disposition: ' + contentDisposition);
  Logger.log('Payload: year=' + year + ', month=' + month + ', kijyunDate=' + kijyunDate);

  var isCSV = contentDisposition.indexOf('csv') !== -1 ||
              contentDisposition.indexOf('attachment') !== -1 ||
              contentType.indexOf('octet-stream') !== -1;

  if (csvStatus !== 200 || !isCSV) {
    var responsePreview = csvResponse.getContentText().substring(0, 500);
    Logger.log('応答プレビュー: ' + responsePreview);

    return {
      success: false,
      message: 'CSVデータが返されませんでした\n' +
        'Status: ' + csvStatus + '\nType: ' + contentType + '\n' +
        'フォームフィールド数: ' + Object.keys(formFields).length + '\n\n' +
        'Apps Scriptの「実行ログ」に詳細があります。'
    };
  }


  // === STEP 5: Googleドライブに保存 ===
  Logger.log('STEP 5: Googleドライブに保存中...');

  var folderId = CONFIG.CSV_FOLDER_ID;
  if (!folderId || folderId.trim() === '') {
    return { success: false, message: 'GoogleドライブのCSV保存先フォルダIDが設定されていません。\nメニュー「📊 売上CSV取込」>「⚙️ POS接続設定」からフォルダIDを登録してください。' };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, message: '設定されたCSV保存先フォルダが見つかりません（ID: ' + folderId + '）。\nフォルダの権限やIDが正しいか確認してください。\nエラー: ' + e.message };
  }

  // 店舗名プレフィックスを決定（わんわん or 本店）
  var storePrefix = (posConfig.tenpoGroupName && posConfig.tenpoGroupName.indexOf('わんわん') !== -1) ? 'わんわん' : '本店';
  var fileName = storePrefix + '_月計用_' + year + '_' + (month < 10 ? '0' : '') + month + '.csv';
  var csvBlob = csvResponse.getBlob().setName(fileName);

  var existingFiles = folder.getFilesByName(fileName);
  while (existingFiles.hasNext()) {
    try {
      existingFiles.next().setTrashed(true);
    } catch (e) {
      Logger.log('既存ファイルのゴミ箱移動をスキップします（権限等のエラー）: ' + e.message);
    }
  }

  var savedFile = folder.createFile(csvBlob);
  Logger.log('Googleドライブに保存完了: ' + savedFile.getName());


  // === STEP 6: 月計シートに自動転記 ===
  Logger.log('STEP 6: 月計シートに自動転記中...');

  var importResult = null;
  try {
    importResult = processCSVFile_(savedFile, true);  // 既存シートがあれば上書き確認ダイアログを表示
  } catch (e) {
    Logger.log('月計シート転記でエラー: ' + e.message);
    importResult = { success: false, message: '転記エラー: ' + e.message };
  }

  return {
    success: true,
    fileName: fileName,
    importResult: importResult,
  };
}


// ===================================================================
// HTML内から特定パターンを含むリンク(href)を検索
// ===================================================================
function findLinkInHtml_(html, pattern) {
  // href="...pattern..." を全て検索
  var hrefRegex = /href="([^"]*?)"/gi;
  var match;
  var candidates = [];

  while ((match = hrefRegex.exec(html)) !== null) {
    var href = match[1];
    if (href.indexOf(pattern) !== -1) {
      candidates.push(href);
    }
  }

  // onclick="location.href='...'" パターンも検索
  var onclickRegex = /location\.href='([^']*?)'/gi;
  while ((match = onclickRegex.exec(html)) !== null) {
    if (match[1].indexOf(pattern) !== -1) {
      candidates.push(match[1]);
    }
  }

  // window.open('...') パターンも検索
  var openRegex = /window\.open\('([^']*?)'/gi;
  while ((match = openRegex.exec(html)) !== null) {
    if (match[1].indexOf(pattern) !== -1) {
      candidates.push(match[1]);
    }
  }

  if (candidates.length > 0) {
    Logger.log('findLinkInHtml_: "' + pattern + '" → ' + candidates.length + '件ヒット');
    return candidates[0]; // 最初のマッチを返す
  }

  return null;
}


// ===================================================================
// 相対URLを絶対URLに解決
// ===================================================================
function resolveUrl_(baseUrl, url) {
  if (!url) return baseUrl;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) {
    // 絶対パス: ドメイン部分だけ抽出して結合
    var domainMatch = baseUrl.match(/^(https?:\/\/[^\/]+)/);
    return domainMatch ? domainMatch[1] + url : url;
  }
  // 相対パス
  return baseUrl + '/' + url;
}


// ===================================================================
// Cookie付きでHTTPリクエスト
// ===================================================================
function fetchWithCookies_(url, method, payload, cookies) {
  var options = {
    method: method,
    headers: { 'Cookie': cookies },
    muteHttpExceptions: true,
    followRedirects: (method === 'get'),
  };

  if (payload) {
    options.payload = payload;
  }

  return UrlFetchApp.fetch(url, options);
}


// ===================================================================
// HTMLからフォームのaction属性を抽出
// ===================================================================
function extractFormAction_(html, formPattern) {
  // form要素のactionを検索（formのidやnameにpatternを含むもの）
  var regex = new RegExp('<form[^>]*' + formPattern + '[^>]*action="([^"]*)"', 'i');
  var match = html.match(regex);
  if (match) return match[1];

  // action="..." が先に来るパターン
  regex = new RegExp('<form[^>]*action="([^"]*)"[^>]*' + formPattern, 'i');
  match = html.match(regex);
  if (match) return match[1];

  return null;
}


// ===================================================================
// CSVダウンロード用のPayload構築（フォールバック用）
// ===================================================================
function buildCSVPayload_(posConfig, year, month, kijyunDate, tmpFolder, yearItemsSave) {
  var payload = {};
  var prefix = 'includeChildBody:hmma02180Form:';

  payload[prefix + 'kijyunDate'] = kijyunDate;
  payload[prefix + 'selDateKbn'] = '';
  payload[prefix + 'year'] = String(year);
  payload[prefix + 'selMonthlyKbn'] = '';
  payload[prefix + 'month'] = String(month);
  payload[prefix + 'selYearKbn'] = '';
  payload[prefix + 'accountingPeriod'] = '';
  payload[prefix + 'kijyunDateStart'] = '';
  payload[prefix + 'kijyunDateEnd'] = '';
  payload[prefix + 'week'] = '';
  payload[prefix + 'schGoodsGroup'] = '';
  payload[prefix + 'selectGoodsId'] = '';
  payload[prefix + 'schHaUserGrpCd'] = '';
  payload[prefix + 'selectHaUserId'] = '';
  payload[prefix + 'selectSalConsumerKbn'] = '';
  payload[prefix + 'schTenpoGroup'] = posConfig.tenpoGroupId;
  payload[prefix + 'kengenTenpoGroupKbn'] = '0';
  payload[prefix + 'selectTenpoGroupName'] = posConfig.tenpoGroupName;
  payload[prefix + 'monthlySelected'] = 'false';
  payload[prefix + 'listSelected'] = 'false';
  payload[prefix + 'calendarDispIndex'] = '1';
  payload[prefix + 'ecSiteAble'] = 'false';
  payload[prefix + 'doExport'] = '送信';

  // 動的パラメータ（ページから取得、またはデフォルト）
  if (tmpFolder) {
    payload[prefix + 'tmpFolder'] = tmpFolder;
  }
  if (yearItemsSave) {
    payload[prefix + 'yearItemsSave'] = yearItemsSave;
  }

  // レポート行インデックス（0〜18）
  for (var i = 0; i <= 18; i++) {
    payload[prefix + 'srItems:' + i + ':srIndex-x'] = String(i);
  }

  return payload;
}


// ===================================================================
// HTTPレスポンスからCookieを抽出
// ===================================================================
function extractCookies_(response) {
  var headers = response.getAllHeaders();
  var setCookies = headers['Set-Cookie'];

  if (!setCookies) return null;

  // Set-Cookieが複数の場合は配列
  if (!Array.isArray(setCookies)) {
    setCookies = [setCookies];
  }

  var cookieParts = [];
  for (var i = 0; i < setCookies.length; i++) {
    // "name=value; path=..." から "name=value" 部分だけ取得
    var nameValue = setCookies[i].split(';')[0];
    cookieParts.push(nameValue);
  }

  return cookieParts.join('; ');
}


// ===================================================================
// 追加のCookieをマージ
// ===================================================================
function mergeCookies_(existingCookies, response) {
  var newCookies = extractCookies_(response);
  if (!newCookies) return existingCookies;

  // 既存のCookieをパース
  var cookieMap = {};
  if (existingCookies) {
    existingCookies.split('; ').forEach(function(c) {
      var parts = c.split('=');
      if (parts.length >= 2) {
        cookieMap[parts[0]] = parts.slice(1).join('=');
      }
    });
  }

  // 新しいCookieで上書き
  newCookies.split('; ').forEach(function(c) {
    var parts = c.split('=');
    if (parts.length >= 2) {
      cookieMap[parts[0]] = parts.slice(1).join('=');
    }
  });

  // 結合して返す
  var result = [];
  for (var key in cookieMap) {
    result.push(key + '=' + cookieMap[key]);
  }

  return result.join('; ');
}


// ===================================================================
// HTMLからフォーム hidden フィールドの値を抽出
// ===================================================================
function extractFormValue_(html, fieldName) {
  // name="...fieldName" value="..." のパターンを検索
  var regex = new RegExp('name="[^"]*' + fieldName + '"[^>]*value="([^"]*)"', 'i');
  var match = html.match(regex);
  if (match) return match[1];

  // value="..." name="..." の逆パターンも検索
  regex = new RegExp('value="([^"]*)"[^>]*name="[^"]*' + fieldName + '"', 'i');
  match = html.match(regex);
  if (match) return match[1];

  return null;
}


// ===================================================================
// HTMLからフォーム内の全input/selectフィールドを抽出
// formIdPrefix: フォーム名のプレフィックス（例: 'hmma02180Form'）
// ===================================================================
function extractAllFormFields_(html, formIdPrefix) {
  var fields = {};
  var totalInputs = 0;

  // input タグを全て検索（自己閉じタグと通常タグの両方に対応）
  var inputRegex = /<input[^>]*\/?>/gi;
  var inputMatch;

  while ((inputMatch = inputRegex.exec(html)) !== null) {
    var tag = inputMatch[0];
    totalInputs++;

    // nameを取得（ダブルクォート、シングルクォート、クォートなしに対応）
    var nameMatch = tag.match(/name\s*=\s*"([^"]*)"/i) ||
                    tag.match(/name\s*=\s*'([^']*)'/i) ||
                    tag.match(/name\s*=\s*([^\s>]+)/i);
    if (!nameMatch) continue;

    var name = nameMatch[1];

    // フォームプレフィックスでフィルタ（指定がある場合）
    if (formIdPrefix && name.indexOf(formIdPrefix) === -1) continue;

    // valueを取得
    var valueMatch = tag.match(/value\s*=\s*"([^"]*)"/i) ||
                     tag.match(/value\s*=\s*'([^']*)'/i) ||
                     tag.match(/value\s*=\s*([^\s>]+)/i);
    var value = valueMatch ? valueMatch[1] : '';

    fields[name] = value;
  }

  Logger.log('extractAllFormFields_: 全input数=' + totalInputs + ', "' + formIdPrefix + '"マッチ=' + Object.keys(fields).length);

  // マッチが0の場合、最初の5つのinput nameをログに出力（デバッグ用）
  if (Object.keys(fields).length === 0 && totalInputs > 0) {
    var debugRegex = /<input[^>]*\/?>/gi;
    var debugMatch;
    var debugNames = [];
    var count = 0;
    while ((debugMatch = debugRegex.exec(html)) !== null && count < 5) {
      var debugTag = debugMatch[0];
      var dn = debugTag.match(/name\s*=\s*["']?([^"'\s>]+)/i);
      if (dn) {
        debugNames.push(dn[1]);
        count++;
      }
    }
    Logger.log('最初の5つのinput name: ' + debugNames.join(', '));
  }

  return fields;
}


// ===================================================================
// POS接続・Supabase接続設定（ScriptPropertiesに安全に保存）
// ===================================================================
function setupPOSConnection() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  // 現在の設定を取得
  var current = {
    csvFolderId: props.getProperty('CSV_FOLDER_ID') || '',
    baseUrl: props.getProperty('POS_BASE_URL') || '',
    loginId: props.getProperty('POS_LOGIN_ID') || '',
    companyCd: props.getProperty('POS_COMPANY_CD') || '',
    companyKey: props.getProperty('POS_COMPANY_KEY') || '',
    tenpoGroupId: props.getProperty('POS_TENPO_GROUP_ID') || '',
    tenpoGroupName: props.getProperty('POS_TENPO_GROUP_NAME') || '',
    supabaseUrl: props.getProperty('SUPABASE_URL') || '',
    supabaseKey: props.getProperty('SUPABASE_KEY') || ''
  };

  // CSV保存先フォルダID
  var result = ui.prompt('⚙️ 接続設定 (1/9) - 📁 CSV保存先フォルダID',
    'CSVファイルを保存するGoogleドライブのフォルダIDを入力してください。\n\n' +
    '例: 1ABC_xyzDefGHIjklMNO (URLの最後の部分)\n\n' +
    (current.csvFolderId ? '現在の設定: ' + current.csvFolderId : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var csvFolderId = result.getResponseText().trim() || current.csvFolderId;

  // ベースURL
  result = ui.prompt('⚙️ 接続設定 (2/9) - POS URL',
    'POSポータルのログインページURLを入力してください。\n\n' +
    '例: https://cg8.power-k.jp/会社名\n' +
    '※ ブラウザでログインする時のURLです\n\n' +
    (current.baseUrl ? '現在の設定: ' + current.baseUrl : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var baseUrl = result.getResponseText().trim() || current.baseUrl;
  // 末尾のスラッシュを除去
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

  // ログインID
  result = ui.prompt('⚙️ 接続設定 (3/9) - POS ログインID',
    'ログインIDを入力してください。\n\n' +
    (current.loginId ? '現在の設定: ' + current.loginId : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var loginId = result.getResponseText().trim() || current.loginId;

  // パスワード
  var currentPasswordSet = !!props.getProperty('POS_PASSWORD');
  result = ui.prompt('⚙️ 接続設定 (4/9) - POS パスワード',
    'パスワードを入力してください。\n\n' +
    '※ 安全に保存されます（コードには記載されません）\n' +
    (currentPasswordSet ? '※ 空欄でOKを押すと現在のパスワードを維持します' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var password = result.getResponseText().trim() || props.getProperty('POS_PASSWORD') || '';

  // 会社コード
  result = ui.prompt('⚙️ 接続設定 (5/9) - POS 会社コード',
    '会社コード（companyCd）を入力してください。\n\n' +
    (current.companyCd ? '現在の設定: ' + current.companyCd : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var companyCd = result.getResponseText().trim() || current.companyCd;

  // 会社キー
  result = ui.prompt('⚙️ 接続設定 (6/9) - POS 会社キー',
    '会社キー（companyKey）を入力してください。\n\n' +
    (current.companyKey ? '現在の設定: ' + current.companyKey : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var companyKey = result.getResponseText().trim() || current.companyKey;

  // 店舗グループ
  result = ui.prompt('⚙️ 接続設定 (7/9) - POS 店舗情報',
    '店舗グループIDと店舗名をカンマ区切りで入力してください。\n\n' +
    '例: 11098,からつケンネル本店\n\n' +
    (current.tenpoGroupId ? '現在の設定: ' + current.tenpoGroupId + ',' + current.tenpoGroupName : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var tenpoInput = result.getResponseText().trim();
  var tenpoGroupId = current.tenpoGroupId;
  var tenpoGroupName = current.tenpoGroupName;
  if (tenpoInput.indexOf(',') !== -1) {
    var tenpoParts = tenpoInput.split(',');
    tenpoGroupId = tenpoParts[0].trim();
    tenpoGroupName = tenpoParts.slice(1).join(',').trim();
  }

  // Supabase URL
  result = ui.prompt('⚙️ 接続設定 (8/9) - Supabase URL',
    'SupabaseプロジェクトのURLを入力してください（連携しない場合は空欄でOK）。\n\n' +
    '例: https://xxxx.supabase.co\n\n' +
    (current.supabaseUrl ? '現在の設定: ' + current.supabaseUrl : '未設定'),
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() === ui.Button.CANCEL) return; // 空欄OKのためCANCELのみ終了
  var supabaseUrl = result.getResponseText().trim() || current.supabaseUrl || '';

  // Supabase Key (anon)
  var currentSbKeySet = !!current.supabaseKey;
  result = ui.prompt('⚙️ 接続設定 (9/9) - Supabase Anon Key',
    'Supabaseプロジェクトの API Key (anon) を入力してください。\n\n' +
    (currentSbKeySet ? '※ 空欄でOKを押すと現在のキーを維持します\n\n' : '') +
    '※ セキュリティ保護されコード上には表示されません。',
    ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() === ui.Button.CANCEL) return;
  var supabaseKey = result.getResponseText().trim() || current.supabaseKey || '';


  // 保存
  props.setProperties({
    'CSV_FOLDER_ID': csvFolderId,
    'POS_BASE_URL': baseUrl,
    'POS_LOGIN_ID': loginId,
    'POS_PASSWORD': password,
    'POS_COMPANY_CD': companyCd,
    'POS_COMPANY_KEY': companyKey,
    'POS_TENPO_GROUP_ID': tenpoGroupId,
    'POS_TENPO_GROUP_NAME': tenpoGroupName,
    'SUPABASE_URL': supabaseUrl,
    'SUPABASE_KEY': supabaseKey
  });

  ui.alert('✅ 設定完了',
    '接続情報を安全に保存しました。\n\n' +
    '【CSV保存ルート】\n' +
    'フォルダID: ' + csvFolderId + '\n\n' +
    '【POS設定】\n' +
    'ベースURL: ' + baseUrl + '\n' +
    'ログインID: ' + loginId + '\n' +
    '店舗: ' + tenpoGroupName + ' (' + tenpoGroupId + ')\n\n' +
    '【Supabase設定】\n' +
    'URL設定済み: ' + (supabaseUrl ? 'はい' : 'いいえ') + '\n' +
    'Key設定済み: ' + (supabaseKey ? 'はい' : 'いいえ'),
    ui.ButtonSet.OK);
}


// ===================================================================
// ScriptPropertiesから接続情報を取得
// ===================================================================
function getPOSConfig_() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('POS_BASE_URL');

  if (!baseUrl) return null;

  return {
    csvFolderId: props.getProperty('CSV_FOLDER_ID'),
    baseUrl: baseUrl,
    loginId: props.getProperty('POS_LOGIN_ID'),
    password: props.getProperty('POS_PASSWORD'),
    companyCd: props.getProperty('POS_COMPANY_CD'),
    companyKey: props.getProperty('POS_COMPANY_KEY'),
    tenpoGroupId: props.getProperty('POS_TENPO_GROUP_ID'),
    tenpoGroupName: props.getProperty('POS_TENPO_GROUP_NAME'),
    supabaseUrl: props.getProperty('SUPABASE_URL'),
    supabaseKey: props.getProperty('SUPABASE_KEY')
  };
}


// ===================================================================
// 接続テスト（ログインできるか確認）
// ===================================================================
function testPOSConnection() {
  var ui = SpreadsheetApp.getUi();
  var posConfig = getPOSConfig_();

  if (!posConfig) {
    ui.alert('⚙️ 設定が必要です',
      'POS接続情報が設定されていません。',
      ui.ButtonSet.OK);
    return;
  }

  try {
    var loginUrl = posConfig.baseUrl + POS_PATHS.LOGIN;

    // GETでログインページ取得
    var getResponse = UrlFetchApp.fetch(loginUrl, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
    });
    var cookies = extractCookies_(getResponse) || '';
    var loginPageHtml = getResponse.getContentText();

    // フォーム名を自動検出
    var formNameMatch = loginPageHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
    var formName = formNameMatch ? formNameMatch[1] : 'hmma00000Form';

    // フォームの全hiddenフィールドを抽出
    var loginPayload = extractAllFormFields_(loginPageHtml, formName);
    var formAction = extractFormAction_(loginPageHtml, formName);

    // ユーザー情報を追加
    loginPayload[formName + ':loginId'] = posConfig.loginId;
    loginPayload[formName + ':password'] = posConfig.password;
    loginPayload[formName + ':saveLoginStatFlg'] = 'true';
    loginPayload[formName + ':doLogin'] = '送信';
    loginPayload[formName + ':companyCd'] = posConfig.companyCd;
    loginPayload[formName + ':loginMissCnt'] = '0';
    loginPayload[formName + ':companyKey'] = posConfig.companyKey;

    var postUrl = formAction ? resolveUrl_(posConfig.baseUrl, formAction) : loginUrl;

    var loginResponse = UrlFetchApp.fetch(postUrl, {
      method: 'post',
      payload: loginPayload,
      headers: { 'Cookie': cookies },
      followRedirects: false,
      muteHttpExceptions: true,
    });

    var status = loginResponse.getResponseCode();
    var responseHtml = loginResponse.getContentText();
    var isLoginPage = responseHtml.indexOf('ログイン画面') !== -1;

    if ((status === 302 || status === 200) && !isLoginPage) {
      ui.alert('✅ 接続テスト成功',
        'POSポータルへのログインに成功しました！\n\n' +
        'ステータス: ' + status + '\n' +
        'レスポンスサイズ: ' + responseHtml.length + ' bytes',
        ui.ButtonSet.OK);
    } else {
      ui.alert('❌ ログイン失敗',
        'ログインに失敗しました。\n\n' +
        'ステータス: ' + status + '\n' +
        (isLoginPage ? 'ログインページに戻されています。\n\n' : '') +
        'ID・パスワード・会社コード・会社キーを確認してください。',
        ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('❌ 接続エラー',
      'POSポータルに接続できませんでした。\n\n' +
      'エラー: ' + e.message + '\n\nURLが正しいか確認してください。',
      ui.ButtonSet.OK);
  }
  // ← testPOSConnection の閉じカッコはここ
}


// ===================================================================
// 【新規追加】商品別売上の取得のみを単独で実行するメニュー用関数
// ===================================================================
function downloadProductSalesMenu() {
  var ui = SpreadsheetApp.getUi();
  var posConfig = getPOSConfig_();

  if (!posConfig) {
    ui.alert('⚙️ 設定が必要です', 'POS接続情報を設定してください。', ui.ButtonSet.OK);
    return;
  }

  var now = new Date();
  var defaultMonth = now.getMonth();
  var defaultYear = defaultMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
  if (defaultMonth === 0) defaultMonth = 12;

  var promptResult = ui.prompt('📦 商品別売上の自動取得（単独処理）',
    '取得する月を入力してください（1〜12）。\n\n' +
    '空欄の場合は前月（' + defaultMonth + '月）を取得します。\n' +
    '年を変更する場合は「年/月」形式で入力（例: 2026/1）',
    ui.ButtonSet.OK_CANCEL);

  if (promptResult.getSelectedButton() !== ui.Button.OK) return;

  var input = promptResult.getResponseText().trim();
  var targetYear = defaultYear;
  var targetMonth = defaultMonth;

  if (input !== '') {
    if (input.indexOf('/') !== -1) {
      var parts = input.split('/');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    } else {
      targetMonth = parseInt(input, 10);
      targetYear = now.getFullYear();
    }
  }

  var response = ui.alert('📦 商品別売上の取得確認',
    targetYear + '年' + targetMonth + '月 の商品別売上データ（hmma02115）のみを取得し、\n' +
    'Supabaseデータベース（product_sales_data）に送信します。\n\n' +
    'この処理は件数が多いため時間がかかる場合があります。\nよろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) return;

  try {
    var result = downloadProductSalesFromPOS_(posConfig, targetYear, targetMonth);
    if (result.success) {
      ui.alert('✅ 商品別取得 完了',
        '取得およびSupabaseへの連携が完了しました。\n\n' + result.message,
        ui.ButtonSet.OK);
    } else {
      ui.alert('❌ 取得失敗', 'エラー: ' + result.message, ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('❌ 重大なエラー', '処理中にエラーが発生しました。\n' + e.message, ui.ButtonSet.OK);
  }
}


// ===================================================================
// 【新規追加】POSから商品別売上(hmma02115)をダウンロード
// ===================================================================
function downloadProductSalesFromPOS_(posConfig, year, month) {
  Logger.log('商品別売上のダウンロードを開始します...');

// 指定された年月の1日を基準日として設定（POSのカレンダー切替に必要）
  var kijyunDate = year + '/' + (month < 10 ? '0' : '') + month + '/01';

  // STEP 1: ログイン（完全版を使用）
  Logger.log('STEP 1: POSポータルにログイン中...');
  var loginUrl = posConfig.baseUrl + POS_PATHS.LOGIN;
  var getLoginResponse = UrlFetchApp.fetch(loginUrl, { method: 'get', followRedirects: true, muteHttpExceptions: true });
  var cookies = extractCookies_(getLoginResponse) || '';
  var loginPageHtml = getLoginResponse.getContentText();
  
  var formNameMatch = loginPageHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var formName = formNameMatch ? formNameMatch[1] : 'hmma00000Form';
  var loginPayload = extractAllFormFields_(loginPageHtml, formName);
  var formAction = extractFormAction_(loginPageHtml, formName);

  loginPayload[formName + ':loginId'] = posConfig.loginId;
  loginPayload[formName + ':password'] = posConfig.password;
  loginPayload[formName + ':saveLoginStatFlg'] = 'true';
  loginPayload[formName + ':doLogin'] = '送信';
  loginPayload[formName + ':companyCd'] = posConfig.companyCd;
  loginPayload[formName + ':loginMissCnt'] = '0';
  loginPayload[formName + ':companyKey'] = posConfig.companyKey;

  var postUrl = formAction ? resolveUrl_(posConfig.baseUrl, formAction) : loginUrl;
  Logger.log('ログインPOST先: ' + postUrl);

  var loginResponse = UrlFetchApp.fetch(postUrl, {
    method: 'post',
    payload: loginPayload,
    headers: { 'Cookie': cookies },
    followRedirects: false,
    muteHttpExceptions: true,
  });
  cookies = mergeCookies_(cookies, loginResponse);

  var exportPageUrl = posConfig.baseUrl + '/hm-hmma/view/hmma/hmma021/hmma02115.html'; // デフォルト

  // ステータス302ならダッシュボードへリダイレクト
  if (loginResponse.getResponseCode() === 302) {
    Logger.log('ログイン成功');
    var redirectUrl = resolveUrl_(posConfig.baseUrl, loginResponse.getHeaders()['Location']);
    var dashResponse = fetchWithCookies_(redirectUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, dashResponse);
    Logger.log('ダッシュボード: Status=' + dashResponse.getResponseCode() + ', Size=' + dashResponse.getContentText().length);
    
    // ダッシュボードからエクスポートページ(hmma02115)へのリンクを探す（セッション確立のため）
    var dashHtml = dashResponse.getContentText();
    var exportLink = findLinkInHtml_(dashHtml, 'hmma02115'); // .htmlを除去して部分一致を拡張
    
    if (exportLink) {
      exportPageUrl = resolveUrl_(posConfig.baseUrl, exportLink);
      Logger.log('動的エクスポートURL抽出成功: ' + exportPageUrl);
    } else {
      Logger.log('【警告】ダッシュボードから hmma02115 のリンクが見つかりません。');
      // 全リンクをダンプして調査
      var allLinks = [];
      var hrefRegex = /href="([^"]*?)"/gi;
      var match;
      while ((match = hrefRegex.exec(dashHtml)) !== null) {
        if (match[1].indexOf('hmma') !== -1) allLinks.push(match[1]);
      }
      Logger.log('ダッシュボード内のhmmaリンク一覧: ' + allLinks.join('\n'));
      
      // 商品別売上というテキストが含まれるaタグを探す
      var textMatch = dashHtml.match(/<a[^>]*href="([^"]*)"[^>]*>[^<]*商品別売上[^<]*<\/a>/i);
      if (textMatch) {
         exportPageUrl = resolveUrl_(posConfig.baseUrl, textMatch[1]);
         Logger.log('テキスト「商品別売上」からURLを抽出: ' + exportPageUrl);
      } else {
         // 絶対パスで強制遷移（/社内コード/hm-hmma/... のような形式になるよう resolveUrl_ に任せる）
         exportPageUrl = resolveUrl_(posConfig.baseUrl, '/hm-hmma/view/hmma/hmma021/hmma02115.html');
      }
    }
  } else {
    var responseHtml = loginResponse.getContentText();
    if (responseHtml.indexOf('ログイン画面') !== -1) {
      return { success: false, message: 'ログインに失敗しました。IDやパスワードを確認してください。' };
    }
  }

  // STEP 2: 商品別売上ページ(hmma02115)にアクセス
  Logger.log('STEP 2: 商品別売上ページにアクセス中... URL: ' + exportPageUrl);
  
  var exportResponse = fetchWithCookies_(exportPageUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, exportResponse);

  // もし302でリダイレクトされたら追う
  if (exportResponse.getResponseCode() === 302) {
    var redirUrl = resolveUrl_(posConfig.baseUrl, exportResponse.getHeaders()['Location']);
    Logger.log('エクスポート画面リダイレクト: ' + redirUrl);
    exportResponse = fetchWithCookies_(redirUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, exportResponse);
  }


  // STEP 3: 対象月の指定 (POST)
  var exportStatus = exportResponse.getResponseCode();
  var exportHtml = exportResponse.getContentText();
  Logger.log('商品別売上ページ GET: Status=' + exportStatus + ', Size=' + exportHtml.length);
  if (exportHtml.length < 5000) { // 極端に短い場合はログに出す
    Logger.log('ページ内容スニペット: ' + exportHtml.substring(0, 1000));
  }

  Logger.log('STEP 3: 月切替リクエスト');
  if (exportHtml.indexOf('hmma02115') === -1) {
    Logger.log('警告: hmma02115がページ内に見つかりません。セッション切れ、またはURLが間違っています。');
  }

  // 自動的にフォーム名を特定
  var formNameMatch = exportHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var formName = formNameMatch ? formNameMatch[1] : 'hmma02115Form';
  Logger.log('検出フォーム名: ' + formName);

  var monthPayload = extractAllFormFields_(exportHtml, formName);
  var prefix = 'includeChildBody:' + formName + ':';

  // 余計なdo**ボタンを削除し、指定月のパラメータをセット
  for (var key in monthPayload) {
    if (key.match(/:do[A-Z]/)) delete monthPayload[key];
  }

  monthPayload[prefix + 'year'] = String(year);
  monthPayload[prefix + 'month'] = String(month);
  monthPayload[prefix + 'kijyunDate'] = kijyunDate;
  monthPayload[prefix + 'schTenpoGroup'] = posConfig.tenpoGroupId;
  monthPayload[prefix + 'selectTenpoGroupName'] = posConfig.tenpoGroupName;
  monthPayload[prefix + 'monthlySelected'] = 'true';
  monthPayload[prefix + 'listSelected'] = 'false';

  var monthResponse = fetchWithCookies_(exportPageUrl, 'post', monthPayload, cookies);
  cookies = mergeCookies_(cookies, monthResponse);

  // STEP 4: エクスポート (doExport)
  var reloadedHtml = monthResponse.getContentText();
  Logger.log('月切替後ページ POST: Status=' + monthResponse.getResponseCode() + ', Size=' + reloadedHtml.length);
  
  var exportPayload = extractAllFormFields_(reloadedHtml, formName);
  for (var k in exportPayload) {
    if (k.match(/:do[A-Z]/) && k.indexOf('doExport') === -1) delete exportPayload[k];
  }
  exportPayload[prefix + 'doExport'] = '送信';

  var csvResponse = fetchWithCookies_(exportPageUrl, 'post', exportPayload, cookies);

  // ↓ここの判定が逆（200のときに即終了になってしまっていた可能性等）や、処理の順番を修正します。
  if (csvResponse.getResponseCode() !== 200) {
     return { success: false, message: 'CSVが正しく取得できませんでした。Status: ' + csvResponse.getResponseCode() };
  }
  
  // CSVかどうかのチェック（HTMLが返ってきていないか）
  var contentType = csvResponse.getHeaders()['Content-Type'] || csvResponse.getHeaders()['content-type'] || '';
  if (contentType.indexOf('text/html') !== -1) {
     return { success: false, message: 'CSVではなくHTMLページが返却されました。セッション切れ、または対象データが多すぎることが原因です。' };
  }

  var storePrefix = (posConfig.tenpoGroupName && posConfig.tenpoGroupName.indexOf('わんわん') !== -1) ? 'わんわん' : '本店';

  // ① GoogleドライブにCSVとして保存（証跡用）
  var folderId = CONFIG.CSV_FOLDER_ID;
  if (!folderId || folderId.trim() === '') {
    return { success: false, message: 'GoogleドライブのCSV保存先フォルダIDが設定されていません。\nメニュー「📊 売上CSV取込」>「⚙️ POS接続設定」からフォルダIDを登録してください。' };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, message: '設定されたCSV保存先フォルダが見つかりません（ID: ' + folderId + '）。\nフォルダの権限やIDが正しいか確認してください。\nエラー: ' + e.message };
  }

  var fileName = storePrefix + '_商品別売上_' + year + '_' + (month < 10 ? '0' : '') + month + '.csv';
  var existingFiles = folder.getFilesByName(fileName);
  while (existingFiles.hasNext()) {
    try {
      existingFiles.next().setTrashed(true);
    } catch (e) {
      Logger.log('既存ファイルのゴミ箱移動をスキップします（権限等のエラー）: ' + e.message);
    }
  }
  
  var savedFile = folder.createFile(csvResponse.getBlob().setName(fileName));
  Logger.log('Googleドライブに保存完了: ' + savedFile.getName());

  // ここで少し待機する（ドライブ保存処理との間隔を空け、メモリ解放を促す）
  Utilities.sleep(2000);

  // ② Supabaseへのパース＆送信処理（importCSV.gsの関数を呼び出す）
  try {
    Logger.log('Supabase連携（パース処理）を開始します...');
    // savedFile.getBlob() で明示的にドライブから読み出し直すことで安定性を高める
    var result = processProductSalesCSV_(savedFile.getBlob(), storePrefix);
    return { success: true, message: 'Supabase送信成功: ' + result.count + '件のレコード\n保存ファイル名: ' + fileName };
  } catch (e) {
    Logger.log('商品別送信エラー: ' + e.message);
    return { success: false, message: 'Supabase送信中に例外エラー: ' + e.message };
  }
}


// ===================================================================
// 【新規追加】毎月1日に自動実行するためのトリガー用関数（画面なし）
// ===================================================================
function autoRunProductSalesMonthly() {
  var posConfig = getPOSConfig_();
  if (!posConfig) {
    Logger.log('POS接続情報が未設定のため自動実行をスキップしました。');
    return;
  }

  // 毎月1日に実行される想定なので、取得対象は「先月」
  var now = new Date();
  var targetMonth = now.getMonth(); // 0-indexed なので今月-1と同じ
  var targetYear = now.getFullYear();

  if (targetMonth === 0) {
    targetMonth = 12;
    targetYear -= 1;
  }

  Logger.log('定期自動実行開始: ' + targetYear + '年' + targetMonth + '月の商品別データを取得します。');

  try {
    var result = downloadProductSalesFromPOS_(posConfig, targetYear, targetMonth);
    if (result.success) {
      Logger.log('定期自動実行成功: ' + result.message);
    } else {
      Logger.log('定期自動実行失敗: ' + result.message);
    }
  } catch (e) {
    Logger.log('定期自動実行エラー: ' + e.message);
  }
}


// ===================================================================
// 【商品マスタ同期】Sheetsメニューから手動実行するための関数
// ===================================================================
function downloadAndSyncProductMasterMenu() {
  var ui = SpreadsheetApp.getUi();
  var posConfig = getPOSConfig_();

  if (!posConfig) {
    ui.alert('⚙️ 設定が必要です', 'POS接続情報を設定してください。', ui.ButtonSet.OK);
    return;
  }

  var response = ui.alert('🏷️ 商品マスタ同期',
    'POSポータルから商品マスタCSVをダウンロードし、\n' +
    'Supabaseの商品データベースを最新の状態に同期します。\n\n' +
    '処理内容:\n' +
    '  1. POSポータルにログイン\n' +
    '  2. 商品マスタCSVをエクスポート\n' +
    '  3. Googleドライブに保存\n' +
    '  4. Supabase products テーブルに同期\n\n' +
    '※ 新商品の登録・価格変更の反映を行います\n' +
    '※ 既存商品の削除は行いません\n\n' +
    'よろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) return;

  try {
    var result = downloadProductMasterFromPOS_(posConfig);

    if (result.success) {
      ui.alert('✅ 商品マスタ同期 完了',
        '商品マスタの同期が完了しました！\n\n' +
        'ファイル: ' + result.fileName + '\n' +
        'CSV件数: ' + (result.csvRowCount || '不明') + '件\n\n' +
        (result.syncResult
          ? 'Supabase同期: ' + result.syncResult.count + '件処理'
          : ''),
        ui.ButtonSet.OK);
    } else {
      ui.alert('❌ 取得失敗',
        '商品マスタCSVの取得に失敗しました。\n\n原因: ' + result.message,
        ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('❌ エラー',
      '処理中にエラーが発生しました。\n\n' + e.message,
      ui.ButtonSet.OK);
  }
}


// ===================================================================
// 【商品マスタ】POSポータル (hmma02405) から商品マスタCSVをダウンロード
// フロー: ログイン → 商品検索 → エクスポート → ダウンロード
// ===================================================================
function downloadProductMasterFromPOS_(posConfig) {
  Logger.log('========== 商品マスタCSVダウンロード開始 ==========');

  // === STEP 1: ログイン ===
  Logger.log('STEP 1: POSポータルにログイン中...');

  var loginUrl = posConfig.baseUrl + POS_PATHS.LOGIN;
  var getLoginResponse = UrlFetchApp.fetch(loginUrl, {
    method: 'get', followRedirects: true, muteHttpExceptions: true
  });
  var cookies = extractCookies_(getLoginResponse) || '';
  var loginPageHtml = getLoginResponse.getContentText();

  // フォーム名を自動検出
  var formNameMatch = loginPageHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var formName = formNameMatch ? formNameMatch[1] : 'hmma00000Form';
  var loginPayload = extractAllFormFields_(loginPageHtml, formName);
  var formAction = extractFormAction_(loginPageHtml, formName);

  // ログイン情報をセット
  loginPayload[formName + ':loginId'] = posConfig.loginId;
  loginPayload[formName + ':password'] = posConfig.password;
  loginPayload[formName + ':saveLoginStatFlg'] = 'true';
  loginPayload[formName + ':doLogin'] = '送信';
  loginPayload[formName + ':companyCd'] = posConfig.companyCd;
  loginPayload[formName + ':loginMissCnt'] = '0';
  loginPayload[formName + ':companyKey'] = posConfig.companyKey;

  var postUrl = formAction ? resolveUrl_(posConfig.baseUrl, formAction) : loginUrl;
  var loginResponse = UrlFetchApp.fetch(postUrl, {
    method: 'post', payload: loginPayload,
    headers: { 'Cookie': cookies },
    followRedirects: false, muteHttpExceptions: true,
  });
  cookies = mergeCookies_(cookies, loginResponse);

  // ログイン成功判定
  var loginStatus = loginResponse.getResponseCode();
  var loginHtml = loginResponse.getContentText();
  if (loginStatus === 200 && loginHtml.indexOf('ログイン画面') !== -1) {
    return { success: false, message: 'ログインに失敗しました。ID/パスワードを確認してください。' };
  }
  Logger.log('ログイン成功 (Status=' + loginStatus + ')');

  // リダイレクト先をフォロー（ダッシュボード取得）
  if (loginStatus === 302) {
    var redirectUrl = resolveUrl_(posConfig.baseUrl, loginResponse.getHeaders()['Location']);
    var dashResponse = fetchWithCookies_(redirectUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, dashResponse);
    Logger.log('ダッシュボード: Status=' + dashResponse.getResponseCode());
  }


  // === STEP 2: 商品検索ページ (hmma02405) にアクセス ===
  Logger.log('STEP 2: 商品検索ページにアクセス中...');

  var searchPageUrl = resolveUrl_(posConfig.baseUrl, POS_PATHS.PRODUCT_MASTER);
  Logger.log('商品検索URL: ' + searchPageUrl);

  var searchResponse = fetchWithCookies_(searchPageUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, searchResponse);

  // 302リダイレクトをフォロー
  if (searchResponse.getResponseCode() === 302) {
    var redirUrl = resolveUrl_(posConfig.baseUrl, searchResponse.getHeaders()['Location']);
    Logger.log('商品検索リダイレクト: ' + redirUrl);
    searchResponse = fetchWithCookies_(redirUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, searchResponse);
  }

  var searchHtml = searchResponse.getContentText();
  Logger.log('商品検索ページ: Status=' + searchResponse.getResponseCode() + ', Size=' + searchHtml.length);

  // セッション切れチェック
  if (searchHtml.indexOf('ログイン画面') !== -1) {
    return { success: false, message: 'セッションが切れました。再度お試しください。' };
  }

  // フォーム名を自動検出（hmma02405Form を期待）
  var searchFormMatch = searchHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var searchFormName = searchFormMatch ? searchFormMatch[1] : 'hmma02405Form';
  Logger.log('検出フォーム名: ' + searchFormName);


  // === STEP 3: 店舗グループを設定して「検索」実行 ===
  Logger.log('STEP 3: 店舗グループ設定 → 検索実行');

  var searchFields = extractAllFormFields_(searchHtml, searchFormName);
  var searchPrefix = 'includeChildBody:' + searchFormName + ':';

  // submitボタン名を除外してから doSearch だけ残す
  var searchPayload = {};
  var searchButtons = [];
  for (var key in searchFields) {
    if (key.match(/:do[A-Z]/)) {
      searchButtons.push(key.split(':').pop());
      continue;
    }
    searchPayload[key] = searchFields[key];
  }
  Logger.log('検索フォームボタン一覧(' + searchButtons.length + '): ' + searchButtons.join(', '));

  // 店舗グループを設定
  searchPayload[searchPrefix + 'schTenpoGroup'] = posConfig.tenpoGroupId;
  searchPayload[searchPrefix + 'selectTenpoGroupName'] = posConfig.tenpoGroupName;

  // 検索ボタンを押す（doSearch を設定）
  // ボタン名が doSearch / doSchTenpoGroup 等の場合に対応
  var doSearchKey = null;
  for (var b = 0; b < searchButtons.length; b++) {
    if (searchButtons[b].indexOf('doSearch') !== -1 || searchButtons[b] === 'doSearch') {
      doSearchKey = searchButtons[b];
      break;
    }
  }
  if (!doSearchKey) {
    // HTML内のsubmitボタンからも検索
    var btnRegex = /<(?:input|button)[^>]*name\s*=\s*["']([^"']*doSearch[^"']*)["']/gi;
    var btnMatch = btnRegex.exec(searchHtml);
    if (btnMatch) {
      doSearchKey = btnMatch[1];
    }
  }

  if (doSearchKey) {
    // doSearchがフルパス（includeChildBody:hmma02405Form:doSearch）の場合もあるので対応
    if (doSearchKey.indexOf(':') === -1) {
      searchPayload[searchPrefix + doSearchKey] = '';
    } else {
      searchPayload[doSearchKey] = '';
    }
    Logger.log('検索ボタン: ' + doSearchKey);
  } else {
    Logger.log('警告: doSearchボタンが見つかりません。ボタンなし送信を試みます。');
  }

  var searchFormAction = extractFormAction_(searchHtml, searchFormName);
  var searchPostUrl = searchFormAction
    ? resolveUrl_(posConfig.baseUrl, searchFormAction)
    : searchPageUrl;

  Logger.log('検索POST先: ' + searchPostUrl);

  var searchResult = fetchWithCookies_(searchPostUrl, 'post', searchPayload, cookies);
  cookies = mergeCookies_(cookies, searchResult);

  // リダイレクトをフォロー
  var searchResultUrl = searchPostUrl;
  if (searchResult.getResponseCode() === 302) {
    searchResultUrl = resolveUrl_(posConfig.baseUrl, searchResult.getHeaders()['Location']);
    Logger.log('検索結果リダイレクト: ' + searchResultUrl);
    searchResult = fetchWithCookies_(searchResultUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, searchResult);
  }

  var searchResultHtml = searchResult.getContentText();
  Logger.log('検索結果: Status=' + searchResult.getResponseCode() + ', Size=' + searchResultHtml.length);


  // === STEP 4: 「商品データのエクスポート」ボタンを押す ===
  Logger.log('STEP 4: エクスポート画面へ遷移');

  var exportFields = extractAllFormFields_(searchResultHtml, searchFormName);
  var exportPayload = {};
  var exportButtons = [];
  for (var eKey in exportFields) {
    if (eKey.match(/:do[A-Z]/)) {
      exportButtons.push(eKey.split(':').pop());
      continue;
    }
    exportPayload[eKey] = exportFields[eKey];
  }
  Logger.log('エクスポート画面遷移ボタン候補(' + exportButtons.length + '): ' + exportButtons.join(', '));

  // doExport ボタンを押す（「商品データのエクスポート」ボタン）
  var doExportNavKey = null;
  for (var eb = 0; eb < exportButtons.length; eb++) {
    if (exportButtons[eb].indexOf('Export') !== -1 || exportButtons[eb].indexOf('export') !== -1) {
      doExportNavKey = exportButtons[eb];
      break;
    }
  }

  if (doExportNavKey) {
    exportPayload[searchPrefix + doExportNavKey] = '';
    Logger.log('エクスポート遷移ボタン: ' + doExportNavKey);
  } else {
    Logger.log('警告: エクスポートボタンが見つかりません。全ボタン: ' + exportButtons.join(', '));
    // 代替: ボタン名を総当たりで探す
    for (var eb2 = 0; eb2 < exportButtons.length; eb2++) {
      Logger.log('  ボタン: ' + exportButtons[eb2]);
    }
  }

  // 店舗グループ情報を維持
  exportPayload[searchPrefix + 'schTenpoGroup'] = posConfig.tenpoGroupId;
  exportPayload[searchPrefix + 'selectTenpoGroupName'] = posConfig.tenpoGroupName;

  var exportFormAction = extractFormAction_(searchResultHtml, searchFormName);
  var exportPostUrl = exportFormAction
    ? resolveUrl_(posConfig.baseUrl, exportFormAction)
    : searchResultUrl;

  var exportNavResponse = fetchWithCookies_(exportPostUrl, 'post', exportPayload, cookies);
  cookies = mergeCookies_(cookies, exportNavResponse);

  // リダイレクトをフォロー
  var exportPageUrl = exportPostUrl;
  if (exportNavResponse.getResponseCode() === 302) {
    exportPageUrl = resolveUrl_(posConfig.baseUrl, exportNavResponse.getHeaders()['Location']);
    Logger.log('エクスポート画面リダイレクト: ' + exportPageUrl);
    exportNavResponse = fetchWithCookies_(exportPageUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, exportNavResponse);
  }

  var exportPageHtml = exportNavResponse.getContentText();
  Logger.log('エクスポート画面: Status=' + exportNavResponse.getResponseCode() + ', Size=' + exportPageHtml.length);


  // === STEP 5: エクスポート画面でチェックボックス設定 → エクスポート実行 ===
  Logger.log('STEP 5: エクスポート出力項目を設定 → エクスポート実行');

  // エクスポート画面のフォーム名を再検出（別画面かもしれない）
  var expFormMatch = exportPageHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var expFormName = expFormMatch ? expFormMatch[1] : searchFormName;
  Logger.log('エクスポート画面フォーム名: ' + expFormName);

  var expFields = extractAllFormFields_(exportPageHtml, expFormName);
  var expPrefix = 'includeChildBody:' + expFormName + ':';

  var expPayload = {};
  var expButtons = [];
  for (var xKey in expFields) {
    if (xKey.match(/:do[A-Z]/)) {
      expButtons.push(xKey.split(':').pop());
      continue;
    }
    expPayload[xKey] = expFields[xKey];
  }
  Logger.log('エクスポートボタン候補(' + expButtons.length + '): ' + expButtons.join(', '));

  // チェックボックスを設定（出力項目）
  // ※ フィールド名はPOSの実装に依存するため、よくあるパターンを網羅
  // 必須項目（デフォルトON）: 店舗コード、商品コード、商品名
  // 追加でONにする: 商品区分、商品グループ名称、商品金額、商品原価
  var checkboxNames = [
    'chkTenpoCd',         // 店舗コード
    'chkGoodsCd',         // 商品コード
    'chkGoodsNm',         // 商品名
    'chkGoodsKbn',        // 商品区分
    'chkGoodsGroupNm',    // 商品グループ名称
    'chkGoodsPrice',      // 商品金額
    'chkGoodsGenka',      // 商品原価
  ];

  // チェックボックスをONにする（trueまたは'on'）
  for (var ci = 0; ci < checkboxNames.length; ci++) {
    var cbKey = expPrefix + checkboxNames[ci];
    expPayload[cbKey] = 'true';
    // 'on' パターンも試す
    var cbKeyOn = cbKey + '-x';
    if (expFields[cbKeyOn] !== undefined) {
      expPayload[cbKeyOn] = 'on';
    }
  }

  // エクスポート実行ボタン（doExport）
  var doExportKey = null;
  for (var xb = 0; xb < expButtons.length; xb++) {
    if (expButtons[xb] === 'doExport' || expButtons[xb].indexOf('Export') !== -1) {
      doExportKey = expButtons[xb];
      break;
    }
  }
  if (doExportKey) {
    expPayload[expPrefix + doExportKey] = '';
    Logger.log('エクスポート実行ボタン: ' + doExportKey);
  }

  var expFormAction = extractFormAction_(exportPageHtml, expFormName);
  var expPostUrl = expFormAction
    ? resolveUrl_(posConfig.baseUrl, expFormAction)
    : exportPageUrl;

  Logger.log('エクスポート実行POST先: ' + expPostUrl);

  var expResponse = fetchWithCookies_(expPostUrl, 'post', expPayload, cookies);
  cookies = mergeCookies_(cookies, expResponse);

  // リダイレクトをフォロー
  var expResultUrl = expPostUrl;
  if (expResponse.getResponseCode() === 302) {
    expResultUrl = resolveUrl_(posConfig.baseUrl, expResponse.getHeaders()['Location']);
    Logger.log('エクスポート結果リダイレクト: ' + expResultUrl);
    expResponse = fetchWithCookies_(expResultUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, expResponse);
  }

  var expResultHtml = expResponse.getContentText();
  Logger.log('エクスポート結果: Status=' + expResponse.getResponseCode() + ', Size=' + expResultHtml.length);


  // === STEP 6: エクスポート完了待ち → ダウンロード ===
  Logger.log('STEP 6: エクスポートファイルのダウンロード');

  // 「処理完了」の確認（ステータスポーリング）
  // エクスポート結果画面に「ダウンロード」ボタンがあればそのまま取得
  // なければ数回リロードして待機

  var downloadHtml = expResultHtml;
  var downloadPageUrl = expResultUrl;
  var maxRetries = 10;

  for (var retry = 0; retry < maxRetries; retry++) {
    if (downloadHtml.indexOf('処理完了') !== -1 || downloadHtml.indexOf('ダウンロード') !== -1) {
      Logger.log('エクスポート処理完了を確認 (retry=' + retry + ')');
      break;
    }
    Logger.log('エクスポート処理中... (retry=' + retry + ')');
    Utilities.sleep(3000); // 3秒待機

    // ページをリロード
    var reloadResponse = fetchWithCookies_(downloadPageUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, reloadResponse);
    downloadHtml = reloadResponse.getContentText();
  }

  // ダウンロードボタンを押す
  var dlFormMatch = downloadHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var dlFormName = dlFormMatch ? dlFormMatch[1] : expFormName;
  var dlFields = extractAllFormFields_(downloadHtml, dlFormName);
  var dlPrefix = 'includeChildBody:' + dlFormName + ':';

  var dlPayload = {};
  var dlButtons = [];
  for (var dKey in dlFields) {
    if (dKey.match(/:do[A-Z]/)) {
      dlButtons.push(dKey.split(':').pop());
      continue;
    }
    dlPayload[dKey] = dlFields[dKey];
  }
  Logger.log('ダウンロードボタン候補(' + dlButtons.length + '): ' + dlButtons.join(', '));

  // doDownload ボタンを探す
  var doDownloadKey = null;
  for (var db = 0; db < dlButtons.length; db++) {
    if (dlButtons[db].indexOf('Download') !== -1 || dlButtons[db].indexOf('download') !== -1) {
      doDownloadKey = dlButtons[db];
      break;
    }
  }
  if (doDownloadKey) {
    dlPayload[dlPrefix + doDownloadKey] = '';
    Logger.log('ダウンロードボタン: ' + doDownloadKey);
  }

  var dlFormAction = extractFormAction_(downloadHtml, dlFormName);
  var dlPostUrl = dlFormAction
    ? resolveUrl_(posConfig.baseUrl, dlFormAction)
    : downloadPageUrl;

  Logger.log('ダウンロードPOST先: ' + dlPostUrl);

  var csvResponse = fetchWithCookies_(dlPostUrl, 'post', dlPayload, cookies);

  // 302リダイレクトをフォロー
  if (csvResponse.getResponseCode() === 302) {
    var csvRedirUrl = resolveUrl_(posConfig.baseUrl, csvResponse.getHeaders()['Location']);
    Logger.log('ダウンロードリダイレクト: ' + csvRedirUrl);
    csvResponse = fetchWithCookies_(csvRedirUrl, 'get', null, cookies);
  }

  // CSVかどうかチェック
  var respHeaders = csvResponse.getHeaders();
  var contentType = respHeaders['Content-Type'] || respHeaders['content-type'] || '';
  var contentDisposition = respHeaders['Content-Disposition'] || respHeaders['content-disposition'] || '';
  Logger.log('ダウンロード応答: Status=' + csvResponse.getResponseCode() + ', Type=' + contentType);
  Logger.log('Content-Disposition: ' + contentDisposition);

  var isCSV = contentDisposition.indexOf('csv') !== -1 ||
              contentDisposition.indexOf('attachment') !== -1 ||
              contentType.indexOf('octet-stream') !== -1 ||
              contentType.indexOf('text/csv') !== -1;

  if (csvResponse.getResponseCode() !== 200 || !isCSV) {
    var preview = csvResponse.getContentText().substring(0, 500);
    Logger.log('応答プレビュー: ' + preview);
    return {
      success: false,
      message: '商品マスタCSVが取得できませんでした\n' +
        'Status: ' + csvResponse.getResponseCode() + '\nType: ' + contentType + '\n\n' +
        'Apps Scriptの「実行ログ」に詳細があります。'
    };
  }


  // === STEP 7: Googleドライブに保存 ===
  Logger.log('STEP 7: Googleドライブに保存中...');

  var folderId = CONFIG.CSV_FOLDER_ID;
  if (!folderId || folderId.trim() === '') {
    return { success: false, message: 'GoogleドライブのCSV保存先フォルダIDが設定されていません。' };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, message: 'CSVフォルダにアクセスできません: ' + e.message };
  }

  var storePrefix = (posConfig.tenpoGroupName && posConfig.tenpoGroupName.indexOf('わんわん') !== -1)
    ? 'わんわん' : '本店';
  var today = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  var fileName = storePrefix + '_商品マスタ_' + dateStr + '.csv';

  // 同名ファイルがあればゴミ箱へ
  var existingFiles = folder.getFilesByName(fileName);
  while (existingFiles.hasNext()) {
    try { existingFiles.next().setTrashed(true); } catch (e) { /* skip */ }
  }

  var savedFile = folder.createFile(csvResponse.getBlob().setName(fileName));
  Logger.log('Googleドライブに保存完了: ' + savedFile.getName());


  // === STEP 8: Supabaseに同期 ===
  Logger.log('STEP 8: Supabaseに商品マスタを同期中...');

  var syncResult = null;
  var csvRowCount = 0;
  try {
    var result = processProductMasterCSV_(csvResponse.getBlob());
    syncResult = result;
    csvRowCount = result.count || 0;
  } catch (e) {
    Logger.log('商品マスタ同期エラー: ' + e.message);
    syncResult = { success: false, count: 0, message: 'Supabase同期エラー: ' + e.message };
  }

  Logger.log('========== 商品マスタCSVダウンロード完了 ==========');

  return {
    success: true,
    fileName: fileName,
    csvRowCount: csvRowCount,
    syncResult: syncResult,
  };
}


// ===================================================================
// 【入出庫履歴】POSポータル (hmma0244A) から入出庫履歴CSVをダウンロードし、JSONで返す
// ===================================================================
function downloadSalesHistoryFromPOS_(posConfig, startDate, endDate) {
  Logger.log('========== 入出庫履歴CSV取得開始 ==========');

  var loginUrl = posConfig.baseUrl + POS_PATHS.LOGIN;
  var getLoginResponse = UrlFetchApp.fetch(loginUrl, { method: 'get', followRedirects: true, muteHttpExceptions: true });
  var cookies = extractCookies_(getLoginResponse) || '';
  var loginPageHtml = getLoginResponse.getContentText();

  var formNameMatch = loginPageHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var formName = formNameMatch ? formNameMatch[1] : 'hmma00000Form';
  var loginPayload = extractAllFormFields_(loginPageHtml, formName);
  var formAction = extractFormAction_(loginPageHtml, formName);

  loginPayload[formName + ':loginId'] = posConfig.loginId;
  loginPayload[formName + ':password'] = posConfig.password;
  loginPayload[formName + ':saveLoginStatFlg'] = 'true';
  loginPayload[formName + ':doLogin'] = '送信';
  loginPayload[formName + ':companyCd'] = posConfig.companyCd;
  loginPayload[formName + ':loginMissCnt'] = '0';
  loginPayload[formName + ':companyKey'] = posConfig.companyKey;

  var postUrl = formAction ? resolveUrl_(posConfig.baseUrl, formAction) : loginUrl;
  var loginResponse = UrlFetchApp.fetch(postUrl, {
    method: 'post', payload: loginPayload, headers: { 'Cookie': cookies },
    followRedirects: false, muteHttpExceptions: true,
  });
  cookies = mergeCookies_(cookies, loginResponse);

  if (loginResponse.getResponseCode() === 302) {
    var redirectUrl = resolveUrl_(posConfig.baseUrl, loginResponse.getHeaders()['Location']);
    var dashResponse = fetchWithCookies_(redirectUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, dashResponse);
  }

  var historyUrl = resolveUrl_(posConfig.baseUrl, POS_PATHS.SALES_HISTORY);
  var historyResponse = fetchWithCookies_(historyUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, historyResponse);

  if (historyResponse.getResponseCode() === 302) {
    historyResponse = fetchWithCookies_(resolveUrl_(posConfig.baseUrl, historyResponse.getHeaders()['Location']), 'get', null, cookies);
    cookies = mergeCookies_(cookies, historyResponse);
  }
  var historyHtml = historyResponse.getContentText();

  var hFormMatch = historyHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var hFormName = hFormMatch ? hFormMatch[1] : 'hmma0244AForm';
  var hPayload = extractAllFormFields_(historyHtml, hFormName);

  var dateFields = Object.keys(hPayload).filter(function(k) { return k.match(/Date/i) || k.match(/sagyo/i); });
  var fromField = null;
  var toField = null;
  for (var i = 0; i < dateFields.length; i++) {
    if (dateFields[i].match(/From/i) || dateFields[i].match(/St/i)) fromField = dateFields[i];
    if (dateFields[i].match(/To/i) || dateFields[i].match(/Ed/i)) toField = dateFields[i];
  }
  if (fromField && startDate) hPayload[fromField] = startDate;
  if (toField && endDate) hPayload[toField] = endDate;
  
  var buttons = Object.keys(hPayload).filter(function(k) { return k.match(/:do[A-Z]/); });
  var searchBtn = null;
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].match(/Search/i)) searchBtn = buttons[i];
  }

  if (searchBtn) {
    var sPayload = JSON.parse(JSON.stringify(hPayload));
    sPayload[searchBtn] = '検索';
    for (var i = 0; i < buttons.length; i++) { if (buttons[i] !== searchBtn) delete sPayload[buttons[i]]; }
    var sResp = fetchWithCookies_(historyUrl, 'post', sPayload, cookies);
    cookies = mergeCookies_(cookies, sResp);
    historyHtml = sResp.getContentText();
    hPayload = extractAllFormFields_(historyHtml, hFormName);
  }

  var ePayload = JSON.parse(JSON.stringify(hPayload));
  buttons = Object.keys(hPayload).filter(function(k) { return k.match(/:do[A-Z]/); });
  var csvBtn = null;
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].match(/Csv/i) || buttons[i].match(/Export/i)) csvBtn = buttons[i];
  }
  if (csvBtn) {
    ePayload[csvBtn] = 'CSV';
  } else {
    ePayload[hFormName + ':doCsvExport'] = 'CSV';
  }
  
  for (var i = 0; i < buttons.length; i++) { if (buttons[i] !== csvBtn) delete ePayload[buttons[i]]; }
  
  var csvResponse = fetchWithCookies_(historyUrl, 'post', ePayload, cookies);
  var csvBlob = csvResponse.getBlob();
  var csvText = csvBlob.getDataAsString('Shift_JIS');
  
  if (!csvText || csvText.indexOf('ログイン') !== -1) {
    return { success: false, message: 'CSVの取得に失敗しました。', data: [] };
  }

  var lines = Utilities.parseCsv(csvText);
  if (lines.length === 0) return { success: true, data: [] };
  
  var header = lines[0];
  var results = [];
  var isHeader = header.join('').indexOf('商品名') !== -1 || header.join('').indexOf('コード') !== -1;
  var startIdx = isHeader ? 1 : 0;

  for (var i = startIdx; i < lines.length; i++) {
    if (lines[i].length < 5) continue;
    results.push({
      productCode: lines[i][0] || '',
      productName: lines[i][1] || '',
      taskContent: lines[i][2] || '',
      storeName: lines[i][3] || '',
      taskDateTime: lines[i][4] || '',
      quantity: parseInt(lines[i][5], 10) || 0,
      cost: parseInt(lines[i][6], 10) || 0,
      totalCost: parseInt(lines[i][7], 10) || 0,
    });
  }

  return { success: true, data: results, count: results.length };
}

// ===================================================================
// 【Web App】外部から HTTP GET で実行するためのエントリーポイント
// Next.js の API Route からこの URL を叩いてデータ取込を実行する
//
// パラメータ:
//   mode  = 'master' : 商品マスタ同期のみ
//           'sales'  : 商品別売上取込のみ（既存）
//           'full'   : 商品マスタ同期 → 商品別売上取込
//           'history': 当日等の入出庫履歴取得
//   month = 対象月（省略時は前月）
//   year  = 対象年（省略時は今年）
//   startDate, endDate = historyモード時の期間指定 (yyyy/MM/dd)
// ===================================================================
function doGet(e) {
  var mode = (e.parameter.mode || 'sales');
  
  if (mode === 'debug_properties') {
    var props = PropertiesService.getScriptProperties().getProperties();
    var safeProps = {};
    for (var k in props) {
      if (k.indexOf('PASSWORD') === -1 && k.indexOf('KEY') === -1) {
        safeProps[k] = props[k];
      }
    }
    return ContentService.createTextOutput(JSON.stringify(safeProps)).setMimeType(ContentService.MimeType.JSON);
  }

  var now = new Date();
  var targetMonth = e.parameter.month ? parseInt(e.parameter.month, 10) : now.getMonth();
  var targetYear = e.parameter.year ? parseInt(e.parameter.year, 10) : now.getFullYear();

  // getMonth() は 0-indexed なので、0月 = 前年12月
  if (targetMonth === 0) {
    targetMonth = 12;
    targetYear -= 1;
  }

  var posConfig = getPOSConfig_();
  if (posConfig) {
    if (e.parameter.tenpoGroupId) {
      posConfig.tenpoGroupId = e.parameter.tenpoGroupId;
    }
    if (e.parameter.tenpoGroupName) {
      posConfig.tenpoGroupName = e.parameter.tenpoGroupName;
    }
  }

  if (!posConfig) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: 'POS接続設定が未完了です。Sheetsのメニューから設定してください。' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var results = {};

  try {
    // 商品マスタ同期
    if (mode === 'master' || mode === 'full') {
      Logger.log('Web App: 商品マスタ同期を実行 (mode=' + mode + ')');
      results.master = downloadProductMasterFromPOS_(posConfig);
    }

    // 商品別売上取込
    if (mode === 'sales' || mode === 'full') {
      Logger.log('Web App: 商品別売上取込を実行 (mode=' + mode + ', ' + targetYear + '年' + targetMonth + '月)');
      results.sales = downloadProductSalesFromPOS_(posConfig, targetYear, targetMonth);
    }

    // 入出庫履歴取得
    if (mode === 'history') {
      var startDate = e.parameter.startDate || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');
      var endDate = e.parameter.endDate || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');
      Logger.log('Web App: 入出庫履歴取得を実行 (' + startDate + ' - ' + endDate + ')');
      results.history = downloadSalesHistoryFromPOS_(posConfig, startDate, endDate);
    }

    results.success = true;
    results.mode = mode;

  } catch (err) {
    Logger.log('Web App 実行エラー: ' + err.message);
    results.success = false;
    results.message = 'エラー: ' + err.message;
  }

  return ContentService.createTextOutput(
    JSON.stringify(results)
  ).setMimeType(ContentService.MimeType.JSON);
}

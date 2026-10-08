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
    success: Boolean(syncResult && syncResult.success !== false),
    message: syncResult && syncResult.message ? syncResult.message : '',
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

  // 1. input タグを全て検索（自己閉じタグと通常タグの両方に対応）
  var inputRegex = /<input[^>]*\/?>/gi;
  var inputMatch;

  while ((inputMatch = inputRegex.exec(html)) !== null) {
    var tag = inputMatch[0];
    totalInputs++;

    var nameMatch = tag.match(/name\s*=\s*"([^"]*)"/i) ||
                    tag.match(/name\s*=\s*'([^']*)'/i) ||
                    tag.match(/name\s*=\s*([^\s>]+)/i);
    if (!nameMatch) continue;

    var name = nameMatch[1];
    if (formIdPrefix && name.indexOf(formIdPrefix) === -1) continue;

    var valueMatch = tag.match(/value\s*=\s*"([^"]*)"/i) ||
                     tag.match(/value\s*=\s*'([^']*)'/i) ||
                     tag.match(/value\s*=\s*([^\s>]+)/i);
    var value = valueMatch ? valueMatch[1] : '';

    fields[name] = value;
  }

  // 2. select タグとその selected オプションを検索
  var selectRegex = /<select[^>]*>[\s\S]*?<\/select>/gi;
  var selectMatch;
  var totalSelects = 0;

  while ((selectMatch = selectRegex.exec(html)) !== null) {
    var selectBlock = selectMatch[0];
    totalSelects++;

    var sNameMatch = selectBlock.match(/name\s*=\s*"([^"]*)"/i) ||
                     selectBlock.match(/name\s*=\s*'([^']*)'/i) ||
                     selectBlock.match(/name\s*=\s*([^\s>]+)/i);
    if (!sNameMatch) continue;

    var sName = sNameMatch[1];
    if (formIdPrefix && sName.indexOf(formIdPrefix) === -1) continue;

    var selectedOpt = selectBlock.match(/<option[^>]*selected[^>]*value\s*=\s*"([^"]*)"/i) ||
                      selectBlock.match(/<option[^>]*selected[^>]*value\s*=\s*'([^']*)'/i) ||
                      selectBlock.match(/<option[^>]*value\s*=\s*"([^"]*)"[^>]*selected/i);
    var val = selectedOpt ? selectedOpt[1] : '';

    if (!selectedOpt) {
      var firstOpt = selectBlock.match(/<option[^>]*value\s*=\s*"([^"]*)"/i) ||
                     selectBlock.match(/<option[^>]*value\s*=\s*'([^']*)'/i);
      val = firstOpt ? firstOpt[1] : '';
    }

    fields[sName] = val;
  }

  Logger.log('extractAllFormFields_: 全input数=' + totalInputs + ', 全select数=' + totalSelects + ', "' + formIdPrefix + '"マッチ=' + Object.keys(fields).length);

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
function getPOSConfig_(e) {
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
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('POS_PRODUCT_MASTER_SYNC_ENABLED') !== 'true' ||
      properties.getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') !== 'true') {
    ui.alert('商品同期は停止中です', '専用の商品同期設定を確認してください。', ui.ButtonSet.OK);
    return;
  }
  var selected = ui.prompt('商品マスタ同期の店舗', '店舗番号を一つ入力してください。6: わんわん、7: 本店', ui.ButtonSet.OK_CANCEL);
  if (selected.getSelectedButton() !== ui.Button.OK) return;
  var input = selected.getResponseText().trim();
  if (input !== '6' && input !== '7') { ui.alert('店舗番号6または7を一つ指定してください。'); return; }
  var storeId = Number(input);
  var storeName = storeId === 6 ? 'わんわん' : '本店';
  var response = ui.alert('🏷️ 商品マスタ同期',
    storeName + 'のPOSポータルから商品マスタCSVをダウンロードし、\n' +
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
    var result = downloadFixedProductMasterSync_(storeId);

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
        productMasterSyncError_(result.code, result.outcome).message,
        ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('❌ エラー',
      '商品同期の結果を確認できません。前回同期の状態を確認してください。',
      ui.ButtonSet.OK);
  }
}


// ===================================================================
// 重複原因の件数診断。商品名・JAN・金額の実値は追加の診断結果へ出さない。
function inspectProductMasterSyncSafety_(rows) {
  var groups = Object.create(null);
  var result = {
    duplicateGroups: 0, duplicateExtraRows: 0, identicalRowGroups: 0,
    conflictingRowGroups: 0, mixedKindGroups: 0, missingJanRows: 0,
    missingNameRows: 0, shortRows: 0, invalidMoneyRows: 0,
    rowsByKind: Object.create(null), differingColumns: Object.create(null),
    duplicateProfile: {
      groupsByKind: { '1': 0, '2': 0, '3': 0, unknown: 0, mixed: 0 },
      groupSizeCounts: Object.create(null), rawIdenticalGroups: 0, normalizedVariantGroups: 0,
      transformAffectedGroups: { whitespace: 0, fullWidthDigits: 0, trailingDotZero: 0 },
    },
  };
  rows.forEach(function(row) {
    if (row.length < 12) result.shortRows++;
    var kind = row[2] === '1' || row[2] === '2' || row[2] === '3' ? row[2] : 'unknown';
    result.rowsByKind[kind] = (result.rowsByKind[kind] || 0) + 1;
    var jan = normalizeProductMasterJanCode_(row[3]);
    if (!jan) result.missingJanRows++;
    if (!(row[6] || '').trim()) result.missingNameRows++;
    if ([8, 11].some(function(i) { return !/^\d{1,9}$/.test((row[i] || '').replace(/[¥\\,\s]/g, '')); })) result.invalidMoneyRows++;
    if (!jan || isExcludedProductMasterJanCode_(jan)) return;
    var key = JSON.stringify([(row[0] || '').trim(), jan]);
    var values = row.map(function(value) { return value.trim(); });
    if (!groups[key]) groups[key] = { first: values, count: 0, kinds: Object.create(null), differences: Object.create(null),
      rawJanSpellings: Object.create(null), transforms: { whitespace: false, fullWidthDigits: false, trailingDotZero: false } };
    var group = groups[key];
    group.count++;
    group.kinds[kind] = true;
    // 元コードは関数内の比較にだけ使い、表記や商品値を診断結果へ出さない。
    var rawJan = (row[3] || '').toString(), trimmedJan = rawJan.trim();
    group.rawJanSpellings[rawJan] = true;
    if (rawJan !== trimmedJan) group.transforms.whitespace = true;
    if (/[０-９]/.test(trimmedJan)) group.transforms.fullWidthDigits = true;
    if (/\.[0０]$/.test(trimmedJan)) group.transforms.trailingDotZero = true;
    for (var i = 0; i < Math.max(values.length, group.first.length); i++) {
      if (values[i] !== group.first[i]) group.differences[i] = true;
    }
  });
  Object.keys(groups).forEach(function(key) {
    var group = groups[key];
    if (group.count < 2) return;
    result.duplicateGroups++;
    result.duplicateExtraRows += group.count - 1;
    var columns = Object.keys(group.differences);
    if (columns.length === 0) result.identicalRowGroups++;
    else result.conflictingRowGroups++;
    var kinds = Object.keys(group.kinds);
    if (kinds.length > 1) result.mixedKindGroups++;
    var profile = result.duplicateProfile, kind = kinds.length === 1 ? kinds[0] : 'mixed';
    profile.groupsByKind[kind]++;
    profile.groupSizeCounts[group.count] = (profile.groupSizeCounts[group.count] || 0) + 1;
    if (Object.keys(group.rawJanSpellings).length === 1) profile.rawIdenticalGroups++;
    else profile.normalizedVariantGroups++;
    Object.keys(group.transforms).forEach(function(name) {
      if (group.transforms[name]) profile.transformAffectedGroups[name]++;
    });
    columns.forEach(function(column) { result.differingColumns[column] = (result.differingColumns[column] || 0) + 1; });
  });
  return result;
}

// 【商品マスタ診断】CSVをDBへ送信せず、件数と先頭サンプルだけを確認する
function inspectProductMasterCSV_(csvBlob) {
  var csvContent = csvBlob.getDataAsString(CONFIG.CSV_ENCODING);
  if (csvContent.charCodeAt(0) === 0xFEFF) {
    csvContent = csvContent.substring(1);
  }

  var rows = Utilities.parseCsv(csvContent).filter(function(row) {
    return row.some(function(cell) { return cell.trim() !== ''; });
  });
  var rowWidthCounts = Object.create(null);
  rows.forEach(function(row) { rowWidthCounts[row.length] = (rowWidthCounts[row.length] || 0) + 1; });
  var janColumn = 3;
  var productGroupColumn = 5;
  var productNameColumn = 6;
  var seen = {};
  var storeCounts = {};
  var validCount = 0;
  var skippedCount = 0;
  var excludedCount = 0;
  var sample = [];
  var rowShapeSample = rows.slice(0, 3).map(function(row) {
    return {
      columnCount: row.length,
      cells: row.slice(0, 12).map(function(cell) {
        return (cell || '').toString().substring(0, 80);
      }),
    };
  });
  var maxColumns = rows.reduce(function(max, row) {
    return Math.max(max, row.length);
  }, 0);
  var columnStats = [];
  for (var columnIndex = 0; columnIndex < maxColumns; columnIndex++) {
    var uniqueValues = {};
    var nonEmptyCount = 0;
    var janLikeCount = 0;
    var examples = [];
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      var normalizedValue = normalizeProductMasterJanCode_(rows[rowIndex][columnIndex]);
      if (!normalizedValue) continue;
      nonEmptyCount++;
      uniqueValues[normalizedValue] = true;
      if (/^(\d{8}|\d{12}|\d{13})$/.test(normalizedValue)) {
        janLikeCount++;
      }
      if (examples.length < 3 && examples.indexOf(normalizedValue) === -1) {
        examples.push(normalizedValue.substring(0, 80));
      }
    }
    columnStats.push({
      columnIndex: columnIndex,
      nonEmptyCount: nonEmptyCount,
      uniqueCount: Object.keys(uniqueValues).length,
      janLikeCount: janLikeCount,
      examples: examples,
    });
  }

  for (var storeRowIndex = 0; storeRowIndex < rows.length; storeRowIndex++) {
    var storeCode = (rows[storeRowIndex][0] || '').toString().trim();
    var storeName = (rows[storeRowIndex][1] || '').toString().trim();
    var storeKey = storeCode + '\t' + storeName;
    if (!storeCode && !storeName) continue;
    storeCounts[storeKey] = (storeCounts[storeKey] || 0) + 1;
  }
  var storeSummary = Object.keys(storeCounts).map(function(storeKey) {
    var parts = storeKey.split('\t');
    return {
      storeCode: parts[0],
      storeName: parts[1],
      rowCount: storeCounts[storeKey],
    };
  });

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.length <= productNameColumn) {
      skippedCount++;
      continue;
    }

    var janCode = normalizeProductMasterJanCode_(row[janColumn]);
    var productName = (row[productNameColumn] || '').trim();
    if (isExcludedProductMasterJanCode_(janCode)) {
      excludedCount++;
      skippedCount++;
      continue;
    }
    if (!janCode || !productName || seen[janCode]) {
      skippedCount++;
      continue;
    }

    seen[janCode] = true;
    validCount++;
    if (sample.length < 5) {
      sample.push({
        janCode: janCode,
        productName: productName,
        productGroup: (row[productGroupColumn] || '').trim(),
      });
    }
  }

  return {
    rawRowCount: rows.length,
    validRowCount: validCount,
    skippedRowCount: skippedCount,
    excludedRowCount: excludedCount,
    sample: sample,
    rowShapeSample: rowShapeSample,
    columnStats: columnStats,
    rowWidthCounts: rowWidthCounts,
    storeSummary: storeSummary,
    syncSafety: inspectProductMasterSyncSafety_(rows),
  };
}


function isExpectedProductMasterStore_(storeSummary, targetStoreName) {
  if (!targetStoreName) return true;
  if (!storeSummary || storeSummary.length === 0) return false;

  var expectedNamePart = targetStoreName.indexOf('わんわん') !== -1 ? 'わんわん' : '本店';
  return storeSummary.every(function(store) {
    return store.storeName.indexOf(expectedNamePart) !== -1;
  });
}


// 実画面の出力契約を検証し、12列に必要な任意9項目を明示的にONにする。
// 入力名の推測や未チェック項目を拾う汎用抽出の副作用には依存しない。
function productMasterExportError_(reason) {
  var error = new Error('PRODUCT_EXPORT_FIELDS_INVALID');
  error.code = 'PRODUCT_SYNC_INVALID_DATA';
  error.outcome = 'rejected';
  error.productMasterSyncFailure = true;
  // 呼出し元で作る固定分類だけを持たせ、HTML・属性値・資格情報は含めない。
  error.exportFailureReason = reason;
  return error;
}

function productMasterExportAttributes_(tag) {
  var result = Object.create(null);
  var body = tag.replace(/^<\w+\b/i, '').replace(/\/?\s*>$/, '');
  var pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  var match;
  while ((match = pattern.exec(body)) !== null) {
    var key = match[1].toLowerCase();
    var value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];
    // 同じPOSの編集parserと同様、表示属性は使わず同一typeだけを認める。
    if (key === 'class' || key === 'style') continue;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      if (key === 'type' && typeof value === 'string' && value && result[key] === value) continue;
      var known = ['id', 'name', 'type', 'value', 'disabled', 'form'];
      throw productMasterExportError_('ATTRIBUTE_DUPLICATE_' + (known.indexOf(key) !== -1 ? key.toUpperCase() : 'OTHER'));
    }
    result[key] = value;
  }
  return result;
}

function productMasterExportForm_(html, formName, optional) {
  if (typeof html !== 'string' || ['hmma02405Form', 'hmma02494Form'].indexOf(formName) === -1) {
    throw productMasterExportError_('FORM');
  }
  var cleanHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  var forms = cleanHtml.match(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi) || [];
  var targetForms = forms.filter(function(form) {
    var opening = form.match(/^<form\b[^>]*>/i);
    var attrs = productMasterExportAttributes_(opening[0]);
    if (attrs.id !== formName) return false;
    if (attrs.name !== 'includeChildBody:' + formName) throw productMasterExportError_('FORM_NAME');
    return true;
  });
  if (optional && targetForms.length === 0) return null;
  if (targetForms.length !== 1 || (targetForms[0].match(/<form\b/gi) || []).length !== 1) {
    throw productMasterExportError_('FORM_COUNT');
  }
  return targetForms[0];
}

function productMasterNavigationFields_(formHtml, formName, command, waitForReady) {
  var allowed = formName === 'hmma02405Form' ? ['doSearch', 'goHmma02494'] : ['doDownload'];
  if (allowed.indexOf(command) === -1) throw productMasterExportError_('NAVIGATION_COMMAND');
  var prefix = 'includeChildBody:' + formName + ':';
  var buttons = (formHtml.match(/<input\b[^>]*>/gi) || []).map(productMasterExportAttributes_)
    .filter(function(attrs) { return attrs.name === prefix + command; });
  if (waitForReady && buttons.length === 0) return null;
  if (buttons.length !== 1) throw productMasterExportError_('NAVIGATION_BUTTON_COUNT');
  if ((buttons[0].type || '').toLowerCase() !== 'submit' ||
      (buttons[0].form !== undefined && buttons[0].form !== formName)) {
    throw productMasterExportError_('NAVIGATION_BUTTON_INVALID');
  }
  if (Object.prototype.hasOwnProperty.call(buttons[0], 'disabled')) {
    if (waitForReady) return null;
    throw productMasterExportError_('NAVIGATION_BUTTON_INVALID');
  }
  var fields = extractAllFormFields_(formHtml, formName), payload = {};
  Object.keys(fields).forEach(function(key) {
    // goHmmaもsubmit。未選択の遷移・出力ボタンを検索やダウンロードへ混ぜない。
    if (!/:(?:do|go)[A-Z]/.test(key)) payload[key] = fields[key];
  });
  payload[prefix + command] = '';
  return payload;
}

function configureProductMasterExportFields_(html, formName) {
  if (formName !== 'hmma02494Form') throw productMasterExportError_('FORM');
  var formHtml = productMasterExportForm_(html, formName);
  var prefix = 'includeChildBody:' + formName + ':';
  var names = ['ofNameChk', 'gdsSalesKbnChk', 'goodsGroupChk', 'goodsGroupNameChk',
    'goodsNameKanaChk', 'goodsPriceChk', 'liveMembersDispChk', 'goodsTaxCdChk', 'goodsCostChk'];
  var inputs = formHtml.match(/<input\b[^>]*>/gi) || [];
  var found = {};
  var exportButtons = 0;
  inputs.forEach(function(tag) {
    var attrs = productMasterExportAttributes_(tag);
    if (!attrs.name) return;
    if (attrs.name.indexOf(prefix) === 0 && attrs.form !== undefined && attrs.form !== formName) {
      throw productMasterExportError_('CONTROL_OWNER');
    }
    if (attrs.name === prefix + 'doExport') {
      if ((attrs.type || '').toLowerCase() !== 'submit' ||
          Object.prototype.hasOwnProperty.call(attrs, 'disabled')) throw productMasterExportError_('EXPORT_BUTTON_INVALID');
      exportButtons++;
    }
    var name = attrs.name.indexOf(prefix) === 0 ? attrs.name.substring(prefix.length) : '';
    var required = names.indexOf(name) !== -1;
    if ((attrs.type || '').toLowerCase() === 'checkbox' && !required) throw productMasterExportError_('CHECKBOX_UNEXPECTED');
    if (!required) return;
    if (found[name] || (attrs.type || '').toLowerCase() !== 'checkbox' || attrs.value !== 'true' ||
        Object.prototype.hasOwnProperty.call(attrs, 'disabled')) throw productMasterExportError_('CHECKBOX_INVALID');
    found[name] = true;
  });
  if (exportButtons !== 1) throw productMasterExportError_('EXPORT_BUTTON_COUNT');
  if (names.some(function(name) { return !found[name]; })) throw productMasterExportError_('CHECKBOX_MISSING');
  // 同じ接頭辞でも別formのhidden/checkbox/ボタンを持ち越さない。
  var scopedFields = extractAllFormFields_(formHtml, formName);
  var result = {};
  Object.keys(scopedFields).forEach(function(key) {
    if (!/:(?:do|go)[A-Z]/.test(key)) result[key] = scopedFields[key];
  });
  names.forEach(function(name) { result[prefix + name] = 'true'; });
  return { payload: result, buttonKey: prefix + 'doExport', formHtml: formHtml };
}


// 【商品マスタ】POSポータル (hmma02405) から全件CSVをダウンロードし、JSONで返す
// ===================================================================
function downloadProductMasterFromPOS_(posConfig, targetStoreName, options) {
  Logger.log('========== 商品マスタCSV取得開始 ==========');

  // 取得後では古いCSVを区別できないため、最初のPOS通信より前に店舗版を記録する。
  var syncContext = options && options.syncContext ? options.syncContext : null;
  if (syncContext && (!targetStoreName || syncContext.storeId !== productMasterSyncStoreId_(targetStoreName) || !productMasterSyncUuid_(syncContext.id))) {
    throw productMasterSyncError_('PRODUCT_SYNC_UNAVAILABLE', 'rejected');
  }
  if (!syncContext && PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') === 'true') {
    syncContext = beginCoordinatedProductMasterSync_(targetStoreName, options);
  }

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

  // 302リダイレクト処理...
  if (loginResponse.getResponseCode() === 302) {
    var dashboardUrl = resolveUrl_(posConfig.baseUrl, loginResponse.getHeaders()['Location']);
    Logger.log('ログイン成功、ダッシュボードへ遷移');
    var dashboardResponse = fetchWithCookies_(dashboardUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, dashboardResponse);
  }

  // 商品検索条件だけでは店舗が切り替わらないため、先にPOSのセッション店舗を確定する
  if (targetStoreName) {
    cookies = switchStoreContext_(posConfig.baseUrl, cookies, targetStoreName);
  }

  // === STEP 2: 商品マスタ検索画面 (hmma02405) へ遷移 ===
  Logger.log('STEP 2: 商品マスタ検索画面へアクセス');
  var searchPageUrl = resolveUrl_(posConfig.baseUrl, POS_PATHS.PRODUCT_MASTER);

  var searchResponse = fetchWithCookies_(searchPageUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, searchResponse);

  // 302リダイレクトをフォロー
  if (searchResponse.getResponseCode() === 302) {
    var redirUrl = resolveUrl_(posConfig.baseUrl, searchResponse.getHeaders()['Location']);
    Logger.log('商品検索リダイレクト');
    searchResponse = fetchWithCookies_(redirUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, searchResponse);
  }

  var searchHtml = searchResponse.getContentText();
  Logger.log('商品検索ページ: Status=' + searchResponse.getResponseCode() + ', Size=' + searchHtml.length);

  // セッション切れチェック
  if (searchHtml.indexOf('ログイン画面') !== -1) {
    return { success: false, message: 'セッションが切れました。再度お試しください。' };
  }

  // 検索画面の実フォームを一意に検査し、別form/古いprefixを採用しない。
  var searchFormName = 'hmma02405Form';
  var searchFormHtml = productMasterExportForm_(searchHtml, searchFormName);
  Logger.log('検出フォーム名: ' + searchFormName);


  // === STEP 3: 店舗グループを設定して「検索」実行 ===
  Logger.log('STEP 3: 店舗グループ設定 → 検索実行');

  var searchPayload = productMasterNavigationFields_(searchFormHtml, searchFormName, 'doSearch');
  applyTenpoParamsGlobal_(searchPayload, searchFormHtml, searchFormName, targetStoreName);
  Logger.log('検索実行ボタン: doSearch');

  var searchFormAction = extractFormAction_(searchFormHtml, searchFormName);
  var searchPostUrl = searchFormAction
    ? resolveUrl_(posConfig.baseUrl, searchFormAction)
    : searchPageUrl;

  var searchResult = fetchWithCookies_(searchPostUrl, 'post', searchPayload, cookies);
  cookies = mergeCookies_(cookies, searchResult);

  // 302リダイレクトをフォロー
  var searchResultUrl = searchPostUrl;
  if (searchResult.getResponseCode() === 302) {
    searchResultUrl = resolveUrl_(posConfig.baseUrl, searchResult.getHeaders()['Location']);
    Logger.log('検索結果リダイレクト');
    searchResult = fetchWithCookies_(searchResultUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, searchResult);
  }

  var searchResultHtml = searchResult.getContentText();
  Logger.log('検索結果: Status=' + searchResult.getResponseCode() + ', Size=' + searchResultHtml.length);


  // === STEP 4: 「商品データのエクスポート」ボタンを押す ===
  Logger.log('STEP 4: エクスポート画面へ遷移');

  var exportPageUrl = searchResultUrl;
  var exportPageHtml = searchResultHtml;
  if (productMasterExportForm_(searchResultHtml, 'hmma02494Form', true)) {
    Logger.log('検索応答はエクスポート画面。不要な再POSTを省略');
  } else {
    var currentSearchForm = productMasterExportForm_(searchResultHtml, searchFormName);
    var exportPayload = productMasterNavigationFields_(currentSearchForm, searchFormName, 'goHmma02494');
    applyTenpoParamsGlobal_(exportPayload, currentSearchForm, searchFormName, targetStoreName);
    var exportFormAction = extractFormAction_(currentSearchForm, searchFormName);
    var exportPostUrl = exportFormAction ? resolveUrl_(posConfig.baseUrl, exportFormAction) : searchResultUrl;
    Logger.log('エクスポート遷移ボタン: goHmma02494');
    var exportNavResponse = fetchWithCookies_(exportPostUrl, 'post', exportPayload, cookies);
    cookies = mergeCookies_(cookies, exportNavResponse);
    exportPageUrl = exportPostUrl;
    if (exportNavResponse.getResponseCode() === 302) {
      exportPageUrl = resolveUrl_(posConfig.baseUrl, exportNavResponse.getHeaders()['Location']);
      Logger.log('エクスポート画面リダイレクト');
      exportNavResponse = fetchWithCookies_(exportPageUrl, 'get', null, cookies);
      cookies = mergeCookies_(cookies, exportNavResponse);
    }
    exportPageHtml = exportNavResponse.getContentText();
  }
  Logger.log('エクスポート画面: Size=' + exportPageHtml.length);


  // === STEP 5: エクスポート画面でチェックボックス設定 → エクスポート実行 ===
  Logger.log('STEP 5: エクスポート出力項目を設定 → エクスポート実行');

  var expFormName = 'hmma02494Form';
  Logger.log('エクスポート画面フォーム名: ' + expFormName);

  // 必須3項目はPOS固定出力。任意9項目は実フォーム契約の検証後に指定する。
  var exportContract = configureProductMasterExportFields_(exportPageHtml, expFormName);
  var expPayload = exportContract.payload;
  expPayload[exportContract.buttonKey] = '';
  Logger.log('エクスポート実行ボタン: doExport');

  var expFormAction = extractFormAction_(exportContract.formHtml, expFormName);
  var expPostUrl = expFormAction
    ? resolveUrl_(posConfig.baseUrl, expFormAction)
    : exportPageUrl;

  Logger.log('エクスポートを一回送信');

  var expResponse = fetchWithCookies_(expPostUrl, 'post', expPayload, cookies);
  cookies = mergeCookies_(cookies, expResponse);

  // リダイレクトをフォロー
  var expResultUrl = expPostUrl;
  if (expResponse.getResponseCode() === 302) {
    expResultUrl = resolveUrl_(posConfig.baseUrl, expResponse.getHeaders()['Location']);
    Logger.log('エクスポート結果リダイレクト');
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

  // 前回のエクスポート完了表示を拾わないよう、新規処理の開始後に一度待って再読込する
  Utilities.sleep(3000);
  var initialReloadResponse = fetchWithCookies_(downloadPageUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, initialReloadResponse);
  downloadHtml = initialReloadResponse.getContentText();

  var dlFormName = 'hmma02494Form';
  var dlFormHtml, dlPayload = null;
  for (var retry = 0; retry <= maxRetries; retry++) {
    dlFormHtml = productMasterExportForm_(downloadHtml, dlFormName);
    dlPayload = productMasterNavigationFields_(dlFormHtml, dlFormName, 'doDownload', true);
    // 案内文や無効ボタンは処理中にも存在する。実submitの有効化を待つ。
    if (dlPayload) {
      Logger.log('エクスポート処理完了を確認 (retry=' + retry + ')');
      break;
    }
    // 最後に取得した応答も検査し、待機上限では追加通信しない。
    if (retry === maxRetries) break;
    Logger.log('エクスポート処理中... (retry=' + retry + ')');
    Utilities.sleep(3000); // 3秒待機

    // ページをリロード
    var reloadResponse = fetchWithCookies_(downloadPageUrl, 'get', null, cookies);
    cookies = mergeCookies_(cookies, reloadResponse);
    downloadHtml = reloadResponse.getContentText();
  }

  if (!dlPayload) throw productMasterExportError_('DOWNLOAD_NOT_READY');
  Logger.log('ダウンロードボタン: doDownload');
  var dlFormAction = extractFormAction_(dlFormHtml, dlFormName);
  var dlPostUrl = dlFormAction
    ? resolveUrl_(posConfig.baseUrl, dlFormAction)
    : downloadPageUrl;

  Logger.log('ダウンロードを一回送信');

  var csvResponse = fetchWithCookies_(dlPostUrl, 'post', dlPayload, cookies);

  // 302リダイレクトをフォロー
  if (csvResponse.getResponseCode() === 302) {
    var csvRedirUrl = resolveUrl_(posConfig.baseUrl, csvResponse.getHeaders()['Location']);
    Logger.log('ダウンロードリダイレクト');
    csvResponse = fetchWithCookies_(csvRedirUrl, 'get', null, cookies);
  }

  // CSVかどうかチェック
  var respHeaders = csvResponse.getHeaders();
  var contentType = respHeaders['Content-Type'] || respHeaders['content-type'] || '';
  var contentDisposition = respHeaders['Content-Disposition'] || respHeaders['content-disposition'] || '';
  Logger.log('商品マスタダウンロード応答: Status=' + csvResponse.getResponseCode());

  var isCSV = contentDisposition.indexOf('csv') !== -1 ||
              contentDisposition.indexOf('attachment') !== -1 ||
              contentType.indexOf('octet-stream') !== -1 ||
              contentType.indexOf('text/csv') !== -1;

  if (csvResponse.getResponseCode() !== 200 || !isCSV) {
    Logger.log('商品マスタCSVを取得できませんでした。');
    return {
      success: false,
      message: '商品マスタCSVが取得できませんでした\n' +
        'Status: ' + csvResponse.getResponseCode() + '\nType: ' + contentType + '\n\n' +
        'Apps Scriptの「実行ログ」に詳細があります。'
    };
  }

  var inspection = inspectProductMasterCSV_(csvResponse.getBlob());
  if (!isExpectedProductMasterStore_(inspection.storeSummary, targetStoreName)) {
    Logger.log('商品マスタ店舗不一致: target=' + targetStoreName +
      ', actual=' + JSON.stringify(inspection.storeSummary));
    return {
      success: false,
      message: '取得した商品マスタCSVの店舗が要求店舗と一致しないため、同期を中止しました。',
      diagnostics: {
        targetStoreName: targetStoreName || null,
        storeSummary: inspection.storeSummary,
      },
    };
  }

  // 診断時は外部データを変更せず、CSVの内容確認だけで終了する
  if (options && options.dryRun === true) {
    Logger.log('商品マスタ診断完了: raw=' + inspection.rawRowCount +
      ', valid=' + inspection.validRowCount + ', skipped=' + inspection.skippedRowCount);
    return {
      success: true,
      dryRun: true,
      csvRowCount: inspection.validRowCount,
      syncResult: null,
      diagnostics: {
        targetStoreName: targetStoreName || null,
        requestedTenpoGroupId: posConfig.tenpoGroupId || null,
        requestedTenpoGroupName: posConfig.tenpoGroupName || null,
        rawRowCount: inspection.rawRowCount,
        skippedRowCount: inspection.skippedRowCount,
        excludedRowCount: inspection.excludedRowCount,
        sample: inspection.sample,
        rowShapeSample: inspection.rowShapeSample,
        columnStats: inspection.columnStats,
        rowWidthCounts: inspection.rowWidthCounts,
        storeSummary: inspection.storeSummary,
        syncSafety: inspection.syncSafety,
      },
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

  var storePrefix = targetStoreName || '本店';
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
    var result = processProductMasterCSV_(csvResponse.getBlob(), storePrefix, syncContext);
    syncResult = result;
    csvRowCount = result.count || 0;
  } catch (e) {
    if (syncContext) {
      syncResult = productMasterSyncFailure_(e, syncContext.storeId, syncContext.id);
      Logger.log('商品マスタ同期エラー: ' + syncResult.code);
    } else {
      Logger.log('商品マスタ同期エラー');
      syncResult = { success: false, count: 0, message: '商品マスタを同期できませんでした。' };
    }
  }

  Logger.log('========== 商品マスタCSVダウンロード完了 ==========');

  return {
    success: Boolean(syncResult && syncResult.success !== false),
    message: syncResult && syncResult.message ? syncResult.message : '',
    fileName: fileName,
    csvRowCount: csvRowCount,
    syncResult: syncResult,
    code: syncResult && syncResult.code,
    outcome: syncResult && syncResult.outcome,
    storeId: syncContext ? syncContext.storeId : undefined,
    runId: syncContext ? syncContext.id : undefined,
  };
}


// ===================================================================
// 【入出庫履歴】POSポータル (hmma0244A) から入出庫履歴CSVをダウンロードし、JSONで返す
// ===================================================================
function findFormFieldKeyBySuffix_(fields, suffix) {
  var keys = Object.keys(fields || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === suffix || keys[i].slice(-(suffix.length + 1)) === ':' + suffix) {
      return keys[i];
    }
  }
  return null;
}


function buildHistoryStoreSelectionPayload_(fields, tenpoGroupId) {
  var payload = JSON.parse(JSON.stringify(fields || {}));
  var groupField = findFormFieldKeyBySuffix_(payload, 'schTenpoGroup');
  var selectButton = findFormFieldKeyBySuffix_(payload, 'doSelectTenpoGroup');
  if (!groupField || !selectButton || !tenpoGroupId) return null;

  payload[groupField] = tenpoGroupId;
  payload[selectButton] = payload[selectButton] || '店舗グループ選択';

  var keys = Object.keys(payload);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].match(/:do[A-Z]/) && keys[i] !== selectButton) {
      delete payload[keys[i]];
    }
  }

  return {
    payload: payload,
    groupField: groupField,
    selectButton: selectButton,
  };
}


function removeUncheckedCheckboxFields_(html, payload) {
  var checkboxRegex = /<input[^>]*type\s*=\s*["']checkbox["'][^>]*>/gi;
  var checkboxMatch;
  while ((checkboxMatch = checkboxRegex.exec(html)) !== null) {
    var checkboxTag = checkboxMatch[0];
    var nameMatch = checkboxTag.match(/name\s*=\s*["']([^"']+)["']/i);
    if (nameMatch && checkboxTag.indexOf('checked') === -1) {
      delete payload[nameMatch[1]];
    }
  }
  return payload;
}


function selectHistoryStoreGroup_(baseUrl, historyUrl, historyHtml, formName, cookies, tenpoGroupId) {
  var fields = removeUncheckedCheckboxFields_(
    historyHtml,
    extractAllFormFields_(historyHtml, formName)
  );
  var selection = buildHistoryStoreSelectionPayload_(fields, tenpoGroupId);
  if (!selection) {
    return {
      success: false,
      message: '履歴画面の店舗グループ選択フィールドが見つかりませんでした。',
      cookies: cookies,
      html: historyHtml,
      formName: formName,
    };
  }

  var formAction = extractFormAction_(historyHtml, formName);
  var postUrl = formAction ? resolveUrl_(baseUrl, formAction) : historyUrl;
  Logger.log('【履歴店舗選択】' + selection.groupField + '=' + tenpoGroupId +
    ', button=' + selection.selectButton);

  var response = fetchWithCookies_(postUrl, 'post', selection.payload, cookies);
  var responseCookies = mergeCookies_(cookies, response);
  var status = response.getResponseCode();
  if (status === 302) {
    var location = response.getHeaders()['Location'];
    if (!location) {
      return {
        success: false,
        message: '履歴画面の店舗選択後リダイレクト先を取得できませんでした。',
        cookies: responseCookies,
        html: response.getContentText(),
        formName: formName,
      };
    }
    response = fetchWithCookies_(resolveUrl_(baseUrl, location), 'get', null, responseCookies);
    responseCookies = mergeCookies_(responseCookies, response);
    status = response.getResponseCode();
  }

  var responseHtml = response.getContentText();
  var responseFormMatch = responseHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
  var responseFormName = responseFormMatch ? responseFormMatch[1] : formName;
  Logger.log('【履歴店舗選択】応答Status=' + status + ', form=' + responseFormName);

  return {
    success: status === 200,
    message: status === 200 ? '' : '履歴画面の店舗選択に失敗しました（Status ' + status + '）。',
    cookies: responseCookies,
    html: responseHtml,
    formName: responseFormName,
  };
}


function normalizeHistoryHeaderName_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
    .trim();
}


function findStableHistoryIdCandidateHeaders_(headers) {
  var patterns = [
    /^(id|ｉｄ)$/i,
    /(取引|トランザクション|伝票|レシート|会計|売上|入出庫).*(id|ｉｄ|番号|no\.?)/i,
    /(transaction|receipt|event|record)[ _-]?(id|no|number)/i,
  ];
  var candidates = [];

  for (var i = 0; i < headers.length; i++) {
    var header = normalizeHistoryHeaderName_(headers[i]);
    if (!header) continue;
    for (var j = 0; j < patterns.length; j++) {
      if (patterns[j].test(header)) {
        candidates.push(header);
        break;
      }
    }
  }

  return candidates;
}


function isHistorySchemaDiagnosticAuthorized_(providedToken) {
  var expectedToken = PropertiesService.getScriptProperties()
    .getProperty('HISTORY_SCHEMA_DIAGNOSTIC_TOKEN');
  return Boolean(expectedToken) && String(providedToken || '') === expectedToken;
}


function buildHistorySchemaDiagnostic_(header, dataRows, headerDetected) {
  var safeRows = Array.isArray(dataRows) ? dataRows : [];
  var safeHeaders = headerDetected && Array.isArray(header)
    ? header.map(normalizeHistoryHeaderName_)
    : [];
  var rowColumnCounts = {};
  var columnCount = safeHeaders.length;

  for (var i = 0; i < safeRows.length; i++) {
    var width = Array.isArray(safeRows[i]) ? safeRows[i].length : 0;
    rowColumnCounts[String(width)] = (rowColumnCounts[String(width)] || 0) + 1;
    if (width > columnCount) columnCount = width;
  }

  var candidateHeaders = findStableHistoryIdCandidateHeaders_(safeHeaders);
  return {
    headerDetected: Boolean(headerDetected),
    headers: safeHeaders,
    columnCount: columnCount,
    dataRowCount: safeRows.length,
    rowColumnCounts: rowColumnCounts,
    stableTransactionIdCandidateHeaders: candidateHeaders,
    stableTransactionIdVerified: false,
  };
}


function parseSalesHistoryCsv_(csvText, options) {
  var parseOptions = options || {};
  var lines = Utilities.parseCsv(csvText);
  if (!lines || lines.length === 0) {
    return {
      success: true,
      data: [],
      count: 0,
      schema: parseOptions.schemaOnly
        ? buildHistorySchemaDiagnostic_([], [], false)
        : undefined,
    };
  }

  var header = lines[0];
  var headerText = Array.isArray(header) ? header.join('') : '';
  var isHeader = headerText.indexOf('商品名') !== -1 || headerText.indexOf('コード') !== -1;
  var startIdx = isHeader ? 1 : 0;
  var dataRows = lines.slice(startIdx);
  var schema = buildHistorySchemaDiagnostic_(header, dataRows, isHeader);

  if (parseOptions.schemaOnly) {
    return { success: true, data: [], count: 0, schema: schema };
  }

  var results = [];
  for (var i = 0; i < dataRows.length; i++) {
    if (!Array.isArray(dataRows[i]) || dataRows[i].length < 5) continue;
    results.push({
      productCode: dataRows[i][0] || '',
      productName: dataRows[i][1] || '',
      taskContent: dataRows[i][2] || '',
      storeName: dataRows[i][3] || '',
      taskDateTime: dataRows[i][4] || '',
      quantity: parseInt(dataRows[i][5], 10) || 0,
      cost: parseInt(dataRows[i][6], 10) || 0,
      totalCost: parseInt(dataRows[i][7], 10) || 0,
    });
  }

  return { success: true, data: results, count: results.length };
}


function downloadSalesHistoryFromPOS_(posConfig, startDate, endDate, options) {
  var downloadOptions = options || {};
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
  var storeSelection = selectHistoryStoreGroup_(
    posConfig.baseUrl,
    historyUrl,
    historyHtml,
    hFormName,
    cookies,
    posConfig.tenpoGroupId
  );
  if (!storeSelection.success) {
    return { success: false, message: storeSelection.message, data: [] };
  }
  cookies = storeSelection.cookies;
  historyHtml = storeSelection.html;
  hFormName = storeSelection.formName;
  var hPayload = removeUncheckedCheckboxFields_(
    historyHtml,
    extractAllFormFields_(historyHtml, hFormName)
  );



  var targetStoreStr = posConfig.tenpoGroupName && posConfig.tenpoGroupName.indexOf('わんわん') !== -1 ? 'わんわん' : 'からつケンネル';

  // 1. セレクトボックス等の動的適用
  applyTenpoParamsGlobal_(hPayload, historyHtml, hFormName, targetStoreStr);

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
    if (buttons[i].match(/Search|Serch/i)) searchBtn = buttons[i];
  }

  if (searchBtn) {
    var sPayload = JSON.parse(JSON.stringify(hPayload));
    sPayload[searchBtn] = '検索';
    for (var i = 0; i < buttons.length; i++) { if (buttons[i] !== searchBtn) delete sPayload[buttons[i]]; }
    var sResp = fetchWithCookies_(historyUrl, 'post', sPayload, cookies);
    cookies = mergeCookies_(cookies, sResp);
    historyHtml = sResp.getContentText();
    hPayload = removeUncheckedCheckboxFields_(
      historyHtml,
      extractAllFormFields_(historyHtml, hFormName)
    );
    applyTenpoParamsGlobal_(hPayload, historyHtml, hFormName, targetStoreStr); // 検索応答後も再度店舗パラメータを適用
  }

  var ePayload = JSON.parse(JSON.stringify(hPayload));

  applyTenpoParamsGlobal_(ePayload, historyHtml, hFormName, targetStoreStr);

  for (var key in ePayload) {
    if (key.match(/schTenpoGroup/i) && !key.match(/Name/i)) {
      ePayload[key] = posConfig.tenpoGroupId;
      Logger.log('【店舗切替(Export)】左上コンテキスト強制セット: ' + key + ' = ' + posConfig.tenpoGroupId);
    }
    if (key.match(/selectTenpoGroupName/i)) {
      ePayload[key] = posConfig.tenpoGroupName;
    }
  }
  ePayload['includeChildBody:' + hFormName + ':schTenpoGroup'] = posConfig.tenpoGroupId;
  ePayload['includeChildBody:' + hFormName + ':selectTenpoGroupName'] = posConfig.tenpoGroupName;


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

  Logger.log('【履歴ボタン一覧】' + buttons.join(', ') + ' | 採択ボタン=' + (csvBtn || (hFormName + ':doCsvExport')));
  var csvResponse = fetchWithCookies_(historyUrl, 'post', ePayload, cookies);
  var csvBlob = csvResponse.getBlob();
  var csvText = csvBlob.getDataAsString('Shift_JIS');

  Logger.log('【入出庫レスポンス情報】Status=' + csvResponse.getResponseCode() + ' | Content-Type=' + JSON.stringify(csvResponse.getHeaders()['Content-Type']));

  if (!csvText || csvText.indexOf('ログイン') !== -1) {
    return { success: false, message: 'CSVの取得に失敗しました。', data: [] };
  }

  var lines = Utilities.parseCsv(csvText);
  Logger.log('【パース結果行数】=' + lines.length);
  if (lines.length > 0) {
    var firstRowText = Array.isArray(lines[0]) ? lines[0].join('') : '';
    var headerDetected = firstRowText.indexOf('商品名') !== -1 || firstRowText.indexOf('コード') !== -1;
    // 通常取得でも商品名・JAN・取引値をGASログへ残さない。
    Logger.log('【履歴CSV構造】headerDetected=' + headerDetected +
      ' | columnCount=' + (Array.isArray(lines[0]) ? lines[0].length : 0));
  }
  var parsed = parseSalesHistoryCsv_(csvText, downloadOptions);

  return {
    success: parsed.success,
    data: parsed.data,
    count: parsed.count,
    schema: parsed.schema,
    targetStore: {
      id: posConfig ? posConfig.tenpoGroupId : null,
      name: posConfig ? posConfig.tenpoGroupName : null,
    },
  };
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
//           'history_schema': 入出庫履歴CSVのヘッダー診断（行データは返さない）
//   month = 対象月（省略時は前月）
//   year  = 対象年（省略時は今年）
//   startDate, endDate = historyモード時の期間指定 (yyyy/MM/dd)
// ===================================================================

// ===================================================================
// 【Web App】外部からの POST リクエスト受け取り（セキュアな通信用）
// ===================================================================
function doPost(e) {
  var params = {};
  // 署名要求をmode経路より先に分離する。部分的な署名/不正JSONを従来の同期へ流さない。
  try {
    if (e && e.postData) {
      var body = e.postData.contents;
      if (typeof body !== 'string' || !body || body.length > 24576 ||
          Utilities.newBlob(body).getBytes().length > 24576) throw new Error('INVALID_BODY');
      params = JSON.parse(body);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('INVALID_BODY');
      // 商品同期専用audienceを先に分離し、不正要求を既存modeへ流さない。
      if (params.audience === 'kennel.product-master-sync.request.v1' ||
          Object.prototype.hasOwnProperty.call(params, 'requestId')) {
        if (typeof e.postData.type !== 'string' || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(e.postData.type)) throw new Error('INVALID_SYNC_REQUEST');
        var masterResponse = handleProductMasterSyncRequest_(body);
        return ContentService.createTextOutput(JSON.stringify(masterResponse)).setMimeType(ContentService.MimeType.JSON);
      }
      var signedKeys = ['version', 'audience', 'action', 'operationId', 'actorId', 'storeId',
        'issuedAt', 'expiresAt', 'payload', 'payloadHash', 'signature'];
      var signedRequest = signedKeys.some(function(key) { return Object.prototype.hasOwnProperty.call(params, key); });
      if (signedRequest) {
        if (PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_PUBLIC_GATEWAY_ENABLED') !== 'true' ||
            typeof e.postData.type !== 'string' || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(e.postData.type) ||
            Object.keys(params).length !== signedKeys.length ||
            signedKeys.some(function(key) { return !Object.prototype.hasOwnProperty.call(params, key); }) ||
            params.version !== 1 || params.audience !== 'kennel.pos-products.v1' ||
            (params.action !== 'inspect' && params.action !== 'dispatch')) throw new Error('INVALID_SIGNED_REQUEST');
        // 個別handlerが専用フラグ・署名・対象を再検査する。業務結果にlegacyログを付けない。
        var response = params.action === 'inspect' ? handlePosProductInspection_(body) : handlePosProductEditDispatch_(body);
        return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
      }
    }
  } catch (_) {
    // 本文、JSON例外、署名、資格情報、既存Loggerの内容は外部へ返さない。
    return ContentService.createTextOutput(JSON.stringify({
      version: 1, success: false, code: 'POS_PRODUCT_PUBLIC_GATEWAY_UNAVAILABLE',
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var results = {};
  try {
    var mode = params.mode || 'history';
    results.mode = mode;
    if ((mode === 'master' || mode === 'full') &&
        (PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') === 'true' ||
         PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_MASTER_SYNC_ENABLED') === 'true')) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, mode: mode, code: 'PRODUCT_SYNC_DISABLED', outcome: 'rejected' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (mode === 'history_schema' && !isHistorySchemaDiagnosticAuthorized_(params.diagnosticToken)) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        mode: mode,
        message: '履歴スキーマ診断の認証に失敗しました。',
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ベース設定をプロパティから取得
    var posConfig = getPOSConfig_();
    if (!posConfig) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, message: 'POS接続設定が未完了です。' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // POSTされた動的パラメータで上書き（わんわん等）
    if (params.lid) posConfig.loginId = params.lid;
    if (params.lpw) posConfig.password = params.lpw;
    if (params.lcd) posConfig.companyCd = params.lcd;
    // 別店舗アカウントでは本店用companyKeyを引き継がないよう、空文字も上書き対象にする
    if (params.lkey !== undefined) posConfig.companyKey = params.lkey;
    if (params.companyKey !== undefined) posConfig.companyKey = params.companyKey;
    if (params.tenpoGroupId) posConfig.tenpoGroupId = params.tenpoGroupId;
    if (params.tenpoGroupName) posConfig.tenpoGroupName = params.tenpoGroupName;
    var targetStoreName = params.targetStoreName || (posConfig.tenpoGroupName && posConfig.tenpoGroupName.indexOf('わんわん') !== -1 ? 'わんわん' : '本店');

    var targetYear = params.year ? parseInt(params.year, 10) : new Date().getFullYear();
    var targetMonth = params.month ? parseInt(params.month, 10) : new Date().getMonth();
    if (targetMonth === 0) { targetMonth = 12; targetYear--; }
    var now = new Date();

    // 商品マスタ同期
    if (mode === 'master' || mode === 'full') {
      Logger.log('Web App(POST): 商品マスタ同期を実行 (mode=' + mode + ')');
      var dryRun = params.dryRun === true || params.dryRun === 'true';
      results.master = downloadProductMasterFromPOS_(posConfig, targetStoreName, { dryRun: dryRun });
    }

    // 商品別売上取込
    if (mode === 'sales' || mode === 'full') {
      Logger.log('Web App(POST): 商品別売上取込を実行 (mode=' + mode + ')');
      results.sales = downloadProductSalesFromPOS_(posConfig, targetYear, targetMonth);
    }

    // 入出庫履歴取得
    if (mode === 'history' || mode === 'history_schema') {
      var startDate = params.startDate || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');
      var endDate = params.endDate || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');
      var schemaOnly = mode === 'history_schema';
      Logger.log('Web App(POST): 入出庫履歴取得を実行 (' + startDate + ' - ' + endDate + ', schemaOnly=' + schemaOnly + ')');
      results.history = downloadSalesHistoryFromPOS_(posConfig, startDate, endDate, { schemaOnly: schemaOnly });
    }

    results.success = ['master', 'sales', 'history'].every(function(resultName) {
      return !results[resultName] || results[resultName].success !== false;
    });
    results.mode = mode;

  } catch (err) {
    Logger.log('Web App(POST) 実行エラー: ' + err.message);
    results.success = false;
    results.message = 'エラー: ' + err.message;
  }

  // ヘッダー診断は行データやログ断片を外部へ返さない。
  results.logs = results.mode === 'history_schema' ? '' : Logger.getLog();

  return ContentService.createTextOutput(
    JSON.stringify(results)
  ).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : 'history';
  if ((mode === 'master' || mode === 'full') &&
      (PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_SYNC_FENCE_ENABLED') === 'true' ||
       PropertiesService.getScriptProperties().getProperty('POS_PRODUCT_MASTER_SYNC_ENABLED') === 'true')) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, mode: mode, code: 'PRODUCT_SYNC_DISABLED', outcome: 'rejected' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (mode === 'history_schema') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      mode: mode,
      message: '履歴スキーマ診断は認証付きPOSTだけを許可しています。',
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 外部からのパラメータ受け取り用
  var posConfig = getPOSConfig_(e);
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

  var targetYear = (e && e.parameter && e.parameter.year) ? parseInt(e.parameter.year, 10) : new Date().getFullYear();
  var targetMonth = (e && e.parameter && e.parameter.month) ? parseInt(e.parameter.month, 10) : new Date().getMonth();
  if (targetMonth === 0) { targetMonth = 12; targetYear--; }
  var now = new Date();

  var results = { mode: mode };

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

    if (mode === 'testJS') {
      return testGetTenpoDialogJS();
    }
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

  // ヘッダー診断は行データやログ断片を外部へ返さない。
  results.logs = results.mode === 'history_schema' ? '' : Logger.getLog();

  return ContentService.createTextOutput(
    JSON.stringify(results)
  ).setMimeType(ContentService.MimeType.JSON);
}

// ===================================================================
// 【店舗切替】ログインセッションのコンテキスト店舗を動的に切り替える
// ===================================================================
function switchStoreContext_(baseUrl, cookies, storeNameTarget) {
  Logger.log('【店舗切替】セッション店舗の切り替えを開始します。対象: ' + storeNameTarget);

  try {
    var tcUrl = resolveUrl_(baseUrl, '/hm-hmma/view/hmma/hmma000/hmma00002.html');
    var tcResp = fetchWithCookies_(tcUrl, 'get', null, cookies);
    var tcCookies = mergeCookies_(cookies, tcResp);
    var tcHtml = tcResp.getContentText();

    if (tcHtml.indexOf('店舗切替') === -1 && tcHtml.indexOf('店舗選択') === -1) {
      Logger.log('店舗切替画面にアクセスできませんでした（ダッシュボードか別画面とみなしてスキップ）');
      return cookies;
    }

    var tcFormMatch = tcHtml.match(/id\s*=\s*["'](hmma\d+Form)["']/i);
    var tcFormName = tcFormMatch ? tcFormMatch[1] : 'hmma00002Form';
    var tcFields = extractAllFormFields_(tcHtml, tcFormName);

    var targetTenpoValue = null;
    var selectRegex = /<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
    var sMatch;
    while ((sMatch = selectRegex.exec(tcHtml)) !== null) {
      var selectName = sMatch[1];
      var optionsHtml = sMatch[2];

      if (selectName.match(/Tenpo/i) || selectName.match(/Store/i) || selectName.match(/Group/i)) {
        var optionRegex = /<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
        var optMatch;
        while ((optMatch = optionRegex.exec(optionsHtml)) !== null) {
          var optVal = optMatch[1];
          var optText = optMatch[2].replace(/<[^>]+>/g, '').trim();
          if (optText.indexOf(storeNameTarget) !== -1 && optVal) {
            targetTenpoValue = optVal;
            Logger.log('店舗切替用セレクトボックスで一致店舗を発見: ' + selectName + ' = ' + optVal + ' (' + optText + ')');
            tcFields[selectName] = optVal;
          }
        }
      }
    }

    if (!targetTenpoValue) {
      Logger.log('店舗切替画面に「' + storeNameTarget + '」に一致する店舗が見つかりませんでした。切り替えを行わずに現在のクッキーを返します。');
      return cookies;
    }

    var buttons = Object.keys(tcFields).filter(function(k) { return k.match(/:do[A-Z]/); });
    var decisionBtn = null;
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].match(/Decision/i) || buttons[i].match(/Select/i) || buttons[i].match(/Exec/i) || buttons[i].match(/Change/i)) {
        decisionBtn = buttons[i];
      }
    }
    if (!decisionBtn) {
      decisionBtn = 'includeChildBody:' + tcFormName + ':doDecision';
    }

    var postPayload = JSON.parse(JSON.stringify(tcFields));
    postPayload[decisionBtn] = '決定';
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i] !== decisionBtn) delete postPayload[buttons[i]];
    }

    var tcFormAction = extractFormAction_(tcHtml, tcFormName);
    var postUrl = tcFormAction ? resolveUrl_(baseUrl, tcFormAction) : tcUrl;

    Logger.log('店舗切替の決定をPOST送信します。');
    var postResp = fetchWithCookies_(postUrl, 'post', postPayload, tcCookies);
    var finalCookies = mergeCookies_(tcCookies, postResp);

    Logger.log('【店舗切替】セッション店舗の切り替え完了。店舗名: ' + storeNameTarget + ', Status=' + postResp.getResponseCode());
    return finalCookies;

  } catch (err) {
    Logger.log('【店舗切替エラー】処理中に予期しないエラーが発生しました。');
    return cookies;
  }
}


// ===================================================================
// 【共通】画面のHTMLからセレクトボックスを読み、対象店舗のコードを安全に適用
// ===================================================================
function applyTenpoParamsGlobal_(targetPayload, htmlText, formName, storeNameTarget) {
  var selectRegex = /<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  var sMatch;
  while ((sMatch = selectRegex.exec(htmlText)) !== null) {
    var selectName = sMatch[1];
    var optionsHtml = sMatch[2];
    if (selectName.match(/Tenpo/i) || selectName.match(/Store/i) || selectName.match(/Group/i) || selectName.match(/shop/i)) {
      var optionRegex = /<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
      var optMatch;
      while ((optMatch = optionRegex.exec(optionsHtml)) !== null) {
        var optVal = optMatch[1];
        var optText = optMatch[2].replace(/<[^>]+>/g, '').trim();
        if (optText.indexOf(storeNameTarget) !== -1 && optVal) {
          if (targetPayload[selectName] !== undefined || selectName.indexOf(formName) !== -1) {
            targetPayload[selectName] = optVal;
            Logger.log('安全・正規店パラメータ設定 (' + formName + '): ' + selectName + ' = ' + optVal + ' (' + optText + ')');
          }
        }
      }
    }
  }
}


// ===================================================================
// テスト: JS構造を直接返却する
// ===================================================================





function testGetTenpoDialogJS() {
  var posConfig = getPOSConfig_();
  var loginUrl = posConfig.baseUrl + '/';
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
    method: 'post', payload: loginPayload,
    headers: { 'Cookie': cookies }, followRedirects: false, muteHttpExceptions: true,
  });
  cookies = mergeCookies_(cookies, loginResponse);

  // ダッシュボード等、ログイン直後の画面を取得 (おそらく hmma00001.html)
  var dashUrl = resolveUrl_(posConfig.baseUrl, '/hm-hmma/view/hmma/hmma000/hmma00001.html');
  var dashRes = fetchWithCookies_(dashUrl, 'get', null, cookies);
  var dashHtml = dashRes.getContentText();

  // ダッシュボード内のフォームを抽出
  var formRegex = /<form[\s\S]*?<\/form>/gi;
  var forms = dashHtml.match(formRegex) || [];

  var result = "=== ダッシュボード フォーム解析 ===\n";
  result += "フォーム数: " + forms.length + "\n\n";

  for(var i=0; i<forms.length; i++) {
    var f = forms[i];
    var idMatch = f.match(/id=["']([^"']+)["']/);
    var actionMatch = f.match(/action=["']([^"']+)["']/);
    result += "【Form " + i + "】 ID=" + (idMatch?idMatch[1]:"") + ", Action=" + (actionMatch?actionMatch[1]:"") + "\n";

    // input hidden を抽出
    var inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
    var inputs = f.match(inputRegex) || [];
    for(var j=0; j<inputs.length; j++) {
      var nameMatch = inputs[j].match(/name=["']([^"']+)["']/);
      var valueMatch = inputs[j].match(/value=["']([^"']+)["']/);
      result += "  - hidden: " + (nameMatch?nameMatch[1]:"") + " = " + (valueMatch?valueMatch[1]:"") + "\n";
    }

    // aタグのonclickも抽出（店舗切替関連）
    var aRegex = /<a[^>]+onclick=["']([^"']+)["'][^>]*>/gi;
    var as = f.match(aRegex) || [];
    for(var j=0; j<as.length; j++) {
      if(as[j].indexOf('enpo') !== -1) {
        result += "  - a onclick: " + as[j] + "\n";
      }
    }
  }

  return ContentService.createTextOutput(result);
}

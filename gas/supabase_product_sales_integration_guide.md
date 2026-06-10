# 商品別売上データの自動ダウンロード ＆ Supabase連携ガイド（分離版）

「部門別月計データ」の取得処理とは別に、**「商品別売上（hmma02115）」**を単独で取得してSupabaseへ送信する機能を作成します。
処理が重くなるのを防ぐため、スプレッドシートのメニューに専用のボタンを追加し、好きなタイミング（月に1回など）で実行できるように設定します。

以下の手順に沿って、GAS（Google Apps Script）のエディタへ追記してください。

---

## 1. `autoDownload.gs` への追加

### 1-1. 専用の実行メニューを追加

`autoDownload.gs` の下の方などの空いている場所に、以下のコードを丸ごとコピペしてください。
これがスプレッドシートのメニューからポチッと押すための「窓口機能」になります。

```javascript
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
```

### 1-2. メニューにボタンを追加

`importCSV.gs` の `onOpen()` 関数（110行目付近）を探し、既存のメニュー（`.addItem(...)`）の下に専用の項目を追加します。

```javascript
  // これを追加することでメニューにボタンが表示されます
  ui.createMenu('📊 売上CSV取込')
    .addItem('🤖 POSから自動取得＆月計シート転記', 'autoDownloadAndImport')
    .addItem('📦 商品別売上のみ独自取得（Supabase送信）', 'downloadProductSalesMenu') // ★この行を追加！
    // ...以降はそのまま
```

### 1-3. ダウンロード用関数の追加

さらに、`autoDownload.gs` の一番下に、商品を処理する以下のコードを追加してください。

```javascript
// ===================================================================
// 【新規追加】POSから商品別売上(hmma02115)をダウンロード
// ===================================================================
function downloadProductSalesFromPOS_(posConfig, year, month) {
  Logger.log('商品別売上のダウンロードを開始します...');
  
  // 指定された年月の1日を基準日として設定（POSのカレンダー切替に必要）
  var kijyunDate = year + '/' + (month < 10 ? '0' : '') + month + '/01';

  // STEP 1: ログイン（autoDownload.gs 既存のログイン処理と同様）
  var loginUrl = posConfig.baseUrl + POS_PATHS.LOGIN;
  var getLoginResponse = UrlFetchApp.fetch(loginUrl, { method: 'get', followRedirects: true, muteHttpExceptions: true });
  var cookies = extractCookies_(getLoginResponse) || '';
  var loginPayload = extractAllFormFields_(getLoginResponse.getContentText(), 'hmma00000Form');
  loginPayload['hmma00000Form:loginId'] = posConfig.loginId;
  loginPayload['hmma00000Form:password'] = posConfig.password;
  loginPayload['hmma00000Form:saveLoginStatFlg'] = 'true';
  loginPayload['hmma00000Form:doLogin'] = '送信';
  loginPayload['hmma00000Form:companyCd'] = posConfig.companyCd;
  loginPayload['hmma00000Form:companyKey'] = posConfig.companyKey;
  
  var loginResponse = fetchWithCookies_(loginUrl, 'post', loginPayload, cookies);
  cookies = mergeCookies_(cookies, loginResponse);

  // STEP 2: 商品別売上ページ(hmma02115)にアクセス
  var exportPageUrl = posConfig.baseUrl + '/hm-hmma/view/hmma/hmma021/hmma02115.html';
  var exportResponse = fetchWithCookies_(exportPageUrl, 'get', null, cookies);
  cookies = mergeCookies_(cookies, exportResponse);
  
  // STEP 3: 対象月の指定 (POST)
  var monthPayload = extractAllFormFields_(exportResponse.getContentText(), 'hmma02115Form');
  var prefix = 'includeChildBody:hmma02115Form:';
  
  // 余計なdo**ボタンを削除し、指定月のパラメータをセット
  for (var key in monthPayload) {
    if (key.match(/:do[A-Z]/)) delete monthPayload[key];
  }
  
  monthPayload[prefix + 'year'] = String(year);
  monthPayload[prefix + 'month'] = String(month);
  monthPayload[prefix + 'kijyunDate'] = kijyunDate;
  monthPayload[prefix + 'schTenpoGroup'] = posConfig.tenpoGroupId;
  monthPayload[prefix + 'selectTenpoGroupName'] = posConfig.tenpoGroupName;
  monthPayload[prefix + 'monthlySelected'] = 'false';
  monthPayload[prefix + 'listSelected'] = 'false';
  
  var monthResponse = fetchWithCookies_(exportPageUrl, 'post', monthPayload, cookies);
  cookies = mergeCookies_(cookies, monthResponse);

  // STEP 4: エクスポート (doExport)
  var exportPayload = extractAllFormFields_(monthResponse.getContentText(), 'hmma02115Form');
  for (var k in exportPayload) {
    if (k.match(/:do[A-Z]/) && k.indexOf('doExport') === -1) delete exportPayload[k];
  }
  exportPayload[prefix + 'doExport'] = '送信';

  var csvResponse = fetchWithCookies_(exportPageUrl, 'post', exportPayload, cookies);
  if (csvResponse.getResponseCode() !== 200 || !csvResponse.getBlob()) {
    return { success: false, message: 'CSVが正しく取得できませんでした。' };
  }
  
  var storePrefix = (posConfig.tenpoGroupName && posConfig.tenpoGroupName.indexOf('わんわん') !== -1) ? 'わんわん' : '本店';
  
  // ① GoogleドライブにCSVとして保存（証跡用）
  var fileName = storePrefix + '_商品別売上_' + year + '_' + (month < 10 ? '0' : '') + month + '.csv';
  var folder = DriveApp.getFolderById(CONFIG.CSV_FOLDER_ID);
  var existingFiles = folder.getFilesByName(fileName);
  while (existingFiles.hasNext()) existingFiles.next().setTrashed(true);
  folder.createFile(csvResponse.getBlob().setName(fileName));

  // ② Supabaseへのパース＆送信処理（importCSV.gsの関数を呼び出す）
  try {
    var result = processProductSalesCSV_(csvResponse.getBlob(), storePrefix);
    return { success: true, message: 'Supabase送信成功: ' + result.count + '件のレコード\n保存ファイル名: ' + fileName };
  } catch(e) {
    Logger.log('商品別送信エラー: ' + e.message);
    return { success: false, message: 'Supabase送信中にエラー: ' + e.message };
  }
}
```

---

## 2. `importCSV.gs` への追加

取得したCSVの「横持ちデータ」をパースしてSupabaseへ送信する機能を `importCSV.gs` の一番下に追記します。

```javascript
// ===================================================================
// 【新規追加】商品別の横持ちCSVを縦持ちにパースしてSupabaseへ送信
// ===================================================================
function processProductSalesCSV_(csvBlob, storeName) {
  var csvContent = csvBlob.getDataAsString(CONFIG.CSV_ENCODING);
  var rows = parseCSV_(csvContent);
  
  if (rows.length < 3) return { success: false, count: 0 };
  
  var headers = rows[1]; // インデックス1（2行目）がヘッダー行
  var dateMap = [];
  
  // ① ヘッダーから「日付」と「販売数・売上高の列番号」をマッピング
  for (var i = 0; i < headers.length; i++) {
    var headerStr = headers[i] || '';
    if (headerStr.indexOf('販売数（') === 0) {
      // "販売数（2026/03/01）" -> "2026-03-01" に変換
      var dateStr = headerStr.replace('販売数（', '').replace('）', '').replace(/\//g, '-');
      dateMap.push({
        date: dateStr,
        qtyIdx: i,          // 販売数の列番号
        amtIdx: i + 1       // 次の列が必ず売上高
      });
    }
  }

  // ② データ行（インデックス2以降）の処理
  var supabaseRecords = [];
  
  for (var r = 2; r < rows.length; r++) {
    var row = rows[r];
    var productName = row[0] ? row[0].trim() : '';
    
    // 不正な行（空や説明行）を完全にスキップ
    if (!productName || productName === '商品名' || productName === '日計・累計' || productName === '日計' || productName === '累計' || productName.indexOf('（') === 0 || productName.indexOf('【') === 0) {
      continue;
    }
    
    // 各日付ごとの縦持ちレコードを作成
    for (var d = 0; d < dateMap.length; d++) {
      var map = dateMap[d];
      var qtyStr = row[map.qtyIdx] ? String(row[map.qtyIdx]).replace(/,/g, '') : '0';
      var amtStr = row[map.amtIdx] ? String(row[map.amtIdx]).replace(/,/g, '') : '0';
      
      var qty = parseInt(qtyStr, 10);
      var amt = parseInt(amtStr, 10);
      
      // データ圧縮の観点から「売上も数も0」の場合は絶対に追加しない（これで数万件→数千件に激減する）
      if (isNaN(qty) || isNaN(amt) || (qty === 0 && amt === 0)) {
        continue;
      }
      
      supabaseRecords.push({
        transaction_date: map.date,
        store_name: storeName,
        product_name: productName,
        quantity: qty,
        total_amount: amt
      });
    }
  }
  
  if (supabaseRecords.length === 0) {
     return { success: true, count: 0, message: '送信対象のデータ（売上が1以上のレコード）がありませんでした。' };
  }
  
  Logger.log('パース完了: 全 ' + supabaseRecords.length + ' 件の有効データが見つかりました');

  // ③ 100件ずつSupabaseに送信（GASのタイムアウト対策でチャンクを小さくする）
  var chunkSize = 100;
  for (var i = 0; i < supabaseRecords.length; i += chunkSize) {
    var chunk = supabaseRecords.slice(i, i + chunkSize);
    sendProductSalesDataToSupabase_(chunk); // アンダーバー付きに変更
    
    // サーバー負荷軽減のため少しだけ待機
    if (i + chunkSize < supabaseRecords.length) {
      Utilities.sleep(100); 
    }
  }
  
  return { success: true, count: supabaseRecords.length };
}


// ===================================================================
// 【新規追加】Supabaseの product_sales_data テーブルへ送信
// ===================================================================
function sendProductSalesDataToSupabase_(payload) {
  // SUPABASE_URL と SUPABASE_KEY が定義されている前提
  if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL) return;

  var url = SUPABASE_URL + '/rest/v1/product_sales_data?on_conflict=transaction_date,store_name,product_name';
  
  var options = {
    method: 'post',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      // 重複時（同一日付・店舗・商品名）は上書きする指定
      'Prefer': 'resolution=merge-duplicates'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // エラー時も例外で止めずにステータスコードを取る
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();
    if (statusCode === 200 || statusCode === 201) {
      Logger.log('Supabase連携成功 (商品別 Chunk): ' + payload.length + '件');
    } else {
      Logger.log('Supabase連携失敗: Status: ' + statusCode + ', Response: ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('Supabase連携例外エラー (商品別): ' + e.message);
  }
}
```

---

これですべての準備が整いました！
スプレッドシートをリロードすると、メニューの「売上CSV取込」の中に**「📦 商品別売上のみ独自取得」**というボタンが新しく出現します。
商品名の取得（件数が多く処理が重いもの）だけを、分離して好きなタイミングで実行できるようになります！

---

## 3. 毎月1日の「完全自動実行（定期トリガー）」の設定

「毎月ボタンを押すのも面倒なので、月初に勝手に先月分を取得してほしい」という場合は、Google Apps Scriptの**「時間主導型トリガー」**を使うことで可能です。

### 3-1. 自動実行用の関数を追加

ポップアップなどの画面表示に依存しない「裏側でこっそり動く専用の関数」を `autoDownload.gs` の一番下に追加します。

```javascript
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
```

### 3-2. トリガーの設定を行う

関数を保存したら、GASエディタの左側メニューにある**「⏰ タイマーのアイコン（トリガー）」**をクリックし、右下の**「トリガーを追加」**ボタンを押します。

以下のように設定して保存してください。

* 実行する関数を選択: **`autoRunProductSalesMonthly`**
* 実行するデプロイを選択: `Head`
* イベントのソースを選択: **`時間主導型`**
* 時間ベースのトリガーのタイプを選択: **`月ベースのタイマー`**
* 日を選択: **`1日`** （毎月1日に実行）
* 時刻を選択: **`午前1時〜午前2時`** など（POSが落ちていなさそうな、人が使わない夜間の時間帯）

これで、**「毎月1日の深夜に、前の月（1日〜末日分）の商品別売上が自動でPOSからダウンロードされ、Supabaseに送信される」**という完全自動化が完了します！

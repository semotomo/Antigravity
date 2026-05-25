# スプレッドシート（GAS）からSupabaseへの売上データ自動連携手順（更新版）

前回作成した「※POS自動ダウンロードスクリプト（`importCSV.gs` / `autoDownload.gs`）」は、**「商品ごとのデータ」ではなく、「日別・部門別の月計データ（ジャンルごとの合算）」を取得**する仕様となっていました。
そのため、今回の設定では**「部門（カテゴリ）別の売上データ」としてSupabaseに保存**するようにスクリプトを最適化しています。

> **※注意（重要）**
> このデータには「商品名個別の売上」が含まれないため、「どの商品が一番売れたか（売れ筋商品ランキング）」はダッシュボードで分かりません。その代わり、**「部門別（犬・猫・ホテルなどのジャンル）の売上円グラフや日別推移など」は完璧に出力可能**です。
> （もし商品別の分析もやりたい場合は、POSから「レシート・商品ごとの詳細データ」を別途自動ダウンロードする仕組みを作る必要があります）

以下の手順に沿って設定を行ってください。

## 1. Supabaseでテーブルを作成する
Supabaseの「SQL Editor（`>_` のマーク）」に移動して、以下のコードを実行してください。
※「Coming up...」が緑の「Active/Online」に変わってから実行してください。
- 実行するファイル: `inventory/supabase_schema_sales.sql`

## 2. GASスクリプト（importCSV.gs）の修正

### ① 設定値の準備
`importCSV.gs` の上部（`CONFIG`の定義の下あたりなど）に以下のコードを追加してください。

```javascript
// ▼▼▼ 追加: Supabase 接続情報 ▼▼▼
// ※[あなたのプロジェクトID] と [あなたのAnon_Key] を実際のものに書き換えて、行頭の // を削除してください
// const SUPABASE_URL = 'https://[あなたのプロジェクトID].supabase.co';
// const SUPABASE_KEY = 'eyJhbG...[あなたのAnon_Key]...';
```

### ② データ送信関数の追加
`importCSV.gs` の一番下（ファイルの末尾）などに、以下の関数を追加します。

```javascript
// ===================================================================
// ▼▼▼ 追加: Supabaseへの送信処理 ▼▼▼
// ===================================================================
function sendSalesDataToSupabase(salesRecords) {
  // SUPABASEの情報が設定されていない場合はスキップ
  if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.indexOf('[あなたのプロジェクトID]') !== -1) {
    Logger.log('Supabase設定がないため送信をスキップ');
    return;
  }
  
  const url = `${SUPABASE_URL}/rest/v1/sales_data`;
  const options = {
    method: 'post',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      // 'Prefer': 'resolution=ignore-duplicates' // 重複を無視する場合は有効化
    },
    payload: JSON.stringify(salesRecords),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Supabaseへのデータ送信成功: ' + salesRecords.length + '件');
    } else {
      Logger.log('Supabaseへのデータ送信エラー: ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('送信時の例外エラー: ' + e.message);
  }
}
```

### ③ メイン処理（writeMonthlyData_）の修正
`importCSV.gs` の中にある `writeMonthlyData_` という関数（560行目付近）を探し、以下のように**「▼▼▼ 追加 ▼▼▼」**の部分を追記してください。

```javascript
  // === 3行目〜: 日別データ ===
  var numDays = filteredRows.length;
  var outputData = [];
  var colTotals = new Array(departmentsConfig.length).fill(0); // 部門別合計

  // ▼▼▼ 追加1: Supabase用データ配列の準備 ▼▼▼
  var supabaseRecords = [];

  for (var i = 0; i < numDays; i++) {
    var dayNumber = filteredRows[i].day; // CSVの実際の日付を使用
    var csvRow = filteredRows[i].csvRow;

    // ▼▼▼ 追加2: 日付文字列の作成 (YYYY-MM-DD) ▼▼▼
    var dateString = monthInfo.year + '-' +
                     (monthInfo.month < 10 ? '0' : '') + monthInfo.month + '-' +
                     (dayNumber < 10 ? '0' : '') + dayNumber;

    // 各部門の税抜き値を取得
    var deptValues = extractDepartmentValues_(csvRow, departmentsConfig);

    // 横合計を計算
    var rowTotal = 0;
    for (var j = 0; j < deptValues.length; j++) {
      rowTotal += deptValues[j];
      colTotals[j] += deptValues[j]; // 縦合計にも加算
      
      // ▼▼▼ 追加3: Supabase用レコード作成 (売上が0円のものは省く) ▼▼▼
      if (deptValues[j] !== 0) {
        supabaseRecords.push({
          transaction_date: dateString,
          store_name: storeName,
          product_name: '部門別合算',          // 商品名不明のため固定
          category: departmentsConfig[j].name, // 部門名（犬、猫フードなど）
          quantity: 1,                         // 個数不明のため1で固定
          unit_price: deptValues[j],           // 税抜売上額
          total_amount: deptValues[j]          // 税抜売上額
        });
      }
    }

    // 出力行を構成: [日付, 部門1, 部門2, ..., 合計]
    var row = [dayNumber].concat(deptValues).concat([rowTotal]);
    outputData.push(row);
  }

  // データを一括書き込み（3行目から）
  if (outputData.length > 0) {
    sheet.getRange(3, 1, outputData.length, numCols).setValues(outputData);
  }

  // ▼▼▼ 追加4: Supabaseへ送信処理 を実行 ▼▼▼
  // ※一度に送れるデータ量に制限があるため1000件ずつ分割して送信
  if (supabaseRecords.length > 0) {
    var chunkSize = 1000;
    for (var i = 0; i < supabaseRecords.length; i += chunkSize) {
      var chunk = supabaseRecords.slice(i, i + chunkSize);
      sendSalesDataToSupabase(chunk);
    }
  }

  // === 合計行 ===
  // ... (以降の処理はそのまま) ...
```

以上の修正で、前回の「月計シート（ジャンル別）」のデータがそのままSupabaseに保存されるようになり、ダッシュボードでのグラフ化（部門別の売り上げ比率や日別推移）が可能になります！

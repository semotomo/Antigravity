/**
 * =============================================================
 * 【売上CSV自動転記スクリプト】
 * 
 * POSレジからダウンロードしたCSVファイル（Googleドライブ内）を
 * 月を自動判定し、税抜き計算済みの値を月計シートに直接転記する
 * 
 * 使い方:
 *   1. スプレッドシートの「拡張機能 > Apps Script」を開く
 *   2. このコードを貼り付けて保存
 *   3. CONFIG の CSV_FOLDER_ID を実際のフォルダIDに変更
 *   4. スプレッドシートを再読み込みすると
 *      メニューバーに「📊 売上CSV取込」が追加される
 *   5. メニューから「月計シートに取り込む」を選択して実行
 * =============================================================
 */

// ===================================================================
// 設定（★ 必ず自分の環境に合わせて変更してください）
// ===================================================================
const CONFIG = {
  // CSVファイルが保存されるGoogleドライブのフォルダID
  // 「⚙️ POS接続設定」メニューから設定されたものが自動で読み込まれます
  CSV_FOLDER_ID: PropertiesService.getScriptProperties().getProperty('CSV_FOLDER_ID') || '',

  // CSVファイル名の検索パターン（部分一致）
  CSV_FILE_PATTERN: '月計用',

  // 「貼り付け用」シート名（CSVの生データ保存先）
  RAW_SHEET_NAME: '貼り付け用',

  // CSVの文字エンコーディング
  // POSシステムの出力に合わせて変更
  // 'UTF-8' または 'Shift_JIS'
  CSV_ENCODING: 'Shift_JIS',

  // 店舗名（月計表のタイトルに使用）
  STORE_NAME: '本店月計',
};


// ===================================================================
// 部門（カラム）マッピング定義の取得
// 店舗名に応じて、CSVのどの列をシートのどの列に書き込むかを切り替える
// ===================================================================
function getDepartmentsConfig_(storeName) {
  // わんわんペットセンター用のマッピング定義（実CSVデータに基づく）
  // CSV列: 0:日, 23:シャンプー, 25:カット, 27:オプション, 29:ホテル, 31:ホテル土日祝,
  //        33:その他, 35:小動物用品, 37:犬猫用品, 39:犬フード, 41:犬おやつ,
  //        43:猫フード, 45:猫おやつ, 47:魚用品, 49:小動物, 51:犬, 53:猫,
  //        55:ワクチン, 57:パック
  if (storeName && storeName.indexOf('わんわん') !== -1) {
    return [
      { name: '犬',         csvIndices: [51], sheetCol: 2 },   // B列: 犬（w）
      { name: '猫',         csvIndices: [53], sheetCol: 3 },   // C列: 猫（w）
      { name: 'ワクチン',    csvIndices: [55], sheetCol: 4 },   // D列: ワクチン（w）
      { name: 'パック',      csvIndices: [57], sheetCol: 5 },   // E列: パック（w）
      { name: '犬フード',    csvIndices: [39], sheetCol: 6 },   // F列: 犬フード（w）
      { name: '猫フード',    csvIndices: [43], sheetCol: 7 },   // G列: 猫フード（w）
      // 犬猫おやつ = 犬おやつ(41) + 猫おやつ(45) の合算
      { name: '犬猫おやつ',  csvIndices: [41, 45], sheetCol: 8 }, // H列
      { name: '犬猫用品',    csvIndices: [37], sheetCol: 9 },   // I列: 犬猫用品（w）
      // 美容 = シャンプー(23) + カット(25) + オプション(27) の合算
      { name: '美容',       csvIndices: [23, 25, 27], sheetCol: 10 }, // J列
      // ホテル = ホテル(29) + ホテル土日祝(31) の合算
      { name: 'ホテル',     csvIndices: [29, 31], sheetCol: 11 }, // K列
      { name: '小動物',     csvIndices: [49], sheetCol: 12 },   // L列: 小動物（w）
      { name: '小動物用品',  csvIndices: [35], sheetCol: 13 },   // M列: 小動物用品（w）
      { name: '魚用品',     csvIndices: [47], sheetCol: 14 },   // N列: 魚用品（w）
      { name: 'その他',     csvIndices: [33], sheetCol: 15 },   // O列: その他（w）
    ];
  }

  // デフォルト（唐津ケンネル本店）のマッピング定義（実CSVデータに基づく）
  // CSV列: 23:シャンプー, 25:カット, 27:オプション, 29:ホテル, 31:ホテル土日祝,
  //        33:犬フード, 35:犬具, 37:犬おやつ, 39:猫フード, 41:猫おやつ,
  //        43:犬猫用品, 45:その他, 47:生体, 49:魚・小動物用品
  return [
    { name: '生体',       csvIndices: [47], sheetCol: 2 },  // B列: 生体(からつケンネル本店)
    { name: '犬フード',   csvIndices: [33], sheetCol: 3 },  // C列: 犬フード(からつケンネル本店)
    { name: '猫フード',   csvIndices: [39], sheetCol: 4 },  // D列: 猫フード(からつケンネル本店)
    { name: '犬おやつ',   csvIndices: [37], sheetCol: 5 },  // E列: 犬おやつ(からつケンネル本店)
    { name: '猫おやつ',   csvIndices: [41], sheetCol: 6 },  // F列: 猫おやつ(からつケンネル本店)
    { name: '犬猫用品',   csvIndices: [43], sheetCol: 7 },  // G列: 犬猫用品(からつケンネル本店)
    { name: '犬具',       csvIndices: [35], sheetCol: 8 },  // H列: 犬具(からつケンネル本店)
    // 美容 = シャンプー(23) + カット(25) + オプション(27) の合算
    { name: '美容',       csvIndices: [23, 25, 27], sheetCol: 9 },  // I列
    // ホテル = ホテル(29) + ホテル土日祝(31) の合算
    { name: 'ホテル',     csvIndices: [29, 31], sheetCol: 10 }, // J列
    { name: 'その他',     csvIndices: [45], sheetCol: 11 }, // K列: その他(からつケンネル本店)
    { name: '小動物用品', csvIndices: [49], sheetCol: 12 }, // L列: 魚・小動物用品(からつケンネル本店)
  ];
}

// 月計表のヘッダー（2行目）
const MONTHLY_HEADERS = ['日付', '生体', '犬フード', '猫フード', '犬おやつ',
  '猫おやつ', '犬猫用品', '犬具', '美容', 'ホテル', 'その他', '小動物用品', '合計'];

// 合計列の位置（M列 = 13）
const TOTAL_COL = 13;


// ===================================================================
// メニュー追加（スプレッドシートを開いた時に自動実行）
// ===================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 売上CSV取込')
    .addItem('🤖 POSから自動取得＆月計シート転記', 'autoDownloadAndImport')
    .addItem('📦 商品別売上のみ独自取得', 'downloadProductSalesMenu')
    .addItem('🏷️ 商品マスタ同期（POS→Supabase）', 'downloadAndSyncProductMasterMenu')
    .addSeparator()
    .addItem('📅 最新CSVを月計シートに取り込む', 'importToMonthlySheet')
    .addItem('📅 全CSVを一括取込（フォルダ内全件）', 'importAllCSVs')
    .addItem('📅 月を指定して取り込む', 'importByMonth')
    .addSeparator()
    .addItem('📋 貼り付け用シートに取り込む（生データ）', 'importCSVFromDrive')
    .addItem('📁 フォルダ内のCSV一覧を表示', 'listCSVFiles')
    .addSeparator()
    .addItem('⚙️ POS接続設定', 'setupPOSConnection')
    .addItem('🔌 POS接続テスト', 'testPOSConnection')
    .addItem('⚙️ CSV設定を確認', 'showCurrentConfig')
    .addToUi();
}


// ===================================================================
// 【メイン1】最新CSVを月計シートに取り込む（月自動判定＋税抜き計算）
// ===================================================================
function importToMonthlySheet() {
  const ui = SpreadsheetApp.getUi();

  // --- CSVファイルの取得 ---
  var csvFile;
  try {
    csvFile = findLatestCSV_();
  } catch (e) {
    ui.alert('❌ エラー',
      'CSVファイルの検索中にエラーが発生しました。\n\n' +
      '原因: ' + e.message + '\n\nフォルダIDが正しいか確認してください。',
      ui.ButtonSet.OK);
    return;
  }

  if (!csvFile) {
    ui.alert('❌ CSVが見つかりません',
      'フォルダ内に「' + CONFIG.CSV_FILE_PATTERN + '」を含むCSVファイルが見つかりませんでした。',
      ui.ButtonSet.OK);
    return;
  }

  // 確認ダイアログ
  var fileName = csvFile.getName();
  var response = ui.alert('📅 月計シート取込確認',
    '最新のCSVファイルを月計シートに取り込みます。\n\n' +
    'ファイル: ' + fileName + '\n' +
    '処理内容: 月自動判定 → 税抜き変換 → 月計シートに出力\n\n' +
    'よろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) {
    ui.alert('取込をキャンセルしました。');
    return;
  }

  // 共通処理を呼び出し（確認ダイアログあり）
  var result = processCSVFile_(csvFile, true);
  if (result.success) {
    ui.alert('✅ 取込完了',
      '月計シートへの転記が完了しました！\n\n' + result.message,
      ui.ButtonSet.OK);
  } else if (result.skipped) {
    ui.alert('⏭️ スキップ', result.message, ui.ButtonSet.OK);
  } else {
    ui.alert('❌ エラー', result.message, ui.ButtonSet.OK);
  }
}


// ===================================================================
// 【メイン2】フォルダ内の全CSVを一括取込
// ===================================================================
function importAllCSVs() {
  const ui = SpreadsheetApp.getUi();

  // --- 全CSVファイルを取得 ---
  var csvFiles;
  try {
    csvFiles = findAllCSVs_();
  } catch (e) {
    ui.alert('❌ エラー',
      'CSVファイルの検索中にエラーが発生しました。\n\n原因: ' + e.message,
      ui.ButtonSet.OK);
    return;
  }

  if (csvFiles.length === 0) {
    ui.alert('❌ CSVが見つかりません',
      'フォルダ内に「' + CONFIG.CSV_FILE_PATTERN + '」を含むCSVファイルが見つかりませんでした。',
      ui.ButtonSet.OK);
    return;
  }

  // 確認ダイアログ
  var fileNames = csvFiles.map(function(f) { return '  ・' + f.getName(); }).join('\n');
  var response = ui.alert('📅 全CSV一括取込',
    csvFiles.length + '件のCSVファイルを一括で取り込みます。\n\n' +
    fileNames + '\n\n' +
    '※ 既存のシートはスキップされます（上書きしません）\n\n' +
    'よろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) {
    ui.alert('取込をキャンセルしました。');
    return;
  }

  // 各CSVを処理
  var results = { success: 0, skipped: 0, error: 0, details: [] };

  for (var i = 0; i < csvFiles.length; i++) {
    var result = processCSVFile_(csvFiles[i], false); // 確認なしで処理
    if (result.success) {
      results.success++;
      results.details.push('✅ ' + result.sheetName + ' ← ' + csvFiles[i].getName());
    } else if (result.skipped) {
      results.skipped++;
      results.details.push('⏭️ ' + result.sheetName + '（既存のためスキップ）');
    } else {
      results.error++;
      results.details.push('❌ ' + csvFiles[i].getName() + ': ' + result.message);
    }
  }

  // 結果レポート
  ui.alert('📊 一括取込結果',
    '処理完了！\n\n' +
    '✅ 取込成功: ' + results.success + '件\n' +
    '⏭️ スキップ: ' + results.skipped + '件\n' +
    '❌ エラー: ' + results.error + '件\n\n' +
    '--- 詳細 ---\n' +
    results.details.join('\n'),
    ui.ButtonSet.OK);
}


// ===================================================================
// 【メイン3】月を指定して取り込む
// ===================================================================
function importByMonth() {
  const ui = SpreadsheetApp.getUi();

  // 月を入力させる
  var promptResult = ui.prompt('📅 月を指定して取り込む',
    '取り込みたい月を数字で入力してください（1〜12）。\n\n' +
    '例: 1月なら「1」、12月なら「12」',
    ui.ButtonSet.OK_CANCEL);

  if (promptResult.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  var targetMonth = parseInt(promptResult.getResponseText().trim(), 10);
  if (isNaN(targetMonth) || targetMonth < 1 || targetMonth > 12) {
    ui.alert('❌ エラー', '1〜12の数字を入力してください。', ui.ButtonSet.OK);
    return;
  }

  // 全CSVから該当月のデータを持つCSVを探す
  var csvFiles;
  try {
    csvFiles = findAllCSVs_();
  } catch (e) {
    ui.alert('❌ エラー', 'CSVファイルの検索に失敗しました。\n\n原因: ' + e.message, ui.ButtonSet.OK);
    return;
  }

  // 各CSVの月を判定して、指定月と一致するものを探す
  var matchedFile = null;
  for (var i = 0; i < csvFiles.length; i++) {
    try {
      var content = csvFiles[i].getBlob().getDataAsString(CONFIG.CSV_ENCODING);
      var rows = parseCSV_(content);
      var monthInfo = detectMonth_(rows);
      if (monthInfo && monthInfo.month === targetMonth) {
        matchedFile = csvFiles[i];
        break;
      }
    } catch (e) {
      // このCSVは読めなかったのでスキップ
      continue;
    }
  }

  if (!matchedFile) {
    ui.alert('❌ 該当なし',
      targetMonth + '月のデータを含むCSVファイルが見つかりませんでした。\n\n' +
      'フォルダ内のCSVファイルを確認してください。',
      ui.ButtonSet.OK);
    return;
  }

  // 確認ダイアログ付きで処理
  var response = ui.alert('📅 取込確認',
    targetMonth + '月のデータを取り込みます。\n\n' +
    'ファイル: ' + matchedFile.getName() + '\n' +
    '転記先: 「' + targetMonth + '月」シート\n\n' +
    'よろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) {
    ui.alert('取込をキャンセルしました。');
    return;
  }

  var result = processCSVFile_(matchedFile, true);
  if (result.success) {
    ui.alert('✅ 取込完了',
      '月計シートへの転記が完了しました！\n\n' + result.message,
      ui.ButtonSet.OK);
  } else if (result.skipped) {
    ui.alert('⏭️ スキップ', result.message, ui.ButtonSet.OK);
  } else {
    ui.alert('❌ エラー', result.message, ui.ButtonSet.OK);
  }
}


// ===================================================================
// 【共通処理】CSVファイル1件を月計シートに転記
// askOverwrite: trueなら上書き確認ダイアログを出す、falseなら既存シートはスキップ
// 戻り値: { success, skipped, message, sheetName }
// ===================================================================
function processCSVFile_(csvFile, askOverwrite) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // CSV読み込み＆パース
  var rows;
  try {
    var csvContent = csvFile.getBlob().getDataAsString(CONFIG.CSV_ENCODING);
    rows = parseCSV_(csvContent);
  } catch (e) {
    return { success: false, skipped: false, message: 'CSV読み込みエラー: ' + e.message, sheetName: '' };
  }

  if (rows.length < 3) {
    return { success: false, skipped: false, message: 'データが不十分です（' + rows.length + '行）', sheetName: '' };
  }

  // 月を自動判定
  var monthInfo = detectMonth_(rows);
  if (!monthInfo) {
    return { success: false, skipped: false, message: '月を判定できませんでした', sheetName: '' };
  }

  var sheetName = monthInfo.month + '月';
  var dataRows = rows.slice(2);

  // シートの取得または作成
  var monthlySheet = ss.getSheetByName(sheetName);

  if (monthlySheet) {
    if (askOverwrite) {
      // 上書き確認ダイアログ
      var overwriteResponse = ui.alert('📋 シートが既に存在します',
        '「' + sheetName + '」シートには既にデータがあります。\n\n' +
        '【はい】→ 上書きして最新データに更新\n' +
        '【いいえ】→ スキップ（何もしない）',
        ui.ButtonSet.YES_NO);
      if (overwriteResponse !== ui.Button.YES) {
        return { success: false, skipped: true, message: '「' + sheetName + '」はスキップされました', sheetName: sheetName };
      }
    } else {
      // 一括処理の場合は既存シートをスキップ
      return { success: false, skipped: true, message: '既存シートのためスキップ', sheetName: sheetName };
    }
  } else {
    try {
      monthlySheet = ss.insertSheet(sheetName);
      Logger.log('新しいシート「' + sheetName + '」を作成しました');
    } catch (err) {
      return { 
        success: false, 
        skipped: false, 
        message: 'シート作成時にエラーが発生しました。\n(エラー内容: ' + err.message + ')\n\n' +
                 '【解決策】スプレッドシート内に「#REF!」エラーや、削除されたシートを参照している名前付き範囲・入力規則が残っているとこのエラーが起きます。それらを修正・削除してから再実行してください。', 
        sheetName: sheetName 
      };
    }
  }

  // CSVのヘッダー行（2行目 = index 1）から店舗を自動判定
  var detectedStoreName = detectStoreFromCSV_(rows);
  Logger.log('CSV内容から店舗を自動判定: ' + detectedStoreName);

  // データを処理して書き込み
  try {
    writeMonthlyData_(monthlySheet, monthInfo, dataRows, detectedStoreName);
  } catch (e) {
    return { success: false, skipped: false, message: '書き込みエラー: ' + e.message, sheetName: sheetName };
  }

  var msg = 'シート: 「' + sheetName + '」\n' +
    '期間: ' + monthInfo.year + '年' + monthInfo.month + '月\n' +
    'ファイル: ' + csvFile.getName();
  Logger.log('月計転記完了: ' + sheetName);

  return { success: true, skipped: false, message: msg, sheetName: sheetName };
}


// ===================================================================
// CSVデータから月を自動判定
// 戻り値: { year: 2026, month: 2, daysInMonth: 28 } または null
// ===================================================================
function detectMonth_(rows) {
  // データ行（3行目 = index 2）の日付列（0列目）から月を取得
  for (var i = 2; i < rows.length; i++) {
    var dateStr = String(rows[i][0]).trim();
    // "2026/02/01" 形式
    var match = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (match) {
      var year = parseInt(match[1], 10);
      var month = parseInt(match[2], 10);

      // その月の日数を計算
      var daysInMonth = new Date(year, month, 0).getDate();

      return {
        year: year,
        month: month,
        daysInMonth: daysInMonth
      };
    }
  }
  return null;
}


// ===================================================================
// CSVのヘッダー行から店舗を自動判定
// わんわんのCSVはヘッダーに「わんわんペットセンター」が含まれる
// 戻り値: 'わんわんペットセンター' または '本店'
// ===================================================================
function detectStoreFromCSV_(rows) {
  // ヘッダー行（2行目 = index 1）をチェック
  if (rows.length >= 2) {
    var headerRow = rows[1].join(',');
    if (headerRow.indexOf('わんわん') !== -1) {
      Logger.log('CSV自動判定: わんわんペットセンターのCSVを検出');
      return 'わんわんペットセンター';
    }
  }
  Logger.log('CSV自動判定: 本店のCSVとして処理');
  return '本店';
}


// ===================================================================
// 税抜き計算（ユーザーの既存数式と完全一致）
// 税抜 = 税込 - ROUNDDOWN(税込 * 10 / 110)
// ===================================================================
function calcTaxExcluded_(taxIncluded) {
  if (typeof taxIncluded !== 'number' || isNaN(taxIncluded)) {
    return 0;
  }
  // ROUNDDOWN = Math.floor（正の数の場合）
  var tax = Math.floor(taxIncluded * 10 / 110);
  return taxIncluded - tax;
}


// ===================================================================
// CSVの1行から部門ごとの税抜き値を抽出
// ===================================================================
function extractDepartmentValues_(csvRow, departmentsConfig) {
  var values = [];

  for (var d = 0; d < departmentsConfig.length; d++) {
    var dept = departmentsConfig[d];
    var taxIncludedTotal = 0;

    // 複数列を合算（美容、ホテルなど）
    for (var c = 0; c < dept.csvIndices.length; c++) {
      var idx = dept.csvIndices[c];
      if (idx < csvRow.length) {
        var val = Number(csvRow[idx]);
        if (!isNaN(val)) {
          taxIncludedTotal += val;
        }
      }
    }

    // 税抜き計算
    values.push(calcTaxExcluded_(taxIncludedTotal));
  }

  return values;
}


// ===================================================================
// 月計シートにデータを書き込み
// ===================================================================
function writeMonthlyData_(sheet, monthInfo, dataRows, detectedStoreName) {
  // 店舗名の決定: CSV内容から自動判定 → POS設定 → CONFIG の優先順位
  var storeName = detectedStoreName || '';
  if (!storeName) {
    var props = PropertiesService.getScriptProperties();
    storeName = props.getProperty('POS_TENPO_GROUP_NAME') || CONFIG.STORE_NAME;
  }
  const departmentsConfig = getDepartmentsConfig_(storeName);

  // シート全体をクリア
  sheet.clear();

  // ヘッダーをdepartmentsConfigから動的に生成（店舗ごとに列数が異なる）
  var headers = ['日付'];
  for (var h = 0; h < departmentsConfig.length; h++) {
    headers.push(departmentsConfig[h].name);
  }
  headers.push('合計');
  var numCols = headers.length;

  // === 1行目: タイトル（A1は空、B1に年月、C1に店舗名）===
  sheet.getRange(1, 2).setValue(monthInfo.year + '年' +
    (monthInfo.month < 10 ? '0' : '') + monthInfo.month + '月');
    
  var titleSuffix = (storeName && storeName.indexOf('わんわん') !== -1) ? 'わんわん月計' : '本店月計';
  sheet.getRange(1, 3).setValue(titleSuffix);

  // === 2行目: ヘッダー ===
  sheet.getRange(2, 1, 1, numCols).setValues([headers]);

  // === データ行のフィルタリングとソート ===
  // CSVの日付列（index 0）から年月日を抽出し、該当月のデータのみ残す
  var filteredRows = [];
  for (var i = 0; i < dataRows.length; i++) {
    var dateStr = String(dataRows[i][0]).trim();
    var dateMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);

    if (dateMatch) {
      var rowYear = parseInt(dateMatch[1], 10);
      var rowMonth = parseInt(dateMatch[2], 10);
      var rowDay = parseInt(dateMatch[3], 10);

      // 該当月のデータのみ（前月末・翌月初のデータを除外）
      if (rowYear === monthInfo.year && rowMonth === monthInfo.month) {
        filteredRows.push({ day: rowDay, csvRow: dataRows[i] });
      }
    }
  }

  // 日付順にソート
  filteredRows.sort(function(a, b) { return a.day - b.day; });

  // === 3行目〜: 日別データ ===
  var numDays = filteredRows.length;
  var outputData = [];
  var colTotals = new Array(departmentsConfig.length).fill(0); // 部門別合計

  for (var i = 0; i < numDays; i++) {
    var dayNumber = filteredRows[i].day; // CSVの実際の日付を使用
    var csvRow = filteredRows[i].csvRow;

    // 各部門の税抜き値を取得
    var deptValues = extractDepartmentValues_(csvRow, departmentsConfig);

    // 横合計を計算
    var rowTotal = 0;
    for (var j = 0; j < deptValues.length; j++) {
      rowTotal += deptValues[j];
      colTotals[j] += deptValues[j]; // 縦合計にも加算
    }

    // 出力行を構成: [日付, 部門1, 部門2, ..., 合計]
    var row = [dayNumber].concat(deptValues).concat([rowTotal]);
    outputData.push(row);
  }

  // データを一括書き込み（3行目から）
  if (outputData.length > 0) {
    sheet.getRange(3, 1, outputData.length, numCols).setValues(outputData);
  }

  // === 合計行 ===
  var totalRowNum = 3 + numDays;
  var totalRow = ['合計'];
  var grandTotal = 0;
  for (var k = 0; k < colTotals.length; k++) {
    totalRow.push(colTotals[k]);
    grandTotal += colTotals[k];
  }
  totalRow.push(grandTotal);
  sheet.getRange(totalRowNum, 1, 1, numCols).setValues([totalRow]);

  // === 注記行 ===
  var noteRowNum = totalRowNum + 1;
  sheet.getRange(noteRowNum, numCols).setValue('※税抜表示');

  // === 書式設定 ===
  applyMonthlyFormatting_(sheet, numDays, numCols, totalRowNum);

  SpreadsheetApp.flush();
}


// ===================================================================
// 月計シートの書式設定
// ===================================================================
function applyMonthlyFormatting_(sheet, numDays, numCols, totalRowNum) {
  // --- ヘッダー行（2行目）の書式 ---
  var headerRange = sheet.getRange(2, 1, 1, numCols);
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setBackground('#4472C4'); // ヘッダー背景色（白文字が見えるように）
  headerRange.setFontSize(12);

  // --- タイトル行（1行目）の書式 ---
  sheet.getRange(1, 2).setFontWeight('bold');
  sheet.getRange(1, 2).setFontSize(12);

  // --- テーブル全体のフォントサイズと行の高さ ---
  // ヘッダー行〜合計行のフォントサイズを12に
  if (numDays > 0) {
    sheet.getRange(3, 1, numDays, numCols).setFontSize(12);
  }
  sheet.getRange(totalRowNum, 1, 1, numCols).setFontSize(12);
  // 行の高さを少し広めに設定（2行目〜合計行）
  for (var r = 2; r <= totalRowNum; r++) {
    sheet.setRowHeight(r, 25);
  }

  // --- 日付列（A列）のセンタリング ---
  if (numDays > 0) {
    sheet.getRange(3, 1, numDays, 1).setHorizontalAlignment('center');
  }

  // --- 金額列に通貨フォーマット ---
  if (numDays > 0) {
    sheet.getRange(3, 2, numDays, numCols - 1).setNumberFormat('¥#,##0');
  }

  // --- 合計行の書式 ---
  var totalRange = sheet.getRange(totalRowNum, 1, 1, numCols);
  totalRange.setFontWeight('bold');
  totalRange.setBackground('#D9E2F3');
  sheet.getRange(totalRowNum, 2, 1, numCols - 1).setNumberFormat('¥#,##0');

  // --- 合計列の書式 ---
  if (numDays > 0) {
    sheet.getRange(3, numCols, numDays, 1).setFontWeight('bold');
  }

  // --- 枠線（罫線）の設定 ---
  var borderStyle = SpreadsheetApp.BorderStyle.THIN;       // 細い罫線
  var borderMedium = SpreadsheetApp.BorderStyle.MEDIUM;    // 中太罫線
  var borderColor = '#000000';  // 黒

  // ヘッダー行〜合計行の全体に外枠と内側の細い罫線を設定
  var tableRange = sheet.getRange(2, 1, totalRowNum - 1, numCols); // 2行目〜合計行
  tableRange.setBorder(true, true, true, true, true, true, borderColor, borderStyle);

  // ヘッダー行の下に中太罫線（ヘッダーとデータの区切り）
  var headerRange2 = sheet.getRange(2, 1, 1, numCols);
  headerRange2.setBorder(true, true, true, true, null, null, borderColor, borderMedium);

  // 合計行の上に中太罫線（データと合計の区切り）
  var totalRange2 = sheet.getRange(totalRowNum, 1, 1, numCols);
  totalRange2.setBorder(true, true, true, true, null, null, borderColor, borderMedium);

  // テーブル全体の外枠を中太罫線に
  tableRange.setBorder(true, true, true, true, null, null, borderColor, borderMedium);

  // --- 列幅を動的に設定（列数に応じて調整）---
  var dateColWidth = 42;
  var totalColWidth = 92;
  // データ列の幅: 列数が多い場合は狭めに、少ない場合は広めに
  var dataColWidth = (numCols <= 13) ? 100 : 82;
  sheet.setColumnWidth(1, dateColWidth); // 日付列
  for (var col = 2; col < numCols; col++) {
    sheet.setColumnWidth(col, dataColWidth); // データ列
  }
  sheet.setColumnWidth(numCols, totalColWidth); // 合計列

  // --- 注記の書式 ---
  var noteRow = totalRowNum + 1;
  sheet.getRange(noteRow, numCols).setFontSize(9);
  sheet.getRange(noteRow, numCols).setFontColor('#888888');
}


// ===================================================================
// 【従来版】CSVをDriveから読み込み→「貼り付け用」シートに転記（生データ）
// ===================================================================
function importCSVFromDrive() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- 転記先シートの存在確認 ---
  const sheet = ss.getSheetByName(CONFIG.RAW_SHEET_NAME);
  if (!sheet) {
    ui.alert('❌ エラー',
      'シート「' + CONFIG.RAW_SHEET_NAME + '」が見つかりません。\n' +
      'シート名を確認してください。',
      ui.ButtonSet.OK);
    return;
  }

  // --- CSVファイルの取得 ---
  let csvFile;
  try {
    csvFile = findLatestCSV_();
  } catch (e) {
    ui.alert('❌ エラー',
      'CSVファイルの検索中にエラーが発生しました。\n\n' +
      '原因: ' + e.message + '\n\nフォルダIDが正しいか確認してください。',
      ui.ButtonSet.OK);
    return;
  }

  if (!csvFile) {
    ui.alert('❌ CSVが見つかりません',
      'フォルダ内に「' + CONFIG.CSV_FILE_PATTERN + '」を含むCSVファイルが見つかりませんでした。',
      ui.ButtonSet.OK);
    return;
  }

  // --- 確認ダイアログ ---
  const fileName = csvFile.getName();
  const lastUpdated = csvFile.getLastUpdated();
  const formattedDate = Utilities.formatDate(
    lastUpdated, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');

  const response = ui.alert('📊 CSV取込確認',
    '以下のCSVファイルを「' + CONFIG.RAW_SHEET_NAME + '」に取り込みます。\n\n' +
    'ファイル名: ' + fileName + '\n' +
    '更新日時: ' + formattedDate + '\n\n' +
    '既存データは上書きされます。よろしいですか？',
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) {
    ui.alert('取込をキャンセルしました。');
    return;
  }

  // --- CSV読み込み＆パース ---
  let rows;
  try {
    const csvContent = csvFile.getBlob().getDataAsString(CONFIG.CSV_ENCODING);
    rows = parseCSV_(csvContent);
  } catch (e) {
    ui.alert('❌ CSV読み込みエラー',
      'CSVファイルの読み込みに失敗しました。\n\n原因: ' + e.message,
      ui.ButtonSet.OK);
    return;
  }

  if (rows.length < 3) {
    ui.alert('⚠️ データ不足',
      'CSVのデータが不十分です（' + rows.length + '行しかありません）。',
      ui.ButtonSet.OK);
    return;
  }

  // --- シートにデータを書き込み ---
  try {
    writeToSheet_(sheet, rows);
  } catch (e) {
    ui.alert('❌ 書き込みエラー',
      'シートへの書き込み中にエラーが発生しました。\n\n原因: ' + e.message,
      ui.ButtonSet.OK);
    return;
  }

  // --- 完了通知 ---
  const dataRowCount = rows.length - 2;
  ui.alert('✅ 取込完了',
    'CSVデータの転記が完了しました！\n\n' +
    'ファイル: ' + fileName + '\n' +
    'データ行数: ' + dataRowCount + '日分\n\n' +
    '「' + CONFIG.RAW_SHEET_NAME + '」シートを確認してください。',
    ui.ButtonSet.OK);

  Logger.log('CSV転記完了: ' + fileName + ', ' + dataRowCount + '日分のデータ');
}


// ===================================================================
// ドライブフォルダから最新のCSVファイルを検索
// ===================================================================
function findLatestCSV_() {
  const folder = DriveApp.getFolderById(CONFIG.CSV_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.CSV);

  let latestFile = null;
  let latestDate = new Date(0);

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    if (name.indexOf(CONFIG.CSV_FILE_PATTERN) !== -1) {
      const modDate = file.getLastUpdated();
      if (modDate > latestDate) {
        latestDate = modDate;
        latestFile = file;
      }
    }
  }

  return latestFile;
}


// ===================================================================
// ドライブフォルダからパターンに一致する全CSVファイルを取得
// ===================================================================
function findAllCSVs_() {
  const folder = DriveApp.getFolderById(CONFIG.CSV_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.CSV);

  var csvFiles = [];

  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf(CONFIG.CSV_FILE_PATTERN) !== -1) {
      csvFiles.push(file);
    }
  }

  // 更新日時の新しい順にソート
  csvFiles.sort(function(a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

  return csvFiles;
}


// ===================================================================
// CSV文字列をパース（2次元配列に変換）
// ===================================================================
function parseCSV_(csvString) {
  // BOM（バイトオーダーマーク）を除去
  if (csvString.charCodeAt(0) === 0xFEFF) {
    csvString = csvString.substring(1);
  }

  // GAS組み込みのCSVパーサーを使用
  // ダブルクォーテーション付きフィールドを正しく処理する
  var parsedLines = Utilities.parseCsv(csvString);

  // 空行を除去
  parsedLines = parsedLines.filter(function(row) {
    return row.some(function(cell) { return cell.trim() !== ''; });
  });

  if (parsedLines.length === 0) {
    return [];
  }

  // 各行の列数を揃えるため、最大列数を取得
  const maxCols = parsedLines.reduce(function(max, row) {
    return Math.max(max, row.length);
  }, 0);

  // 列数を統一（不足分は空文字で埋める）& 数値変換 & クォート除去
  return parsedLines.map(function(row) {
    const normalized = [];
    for (var i = 0; i < maxCols; i++) {
      // セル値を取得し、前後の空白とダブルクォーテーションを除去
      var cell = (i < row.length) ? row[i].trim() : '';
      cell = cell.replace(/^"+|"+$/g, '').trim();

      // 数値に変換可能ならNumber型にする（日付・特殊文字は除く）
      // ただし日付（YYYY/MM/DD形式）はそのまま文字列で保持
      if (cell !== '' && cell !== '-' && cell !== '-%' &&
          !cell.match(/^\d{4}\//) &&
          !isNaN(cell)) {
        normalized.push(Number(cell));
      } else {
        normalized.push(cell);
      }
    }
    return normalized;
  });
}


// ===================================================================
// パースしたデータを「貼り付け用」シートに書き込み
// ===================================================================
function writeToSheet_(sheet, rows) {
  const currentLastRow = sheet.getLastRow();
  const currentLastCol = sheet.getLastColumn();
  if (currentLastRow > 0 && currentLastCol > 0) {
    sheet.getRange(1, 1, currentLastRow, currentLastCol).clearContent();
  }

  if (rows.length > 0 && rows[0].length > 0) {
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  }

  SpreadsheetApp.flush();
}


// ===================================================================
// ユーティリティ：フォルダ内のCSVファイル一覧を表示
// ===================================================================
function listCSVFiles() {
  const ui = SpreadsheetApp.getUi();

  let folder;
  try {
    folder = DriveApp.getFolderById(CONFIG.CSV_FOLDER_ID);
  } catch (e) {
    ui.alert('❌ エラー',
      'フォルダにアクセスできません。\n\nフォルダID: ' + CONFIG.CSV_FOLDER_ID + '\n' +
      '正しいIDを設定してください。',
      ui.ButtonSet.OK);
    return;
  }

  const files = folder.getFiles();
  const fileList = [];

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const mimeType = file.getMimeType();
    const lastUpdated = Utilities.formatDate(
      file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');

    if (mimeType === MimeType.CSV || name.toLowerCase().endsWith('.csv')) {
      const isMatch = name.indexOf(CONFIG.CSV_FILE_PATTERN) !== -1;
      fileList.push((isMatch ? '✅' : '  ') + ' ' + name + '  (' + lastUpdated + ')');
    }
  }

  if (fileList.length === 0) {
    ui.alert('📁 CSVファイル一覧',
      'フォルダ「' + folder.getName() + '」にCSVファイルがありません。',
      ui.ButtonSet.OK);
  } else {
    ui.alert('📁 CSVファイル一覧',
      'フォルダ: ' + folder.getName() + '\n' +
      '検索パターン: 「' + CONFIG.CSV_FILE_PATTERN + '」\n' +
      '✅ = パターンに一致\n\n' +
      fileList.join('\n'),
      ui.ButtonSet.OK);
  }
}


// ===================================================================
// ユーティリティ：現在の設定を表示
// ===================================================================
function showCurrentConfig() {
  const ui = SpreadsheetApp.getUi();

  let folderName = '（未確認）';
  try {
    if (!CONFIG.CSV_FOLDER_ID) throw new Error('未設定');
    const folder = DriveApp.getFolderById(CONFIG.CSV_FOLDER_ID);
    folderName = folder.getName();
  } catch (e) {
    if (e.message === '未設定') {
      folderName = '⚠️ 設定されていません';
    } else {
      folderName = '❌ フォルダにアクセスできません';
    }
  }

  ui.alert('⚙️ 現在の設定',
    'CSVフォルダID: ' + (CONFIG.CSV_FOLDER_ID || '未設定') + '\n' +
    'フォルダ名: ' + folderName + '\n' +
    'ファイル検索パターン: 「' + CONFIG.CSV_FILE_PATTERN + '」\n' +
    '貼り付け用シート: 「' + CONFIG.RAW_SHEET_NAME + '」\n' +
    '店舗名（CONFIG）: ' + CONFIG.STORE_NAME + '\n' +
    '店舗名（POS設定）: ' + (PropertiesService.getScriptProperties().getProperty('POS_TENPO_GROUP_NAME') || '未設定') + '\n' +
    '文字エンコーディング: ' + CONFIG.CSV_ENCODING,
    ui.ButtonSet.OK);
}


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
// 【新規追加】Supabaseへデータを送信する内部関数（チャンク対応＆ScriptProperties参照）
// ===================================================================
function sendProductSalesDataToSupabase_(records) {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_KEY');

  if (!supabaseUrl || !supabaseKey || supabaseUrl.trim() === '') {
    Logger.log('Supabase設定が未完了のため連携をスキップしました');
    return;
  }

  var tableName = 'product_sales_data';
  // エンドポイントURL構築（バルクインサートまたはUPSERT用）
  var url = supabaseUrl + '/rest/v1/' + tableName;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(records),
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Prefer': 'resolution=merge-duplicates' // 重複時は上書き（UPSERT）
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code !== 201 && code !== 200 && code !== 204) {
       Logger.log('Supabase送信エラー: Status ' + code + ', ' + response.getContentText());
    } else {
       Logger.log('Supabase送信成功: ' + records.length + '件');
    }
  } catch (e) {
    Logger.log('Supabase HTTPリクエスト例外エラー: ' + e.message);
  }
}


// ===================================================================
// 【商品マスタ同期】CSVをパースしてSupabase productsテーブルに同期
//
// ※ このCSVにはヘッダー行がない
// ※ カラム位置は以下の通り（0-indexed）:
//    D列(3) = JANコード
//    F列(5) = 商品グループ
//    G列(6) = 商品名
//    I列(8) = 商品金額（売価）
//    L列(11) = 商品原価
// ===================================================================
function processProductMasterCSV_(csvBlob) {
  var csvContent = csvBlob.getDataAsString(CONFIG.CSV_ENCODING);

  // BOM除去
  if (csvContent.charCodeAt(0) === 0xFEFF) {
    csvContent = csvContent.substring(1);
  }

  // parseCSV_() は数値変換してしまうため、ここでは Utilities.parseCsv() を直接使う
  // JANコード（13桁数字）を文字列のまま保持するため
  var rows = Utilities.parseCsv(csvContent);

  // 空行を除去
  rows = rows.filter(function(row) {
    return row.some(function(cell) { return cell.trim() !== ''; });
  });

  Logger.log('商品マスタCSV: ' + rows.length + '行読み込み');

  if (rows.length < 1) {
    return { success: false, count: 0, message: 'CSVにデータがありません' };
  }

  // 先頭行をサンプル表示（デバッグ用）
  Logger.log('1行目サンプル（列数=' + rows[0].length + '）: ' + rows[0].join(' | '));

  // ヘッダーなし — カラム位置を固定で指定（0-indexed）
  var COL = {
    JAN_CODE: 3,       // D列 — JANコード
    PRODUCT_GROUP: 5,  // F列 — 商品グループ
    PRODUCT_NAME: 6,   // G列 — 商品名
    SELLING_PRICE: 8,  // I列 — 商品金額（売価）
    COST_PRICE: 11,    // L列 — 商品原価
  };

  // データ行をパース（1行目からデータ）
  var records = [];
  var skipped = 0;
  var seen = {}; // JANコードの重複チェック用

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];

    // 列数が足りない行はスキップ
    if (row.length <= COL.COST_PRICE) {
      skipped++;
      continue;
    }

    // JANコードを文字列として取得（先頭ゼロを保持するためtrim()のみ）
    var janCode = (row[COL.JAN_CODE] || '').trim();
    var productName = (row[COL.PRODUCT_NAME] || '').trim();

    // JANコードまたは商品名が空の行はスキップ
    if (!janCode || !productName) {
      skipped++;
      continue;
    }

    // 重複JANコードはスキップ（最初の出現を優先）
    if (seen[janCode]) {
      skipped++;
      continue;
    }
    seen[janCode] = true;

    // 商品グループ
    var productGroup = (row[COL.PRODUCT_GROUP] || '').trim();

    // 価格の解析（¥マークやカンマを除去）
    var priceStr = (row[COL.SELLING_PRICE] || '').replace(/[¥\\,\s]/g, '').trim();
    var costStr = (row[COL.COST_PRICE] || '').replace(/[¥\\,\s]/g, '').trim();
    var sellingPrice = parseInt(priceStr, 10) || 0;
    var costPrice = parseInt(costStr, 10) || 0;

    // カテゴリ = 商品グループ名称を使用
    var category = productGroup || '';

    // 粗利率の自動計算
    var markupRate = 0;
    if (sellingPrice > 0) {
      markupRate = Math.round(((sellingPrice - costPrice) / sellingPrice) * 10000) / 10000;
    }

    records.push({
      jan_code: janCode,
      product_name: productName,
      category: category,
      product_group: productGroup || null,
      cost_price: costPrice,
      selling_price: sellingPrice,
      markup_rate: markupRate,
      is_active: true,
    });
  }

  Logger.log('商品マスタCSVパース完了: 有効=' + records.length + '件, スキップ=' + skipped + '件');

  if (records.length > 0) {
    // 最初の3件をサンプル表示
    var sample = records.slice(0, 3);
    for (var s = 0; s < sample.length; s++) {
      Logger.log('  サンプル[' + s + ']: JAN=' + sample[s].jan_code + ', 名前=' + sample[s].product_name + ', 売価=' + sample[s].selling_price + ', 原価=' + sample[s].cost_price);
    }
  }

  if (records.length === 0) {
    return { success: true, count: 0, message: '送信対象の商品データがありませんでした。' };
  }

  // 100件ずつSupabaseに送信（GASタイムアウト対策）
  var chunkSize = 100;
  var sentCount = 0;
  for (var i = 0; i < records.length; i += chunkSize) {
    var chunk = records.slice(i, i + chunkSize);
    upsertProductMasterToSupabase_(chunk);
    sentCount += chunk.length;

    if (i + chunkSize < records.length) {
      Utilities.sleep(100); // サーバー負荷軽減
    }
  }

  return {
    success: true,
    count: sentCount,
    message: sentCount + '件の商品マスタをSupabaseに同期しました。'
  };
}


// ===================================================================
// 【商品マスタ同期】Supabaseの products テーブルへ upsert
// jan_code のUNIQUE制約を利用して重複時は更新
// ===================================================================
function upsertProductMasterToSupabase_(records) {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_KEY');

  if (!supabaseUrl || !supabaseKey || supabaseUrl.trim() === '') {
    Logger.log('Supabase設定が未完了のため商品マスタ連携をスキップしました');
    return;
  }

  var url = supabaseUrl + '/rest/v1/products?on_conflict=jan_code';

  // updated_at を現在時刻に設定
  var now = new Date().toISOString();
  for (var i = 0; i < records.length; i++) {
    records[i].updated_at = now;
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(records),
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      // jan_code のUNIQUE制約で重複時は更新（UPSERT）
      'Prefer': 'resolution=merge-duplicates'
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code !== 201 && code !== 200 && code !== 204) {
      Logger.log('商品マスタSupabase送信エラー: Status ' + code + ', ' + response.getContentText());
    } else {
      Logger.log('商品マスタSupabase送信成功: ' + records.length + '件');
    }
  } catch (e) {
    Logger.log('商品マスタSupabase HTTPリクエスト例外: ' + e.message);
  }
}

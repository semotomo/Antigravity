# POSシステム CSVダウンロード及びSupabase連携 仕様書

## 1. 概要
Power Knowledge POSシステムから売上データ（「月計データ(hmma02180)」「商品別売上(hmma02115)」など）を自動ダウンロードし、Google DriveへのバックアップおよびSupabaseデータベースへのデータ投入を行う処理の仕様と注意点をまとめたドキュメントです。
将来的に「わんわんペットセンター」など別店舗の処理を追加・実装する際や、他のAIアシスタントに本連携のコンテキストを引き継ぐためのリファレンスとして使用します。

---

## 2. システムの全体フローと必須プロセス

POSシステム（Power Knowledge）はセキュリティとセッション管理が厳格であり、単にURLを叩くだけではデータが取得できません。以下のステップを**厳密に順序立てて実行**する必要があります。

### STEP 1: ログインセッションの確立
1. **GET リクエスト**: ログインページ (`/hm-hmma/view/hmma/hmma000/hmma00000.html`) にアクセスし、初期Cookie（`jsessionid` 等）とフォーム内 hidden フィールドを取得する。
2. **POST リクエスト**: `hmma00000Form` に対して以下の認証情報をペイロードに含めて送信する。
   - `loginId`, `password`, `companyCd`, `companyKey`
3. **ダッシュボードへの遷移（超重要）**: 
   ログイン成功後（Status: 302）、**必ずリダイレクト先のダッシュボード画面を GET で読み込む**必要があります。ダッシュボードを経由しないと正しいセッションコンテキストが構築できず、後続のデータ取得ページで 404 エラーやフォームが存在しない空のページが返却されます。

### STEP 2: エクスポート画面へのアクセス
ダッシュボード画面の HTML 内から、目的のエクスポート画面（例: `hmma02115.html`）へのリンクを動的に探し出し、その URL（`jsessionid` が付与されている場合がある）へ GET リクエストを行います。固定の URL文字列を繋ぎ合わせるとエラーになるケースがあるため、動的抽出（フォールバック時は絶対パスによる `resolveUrl_` 経由）を行います。

### STEP 3: 対象月の切り替え（カレンダー操作の再現）
POSのエクスポート画面では、いきなりCSVをダウンロードすることはできません。
1. **月切替の POST リクエスト**: 
   開いたエクスポート画面のフォーム（例: `hmma02115Form`）を取得し、ダウンロード対象の `year` と `month` をセットします。
2. この時、**フォーム内の `do***` 系のボタンのパラメータはすべて削除**して送信します（ブラウザでのカレンダー日付クリックによる「ボタンなし送信」の挙動を模倣するため）。

### STEP 4: エクスポートの実行
1. 月切り替えリクエストの応答として返ってきた新しい HTML 内から再度フォームを抽出します。
2. 今度は CSV ダウンロード実行を示す `doExport` ボタンのパラメータのみを付与（`doExport=送信`）し、再度 POST リクエストを投げます。
3. 応答として `Content-Type: application/octet-stream` や `text/csv` の CSV Blobデータが返却されます。

---

## 3. 次期開発（わんわん店舗用）に向けた設定値の管理

認証情報や店舗IDなどのハードコードを排除し、すべて `PropertiesService.getScriptProperties()`（ScriptProperties）で管理するように改修済みです。
将来「わんわん」用の処理を作る場合、あるいは別のGASプロジェクトに移植する特は以下のキーに対する値が必要です。

### POS接続・自動化設定 (ScriptProperties)
* `POS_BASE_URL` : POSシステムのベースURL
* `POS_LOGIN_ID` : ログインID
* `POS_PASSWORD` : パスワード
* `POS_COMPANY_CD` : 会社コード
* `POS_COMPANY_KEY` : 会社キー
* `POS_TENPO_GROUP_ID` : 店舗グループID（本店/わんわんで異なる値）
* `POS_TENPO_GROUP_NAME` : 店舗表示名（本店/わんわんで異なる値）
* `CSV_FOLDER_ID` : Google Driveの保存先フォルダID
* `SUPABASE_URL` : Supabase APIのベースURL
* `SUPABASE_KEY` : Supabase Anon Key

> **【わんわん導入時のポイント】**
> 現状の `autoDownload.gs` のコードは1つの店舗情報を直列で処理するように書かれています。
> もし「本店」と「わんわん」の両方を同時に処理する場合は、`POS_TENPO_GROUP_ID` を配列形式で管理するか、店舗A用/店舗B用で処理ループを回すように拡張する必要があります。基本的な「STEP 1 〜 STEP 4」の HTTPリクエストの仕組み自体は両店舗で完全に共通で利用できます。

---

## 4. Supabaseへのデータ投入 (商品別売上の場合)

取得した商品別売上の CSVデータ（Shift_JIS など）をパースし、Supabase テーブルへ転送します。

### Supabase テーブル定義 (`product_sales_data`)
* `id` (UUID, Primary Key)
* `store_name` (Text) : 店舗名（「本店」や「わんわん」など）
* `sale_date` (Date) : 売上年月（例: `2026-03-01`。CSVには日別のデータがないため、各月の1日として登録します）
* `product_code` (Text) : 商品コード
* `product_name` (Text) : 商品名
* `quantity` (Integer) : 販売数量
* `sales_amount` (Numeric) : 売上金額（税込）
* `tax_excluded_amount` (Numeric) : 税抜金額
* `created_at` (Timestamp)

### データ投入の仕組み (`importCSV.gs`)
* `Utilities.parseCsv()` は標準で Shift_JIS に対応していないため、自前の `parseCSV_()` 関数を使用して Blob データをパースします。
* レコードを JSON 配列に変換し、Supabase の REST API (`/rest/v1/product_sales_data`) に一括（Bulk）POST します。
* 重複登録を防ぐため、HTTP Headers に `Prefer: resolution=merge-duplicates` を指定して **Upsert** 処理としています。

---

## 5. 遭遇したクリティカルなバグと解決策の歴史

引き継ぐAIエンジニアは以下の罠に注意してください。

1. **フォーム input が取得できない (マッチ=0) バグ**
   - **症状**: ページを取得しても HTML 内に `<input>` タグが一切存在しない。HTML文字数が 300文字程度の 404 エラーなどになっている。
   - **原因**: 対象のURLパスの間に `jsessionid` ではなく、無関係な会社コード等（`/0D890OGI/` など）が二重に注入された不正なURLが生成されていた。
   - **対策**: スクリプト内の `resolveUrl_` に渡すパスは、ダッシュボードから抽出したリンクを優先し、フォールバック時も相対パスではなく必ず絶対パス（`/hm-hmma/...`）で生成するように固定した。
2. **ダッシュボード遷移忘れによるエクスポート失敗**
   - **症状**: ログイン直後に CSVダウンロードページを開こうとすると、正常な画面が返ってこない。
   - **対策**: `loginResponse.getResponseCode() === 302` の場合、リダイレクトヘッダーから必ずダッシュボードを開き、その際のCookieとセッションコンテキストを維持した状態で次へ進むフローを絶対要件とした。
3. **Google Drive上の既存CSVファイルの削除（ゴミ箱移動）エラーによるクラッシュ**
   - **原因**: スクリプト実行者の権限などの都合により、作成済みの古いCSVファイルを `setTrashed(true)` できないケースがある。
   - **対策**: ゴミ箱移動を `try-catch` で囲み、エラー時はスキップして新しい同名ファイルを作成する処理へとフォールバックするようにした。

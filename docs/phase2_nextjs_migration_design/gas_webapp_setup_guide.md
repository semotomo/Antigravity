# GAS Web App デプロイ手順ガイド

更新日: 2026-04-08
対象: ユーザー（kirik）

---

## 概要

現在 GAS は Google Sheets のメニューから手動実行する方式ですが、  
**Web App としてデプロイ** することで、URL を叩くだけで実行できるようになります。

Next.js のボタンからこの URL を呼ぶことで、**Sheets を開かずにワンクリックでデータ取込** が可能になります。

```
[Next.js のボタン] → [API Route] → [GAS Web App URL] → [POS ログイン → CSV → Supabase]
                                         ↑ ここを今から作る
```

---

## 手順

### Step 1: GAS エディタを開く

1. ブラウザで以下の URL にアクセス:
   ```
   https://script.google.com/u/0/home/projects/1nixIMLQV4pA2Panl2LAvvXumftccUrZ6dPixbPLDygIxveYXViy-1Hhj/edit
   ```

2. 左のファイル一覧から `autoDownload.gs` を開く

### Step 2: `doGet()` 関数を追加

`autoDownload.gs` の **一番下** に、以下のコードを追加してください：

```javascript
// ===================================================================
// 【Web App】外部から HTTP GET で実行するためのエントリーポイント
// Next.js の API Route からこの URL を叩いてデータ取込を実行する
// ===================================================================
function doGet(e) {
  // パラメータで対象月を受け取る（省略時は前月）
  var now = new Date();
  var targetMonth = e.parameter.month ? parseInt(e.parameter.month, 10) : now.getMonth();
  var targetYear = e.parameter.year ? parseInt(e.parameter.year, 10) : now.getFullYear();
  
  // getMonth() は 0-indexed なので、0月 = 前年12月
  if (targetMonth === 0) {
    targetMonth = 12;
    targetYear -= 1;
  }

  var posConfig = getPOSConfig_();
  if (!posConfig) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: 'POS接続設定が未完了です。Sheetsのメニューから設定してください。' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    Logger.log('Web App 経由で実行開始: ' + targetYear + '年' + targetMonth + '月');
    var result = downloadProductSalesFromPOS_(posConfig, targetYear, targetMonth);
    return ContentService.createTextOutput(
      JSON.stringify(result)
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('Web App 実行エラー: ' + err.message);
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: 'エラー: ' + err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

> ⚠️ **注意**: `doGet` という名前は GAS の予約名です。別の名前にしないでください。

### Step 3: コードを保存

- `Ctrl + S` で保存（または上部のフロッピーアイコン）

### Step 4: Web App としてデプロイ

1. GAS エディタの右上にある **「デプロイ」** ボタンをクリック

2. **「新しいデプロイ」** を選択

3. ⚙️ 歯車アイコン（「種類の選択」）をクリックし、**「ウェブアプリ」** を選択

4. 以下の設定を入力：

   | 項目 | 設定値 |
   |------|--------|
   | 説明 | `売上データ取込 Web App` |
   | 次のユーザーとして実行 | **自分** |
   | アクセスできるユーザー | **自分のみ** |

   > ⚠️ **「自分のみ」がとても重要です！**  
   > 「全員」にすると、URL を知った誰でもあなたの POS にアクセスできてしまいます。

5. **「デプロイ」** をクリック

6. **「アクセスを承認」** ボタンが表示されたらクリック
   - Google アカウントの選択画面が出る → 自分のアカウントを選択
   - 「このアプリは確認されていません」と表示される場合:
     - 左下の **「詳細」** をクリック
     - **「〇〇（安全ではないページ）に移動」** をクリック
     - **「許可」** をクリック

7. ✅ **デプロイ完了！** 以下のような URL が表示されます：

   ```
   https://script.google.com/macros/s/AKfycbx.........../exec
   ```

   **この URL をコピーしてメモしておいてください。**  
   Next.js の `.env.local` に設定するために必要です。

### Step 5: Next.js の `.env.local` に URL を設定

1. `next_app/.env.local` を開く

2. 以下の行を追加：

   ```
   GAS_WEBAPP_URL=https://script.google.com/macros/s/AKfycbx.........../exec
   ```

   > ⚠️ `NEXT_PUBLIC_` は付けないでください（サーバー側でのみ使う環境変数です）

3. ファイルを保存

### Step 6: 動作確認（任意）

ブラウザで直接 GAS の URL を開いて動作確認できます：

```
https://script.google.com/macros/s/AKfycbx.........../exec
```

- 成功すると JSON が返ります: `{"success":true,"count":1234,"message":"..."}`
- エラーの場合: `{"success":false,"message":"エラー内容..."}`

> **注意**: 「アクセスできるユーザー = 自分のみ」に設定した場合、  
> Google にログイン済みのブラウザでのみアクセスできます。  
> シークレットモードでは動作しません。

---

## よくあるトラブルと対処

### 「スクリプトにアクセスする権限がありません」

→ デプロイ時に「アクセスを承認」をスキップした可能性があります。  
「デプロイ」→「デプロイを管理」→ 鉛筆アイコンで編集 → 再承認

### 「doGet is not defined」

→ `doGet` 関数が正しく追加されていない。`autoDownload.gs` の一番下に追加されているか確認。

### URL を叩いても HTML ページが返る

→ Google のログインページにリダイレクトされている。  
ブラウザで Google にログインしてから再試行。

### GAS の実行がタイムアウトする

→ POS からのデータ取得に時間がかかりすぎている。  
GAS には 6分のタイムアウト制限があります。  
データ量が多い月は、Sheets のメニューから手動実行してください。

---

## デプロイの更新方法

コードを修正した場合、**新しいバージョンでデプロイし直す** 必要があります：

1. 「デプロイ」→「デプロイを管理」
2. 鉛筆アイコン（編集）をクリック
3. バージョン: **「新しいバージョン」** を選択
4. 「デプロイ」をクリック

> URL は変わりません。`.env.local` の再設定は不要です。

---

## 完了後のフロー

```
ユーザーの操作:
  売上画面の「📊 売上データ取込」ボタンをクリック
          ↓
Next.js:
  API Route (app/api/gas/trigger) にリクエスト
          ↓
  API Route が GAS_WEBAPP_URL を fetch()
          ↓
GAS:
  doGet() が実行される
  → POS にログイン
  → 商品別 CSV をダウンロード
  → Supabase の product_sales_data に upsert
  → JSON で結果を返す
          ↓
Next.js:
  結果を受け取り、画面にトースト表示
  revalidatePath('/sales') でデータ更新
          ↓
ユーザー:
  最新の売上データが画面に反映される ✅
```

# 商品マスタ自動同期 — GASセットアップ手順

## 概要

POSポータルから商品マスタCSVを自動ダウンロードし、
Supabaseの `products` テーブルと同期する機能です。

```
[Sheetsメニューの「🏷️ 商品マスタ同期」をクリック]
    ↓
[POSポータルにログイン]
    ↓
[商品検索画面 (hmma02405) で店舗グループ選択 → 検索]
    ↓
[商品データのエクスポート → チェックボックス設定 → エクスポート実行]
    ↓
[CSVダウンロード → Google Driveに保存]
    ↓
[CSVパース → Supabase products テーブルにupsert]
    ↓
[完了 ✅]
```

---

## セットアップ手順

### STEP 1: GASエディタでコードを更新

1. ブラウザで GAS エディタを開く
2. `autoDownload.gs` を開き、**既存のコードを最新版に全文差し替え**
   - ソース: `gas/autoDownload.gs`（ローカルファイル）
3. `importCSV.gs` を開き、**既存のコードを最新版に全文差し替え**
   - ソース: `gas/importCSV.gs`（ローカルファイル）
4. `Ctrl + S` で保存

### STEP 2: スプレッドシートを再読み込み

1. スプレッドシートの画面に戻る
2. `F5` で更新
3. メニュー「📊 売上CSV取込」に **「🏷️ 商品マスタ同期（POS→Supabase）」** が追加されていることを確認

### STEP 3: 実行

1. メニュー **「📊 売上CSV取込 → 🏷️ 商品マスタ同期（POS→Supabase）」** をクリック
2. 確認ダイアログで **「はい」** をクリック
3. 処理完了を待つ（商品数によりますが通常1〜3分程度）
4. 結果ダイアログが表示されれば完了！

---

## 追加されたファイル・関数

### autoDownload.gs に追加

| 関数名 | 説明 |
|--------|------|
| `downloadAndSyncProductMasterMenu()` | メニューから呼び出すUIラッパー |
| `downloadProductMasterFromPOS_(posConfig)` | POSからCSVダウンロード＆Supabase同期のコア関数 |

### importCSV.gs に追加

| 関数名 | 説明 |
|--------|------|
| `processProductMasterCSV_(csvBlob)` | 商品マスタCSVをパースしてSupabaseに送信 |
| `upsertProductMasterToSupabase_(records)` | products テーブルへの upsert |

### importCSV.gs の onOpen() に追加

```
🏷️ 商品マスタ同期（POS→Supabase）
```

---

## CSVカラムマッピング

| POSのCSVヘッダー | → Supabase `products` カラム |
|------------------|------------------------------|
| 商品コード | `jan_code` |
| 商品名 | `product_name` |
| 商品グループ名称 | `category` + `product_group` |
| 商品金額 | `selling_price` |
| 商品原価 | `cost_price` |
| ※自動計算 | `markup_rate` |

---

## トラブルシューティング

| 症状 | 対処法 |
|------|--------|
| メニューに表示されない | F5でスプレッドシートを再読み込み |
| ログインに失敗する | POS接続設定（メニュー → ⚙️ POS接続設定）を確認 |
| CSVが取得できない | GASの「実行ログ」に各STEPの詳細ログが出力されているので確認 |
| タイムアウト | 商品数が非常に多い場合はGASの6分制限に抵触する可能性あり |

> ⚠️ **初回実行時の注意**
> POSポータルのフォーム要素名（ボタン名やチェックボックス名）は推定値です。
> 初回実行で不具合があった場合、GASの実行ログに詳細なデバッグ情報が出力されます。
> そのログを共有していただければ、フォーム要素名を修正します。

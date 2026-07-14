# 修正内容 of JAN code dot zero bug (Walkthrough)

商品マスタ同期時にJANコード末尾に `.0` が付与されるバグを修正しました。

## 変更内容

### 1. GAS（Google Apps Script）の修正 (`gas/importCSV.gs`)
- 商品マスタのCSVパース部分（1178行目付近）にて、JANコードを読み取る際に末尾の `.0` を削除する置換処理（`janCode.replace(/\.0$/, '')`）を追加しました。
- データの型（数値型・文字列型）を問わず安全に動作するよう `.toString()` を明示的に挟みました。

---

## 検証と適用手順

### 1. GAS（Google Apps Script）の更新適用
Googleスプレッドシートの「拡張機能 > Apps Script」を開き、`importCSV.gs` の内容を最新のコードに上書き（貼り替え）して保存してください。

### 2. データベースのクリーンアップ（Supabase SQL Editor の実行）
すでに登録されている `.0` 付きのゴミデータを安全に削除または書き換えるため、以下のSQLを Supabase 管理画面の SQL Editor で実行してください。

```sql
-- 既存の products テーブルの jan_code で、末尾が '.0' で終わっているものを修正する
-- 重複を防ぐため、修正後の jan_code が既に存在している場合は、古い '.0' の付いた方を削除する
DO $$
DECLARE
    r RECORD;
    new_jan TEXT;
BEGIN
    FOR r IN SELECT id, jan_code FROM public.products WHERE jan_code LIKE '%.0' LOOP
        new_jan := substring(r.jan_code from 1 for length(r.jan_code) - 2);
        
        -- 修正後のJANコードが既にテーブルに存在するかチェック
        IF EXISTS (SELECT 1 FROM public.products WHERE jan_code = new_jan) THEN
            -- 既に存在する場合は重複するため、古いレコードを削除
            DELETE FROM public.products WHERE id = r.id;
        ELSE
            -- 存在しない場合は、JANコードを修正
            UPDATE public.products SET jan_code = new_jan WHERE id = r.id;
        END IF;
    END LOOP;
END $$;
```

# 生体価格の値下げ表記対応の実装計画

値下げされたペットについて、価格の値下げ文言や改行を含むリッチテキスト表示ができるようにするため、DBスキーマの拡張と同期・UI表示の改修を行います。

## ユーザー対応が必要な事項
本番環境のDB（Supabase）に新しいカラム `price_text` を追加する必要があります。
デプロイ後、またはデプロイ前に、Supabaseの管理画面「SQL Editor」より以下のSQLを実行してください：

```sql
ALTER TABLE public.cms_pets ADD COLUMN IF NOT EXISTS price_text TEXT;
```

---

## 提案する変更内容

### 1. データベース定義の更新
#### [NEW] [20260707141000_add_pet_price_text.sql](file:///C:/Users/kirik/Desktop/Antigravity/supabase/migrations/20260707141000_add_pet_price_text.sql)
- `price_text` カラムを `cms_pets` テーブルに追加するマイグレーションファイルを作成します。

#### [MODIFY] [database.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/types/database.ts)
- TypeScriptの型定義（`Row`, `Insert`, `Update`）に `price_text: string | null` を追加します。

### 2. 同期アクションの修正
#### [MODIFY] [petsSync.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/actions/petsSync.ts)
- CMSの `textarea09`（価格テキスト）からスタイル用の HTMLタグのみを取り除き、改行や矢印などの文字列をそのまま維持して `price_text` カラムへ格納するよう改修します。
- 同時に、数値型価格（`price_tax_excluded`, `price_tax_included`）の抽出ロジックを改善し、最も後ろ（最後）に記述されている価格情報を値下げ後の最新価格として自動検出するように修正します。

### 3. 詳細画面UIの改修
#### [MODIFY] [PetDetailModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetDetailModal.tsx)
- 生体価格の表示部にて、`pet.price_text` が登録されている場合は、改行を維持して表示（`whitespace-pre-line`）させます。
- 登録されていない場合は、従来通りの数値フォーマット「〇〇円（税込〇〇円）」で表示するフォールバック処理を実装します。

---

## 検証計画

### 1. 自動テスト・型チェック
- `npx tsc --noEmit` を実行し、TypeScriptのビルド型エラーが発生しないことを確認します。

### 2. 手動検証
- Supabase SQL適用後、手動で同期スクリプトを再実行し、値下げペット（例: `126152` など）のDB上の `price_text` に改行付き文字列が正しくUpsertされることを確認します。
- UIの生体詳細モーダルを開き、表示スタイルが崩れずに値下げ表示がなされていることを確認します。

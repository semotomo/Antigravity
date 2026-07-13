# 生体管理の共通ダッシュボードレイアウトへの統合計画

生体情報の管理画面が他の画面（売上、商品、客注など）のサイドバーや共通レイアウトから外れている問題を解決するため、Next.jsのRoute Group内にフォルダを移動し、ナビゲーションに完全統合します。

## ユーザーレビューが必要な事項
なし（ファイルの配置移動のみであり、ルーティングURLや機能に変更はありません）。

---

## 提案する変更内容

### 1. ディレクトリ構造の変更

#### [NEW] [page.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/pets/page.tsx)
- `app/pets/page.tsx` を `app/(dashboard)/pets/page.tsx` に移動（新設）します。

#### [DELETE] [page.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/pets/page.tsx)
- 移動元の `app/pets/page.tsx` を削除します。

---

## 検証計画

### 1. 自動テスト・型チェック
- `npx tsc --noEmit` を実行し、ファイル移動に伴うTypeScriptのビルド型エラーが発生しないことを確認します。

### 2. 手動検証
- 生体情報の画面（`/pets`）を開いた際に、左側に共通のサイドバーナビゲーション（Kennelロゴ、客注管理、商品管理、売上、ログアウト等）が正しく表示されることを確認します。
- サイドバーの「商品管理」などの他のメニューをクリックした際、正しくその画面へ移動できることを確認します。
- モバイル表示時にも、画面下部に共通のボトムメニューが表示されることを確認します。

# Next.js Phase 2 Remaining Handoff (2026-04-04)

以下の前提で、このリポジトリの Next.js 移行プロジェクト（Phase 2 残り画面）の実装をおねがいします。

## 最初に読むべきドキュメントとコード
まず以下のドキュメントと既存機能のソースを読み込み、全体設計とコーディングスタイルを把握してください。

1. `docs/phase2_nextjs_migration_design/phase2_remaining_screens_design.md` （今回の主要な設計図）
2. `next_app/app/(dashboard)/products/unmatched/page.tsx` 関連ファイル（既存パターンの参考）
3. `next_app/app/(dashboard)/orders/page.tsx` 関連ファイル（既存パターンの参考）
4. `docs/ai_best_practices/best_practices.md` （行動規範・ルール）

## お願いしたいタスクと実装要件

上記の設計書に沿って、以下の順序で実装してください。
※「ファイルの作成・変更・削除の前に必ず作業計画を報告し、`y` の確認を得る」というルールを必ず守ること。

### 1. 【最優先】ログインフォームのセキュリティ脆弱性修正
- **対象ファイル**: `next_app/app/(auth)/login/page.tsx`
- **内容**: `<form>` 要素に **`method="POST"`** 属性を追加してください。（JavaScriptロード前にエンター送信された際、デフォルトの GET 送信によってパスワードが URL パラメータに露出するのを防ぐため）

### 2. `/products` （商品マスタ画面）
- **対象**: `products` テーブルの一覧・編集機能。
- **指示**: 設計書の「2-1. `/products`」に基づいて、Server Component, Client Component (ProductsBoard等), Server Actions のセットを作成してください。

### 3. `/products/aliases` （エイリアス管理画面）
- **対象**: `product_aliases` テーブルの紐付け先変更・削除機能。
- **指示**: 設計書の「2-2. `/products/aliases`」に基づいて実装してください。
- **特記事項**: 「紐付け先変更」のマスタ選択 UI は商品数が多いことを想定し、単なる `<select>` ではなく（Shadcn UI 等の）文字検索が可能な ComboBox かサジェスト機能付きの UI にしてください。

### 4. `/orders/[id]` （客注詳細画面）
- **対象**: `customer_orders` の単体詳細詳細と更新。
- **指示**: 設計書の「2-3. `/orders/[id]`」に基づいて実装してください。
- **特記事項**: 既存の客注一覧画面 (`/orders`) における各オーダーのカードに、「詳細を見る (`/orders/[id]` へのリンク)」導線を追加してください。

## 開発・アーキテクチャのガイドライン
- Next.js 16 (App Router) + Server Actions を利用し、状態管理を極力持たないシンプルで堅牢な構成にすること。
- Supabase のやり取りには必ず `@supabase/ssr` の Server/Client クライアントを利用すること。
- 型定義は `next_app/lib/types/database.ts` に依存し、手書き部分から不足があれば補完すること。
- UIのスタイリングには Tailwind CSS を使用し、既存コンポーネントのデザインと統一感を持たせること。

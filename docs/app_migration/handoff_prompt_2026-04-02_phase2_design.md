# Handoff Prompt 2026-04-02 Phase 2 Design

以下の前提で、この repo の作業を再開してください。

## 最初に読むファイル

1. `docs/app_migration/next_ai_handoff_phase2.md`
2. `docs/app_migration/next_ai_handoff_phase2_orders_2026-04-02.md`
3. `docs/app_migration/handover_log.md`
4. `next_app/lib/orders.ts`
5. `next_app/lib/queries/orders.ts`
6. `next_app/app/actions/orders.ts`

## 現在地

- Next.js への移行プロジェクト継続中
- Phase 1 の基盤構築は完了済み
- `next_app/` 配下で開発中
- `/sales`, `/sales/daily`, `/sales/products` は実装済み
- Phase 2 の最初の対象だった `/orders` は初版実装済み
- `npm run lint` と `npm run build` は通る

## 今回の前提

- `/orders` は再実装しないこと
- 今回あなたにお願いしたいのは、**Phase 2 の残り画面の設計整理** です
- 実装より先に、画面設計・データフロー・Server Actions 構成・ファイル分割案をまとめてください

## 設計対象

優先度順:

1. `/products/unmatched`
2. `/products`
3. `/products/aliases`
4. 必要なら `/orders/[id]`

## 期待するアウトプット

以下を日本語で整理してください。

1. 残り Phase 2 の全体設計
2. 最優先の `/products/unmatched` の画面設計
3. データ取得 / 更新の責務分割
   - Server Component
   - Server Actions
   - `lib/queries/*`
   - `components/*`
4. 作成予定ファイル一覧
5. 実装順序
6. リスクと注意点

## `/products/unmatched` で特に見てほしいこと

- `sales_enriched_v` の `unmatched_master = true` を UI でどう扱うか
- 既存商品に紐付ける場合の UX
- 新規商品を作って、そのまま alias 登録まで進める場合の UX
- `products` と `product_aliases` の 2 段書き込みをどうまとめるか
- Next.js 16 + Server Actions 前提で、過不足ない構成になっているか

## 制約

- DB 直結ではなく、`@supabase/ssr` の client を使うこと
- 変更系は API Routes ではなく Server Actions を前提に考えること
- `lib/types/database.ts` は手書き補完版なので、型戦略にも触れること
- `next_app/AGENTS.md` にある通り、Next.js 16 のローカル docs 前提で考えること

## 依頼のゴール

次の実装担当 AI が、そのまま着手できるレベルの設計メモを作ること。

特に `/products/unmatched` については、

- 画面構成
- 主要コンポーネント
- state の持ち方
- action の分け方
- 今回の `/orders` 実装から流用できる考え方

まで踏み込んでください。

## 注意

- repo には今回の移行作業と無関係な未整理変更もあるため、巻き込まないこと
- 既存の未コミット変更は勝手に revert しないこと
- `/orders` はすでに実装済みなので、差し戻しや全面作り直しを前提にしないこと

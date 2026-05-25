# Next.js Phase 2 Handoff: `/orders` 実装完了メモ

更新日: 2026-04-02
対象: 次に Phase 2 設計・実装を引き継ぐ AI / 開発者

## 1. 今回完了したこと

Phase 2 の最初の対象だった **客注管理 (`/orders`) の初版実装** を完了した。

実装済みの機能:

- `/orders` 一覧ページ
- ステータスタブ切替
  - `all`
  - `pending`
  - `ordered`
  - `arrived`
  - `contacted`
  - `completed`
  - `cancelled`
- 新規客注登録モーダル
- 既存客注編集モーダル
- カード上の「次へ進む」操作
  - `pending -> ordered`
  - `ordered -> arrived`
  - `arrived -> contacted`
  - `contacted -> completed`
- カード上のキャンセル操作
- サイドナビ / ボトムナビへの導線追加

未実装:

- `/orders/[id]`
- 削除操作
- 履歴専用ビュー
- `expected_arrival_date`, `unit_price`, `jan_code` の UI 編集

## 2. 実装ファイル

今回の主な追加 / 更新ファイル:

- `next_app/app/(dashboard)/orders/page.tsx`
- `next_app/app/actions/orders.ts`
- `next_app/components/orders/OrdersBoard.tsx`
- `next_app/components/orders/OrderCard.tsx`
- `next_app/components/orders/OrderFormModal.tsx`
- `next_app/lib/orders.ts`
- `next_app/lib/queries/orders.ts`
- `next_app/lib/types/database.ts`
- `next_app/components/layout/SideNav.tsx`
- `next_app/components/layout/BottomNav.tsx`

検証を通すために最小限修正した既存ファイル:

- `next_app/components/ui/DataTable.tsx`
- `next_app/lib/supabase/server.ts`
- `next_app/lib/supabase/client.ts`
- `next_app/lib/supabase/middleware.ts`
- `next_app/lib/queries/sales.ts`
- `next_app/app/(dashboard)/sales/page.tsx`
- `next_app/app/(dashboard)/sales/daily/page.tsx`
- `next_app/app/(dashboard)/sales/products/page.tsx`

## 3. 設計方針

今回の `/orders` は、既存 Flet 客注画面の業務フローを保ちながら、Next.js 16 App Router + Server Actions へ載せ替える方針で実装した。

ポイント:

- 読み取りは Server Component 側でまとめて取得
- 変更系は `app/actions/orders.ts` の Server Actions へ集約
- Next.js 16 のローカル docs に合わせ、各 Server Action 内で認証を再確認
- 更新後は `revalidatePath('/orders')` と `refresh()` を実行
- UI は依存追加せず、既存スタックだけで構成
- モバイル操作を意識してカード中心の構成にした

## 4. データ取得 / 更新の構成

### 読み取り

`next_app/lib/queries/orders.ts`

- `fetchOrders()`
  - `customer_orders`
  - `stores`
  - `products`
  を並列取得し、サーバー側で結合
- `fetchOrderFormOptions()`
  - 店舗一覧
  - アクティブ商品一覧

join を直接 `select()` に埋め込まず、アプリ側で結合している理由:

- 現在の `lib/types/database.ts` は手書きの最小型で、Supabase 生成型ほど join 推論が強くない
- まず build が安定する構成を優先した

### 変更

`next_app/app/actions/orders.ts`

- `saveOrderAction`
  - 新規登録
  - 既存更新
- `advanceOrderStatusAction`
  - 次ステータスへ前進
- `cancelOrderAction`
  - `cancelled` へ更新

## 5. 型まわりの注意

`next_app/lib/types/database.ts` には今回、次を追加した。

- `customer_orders`
- `stores`
- 既存 `products` / `product_aliases` / view 群の `Insert/Update/Relationships`

ただし現時点では **Supabase CLI 生成の完全な型定義ではなく、手書きの補完版** である。

そのため、`app/actions/orders.ts` の `insert/update` は一部で `as never` を使っている。

意味:

- 実行時のクエリ自体は正しい
- ただし型定義だけは今後 `supabase gen types typescript ...` 相当で置き換える余地がある

次の AI が DB 型を正式化する場合は、まず `lib/types/database.ts` を自動生成ベースへ寄せるのがよい。

## 6. UI 構成

### `OrdersBoard`

- ヒーローエリア
- 進行中 / 完了 / キャンセルのサマリー
- ステータスタブ
- カード一覧
- 新規作成ボタン

### `OrderCard`

- 顧客名
- 管理番号
- ステータスバッジ
- 商品名 / 数量
- マスタ商品
- 電話番号
- 店舗
- 補足
- 受注日 / 期限
- 作成日時 / 更新日時
- 次へ進む
- 編集
- キャンセル

### `OrderFormModal`

フォーム項目:

- `customer_name`
- `phone_number`
- `item_name`
- `item_details`
- `staff_name`
- `status`
- `order_no`
- `quantity`
- `store_id`
- `product_id`
- `order_date`
- `pickup_due_date`
- `notes`

## 7. 検証結果

確認済み:

- `npm run lint`
- `npm run build`

build 結果:

- `/orders` は dynamic route として正常に出力された
- 既存 `/sales`, `/sales/daily`, `/sales/products` も build を通る状態に修正済み

## 8. 次の AI に引き継ぎたいこと

次の優先実装候補は **`/products/unmatched`**。

理由:

- Phase 2 handoff 文書でも優先度が高い
- Python スクリプト依存を UI 化する価値が高い
- 売上分析の運用改善に直結する

次の AI への推奨順序:

1. `/products/unmatched`
2. `/products`
3. `/products/aliases`
4. 必要なら `/orders/[id]`

## 9. `/products/unmatched` 設計メモ

今回の `/orders` 実装を踏まえると、次は次の形が自然。

- 読み取り:
  - `sales_enriched_v` から `unmatched_master = true`
- 更新:
  - 既存商品へ紐付ける場合
    - `product_aliases` へ insert
  - 新規商品として登録する場合
    - `products` へ insert
    - 続けて `product_aliases` へ insert
- UI:
  - 左に未一致商品一覧
  - 右に詳細 / 紐付けフォーム
- 技術判断:
  - 今回と同様に Server Actions で十分
  - ただし新規商品 + alias を 1 操作で扱うので、action の責務を整理した方がよい

## 10. 補足

`next_ai_handoff_phase2.md` には今回の進捗アップデートも追記済み。

次の AI には、まず以下を読むよう渡すとスムーズ:

1. `docs/app_migration/next_ai_handoff_phase2.md`
2. `docs/app_migration/next_ai_handoff_phase2_orders_2026-04-02.md`
3. `docs/app_migration/handover_log.md` の第27報

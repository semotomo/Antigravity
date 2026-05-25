# Next AI Handoff: Next.js Phase 2 (残画面実装)

更新日: 2026-04-02
対象: 次の AI または開発者向け

## 0. 進捗アップデート (2026-04-02)

2026-04-02 時点で、Phase 2 のうち **客注管理 (`/orders`) の初版実装は完了** しています。

- 実装済み:
  - `/orders` 一覧ページ
  - ステータスタブ切替
  - 新規客注登録
  - 既存客注編集
  - カード上でのステータス前進
  - キャンセル操作
  - サイドナビ / ボトムナビへの導線追加
- 未実装:
  - `/orders/[id]`
  - `/products`
  - `/products/unmatched`
  - `/products/aliases`

今回の詳細な実装ログと次 AI 向けの補足は、次のドキュメントを参照してください。

- `docs/app_migration/next_ai_handoff_phase2_orders_2026-04-02.md`
- `docs/app_migration/handover_log.md` の第27報

## 1. 現状の到達点 (Phase 1 完了)

Streamlit / Budibase からの移行プロジェクトにおいて、Next.js (App Router) ベースでの MVP（売上ダッシュボード）の初期構築が完了しています。

- **配置**: `c:\Users\kirik\Desktop\Antigravity\next_app\`
- **スタック**: Next.js 16.2.1 (Turbopack), Tailwind CSS 4, Supabase Auth (`@supabase/ssr`)
- **完了した機能**:
  - `proxy.ts` (Next.js 16向けミドルウェア) での認証ガード
  - `/login` ログイン画面 (Supabase Auth: `testtest1234@gmail.com` / `1234`)
  - サイドナビ(PC)・ボトムナビ(SP)対応のダッシュボードレイアウト (`app/(dashboard)/layout.tsx`)
  - クライアント用／サーバー用 Supabase クライアント (`lib/supabase/*`)
  - `/sales` 売上一覧 (フィルタ・未一致ハイライト含む)
  - `/sales/daily` 日次集計
  - `/sales/products` 商品別集計

## 2. これから実装するページ (Phase 2 全体像)

このドキュメントは、次に実装すべき**「客注管理」「商品マスタ管理」「エイリアス管理（未一致解消）」**の 3 機能に焦点を当てています。

| 機能名 | パス設定 | 対応 DB テーブル | 優先度 |
|---|---|---|---|
| 客注管理 | `/orders` <br> `/orders/[id]` | `public.customer_orders` | 高 |
| 商品マスタ管理 | `/products` <br> `/products/[id]` | `public.products` | 中 |
| 未一致解消・エイリアス管理 | `/products/unmatched` <br> `/products/aliases` | `public.sales_enriched_v`<br>`public.product_aliases` | 高 (※1) |

> (※1) Python スクリプトで回していた未一致解消を UI から完結できるようにするため、運用上極めて重要です。

---

## 3. 各画面の詳細仕様と実装プラン

### 3-1. 客注管理（`/orders`）

**目的**: これまでの紙や Flet ベースの客注管理を、Next.js 上の Kanban またはリストボードで直感的に操作できるようにする。

**データソース**: `public.customer_orders`
- **主要カラム**: `id` (uuid), `customer_name`, `phone_number`, `item_name`, `status`, `notes`, `created_at`
- **Phase 1 拡張カラム**: `order_no`, `store_id`, `product_id`, `quantity`, `order_date`, `pickup_due_date`

**必要なアクション (Supabase RPC/Queries)**:
1. 現在の進行中タスク取得 (`status != 'completed' AND status != 'cancelled'`)
2. ステータス変更 (`pending` → `ordered` → `arrived` → `contacted` → `completed`)
3. 新規オーダーの登録
4. 既存オーダーの詳細編集

**UI 検討**:
- 画面上部にステータス切り替えタブ（"すべて", "発注待ち(pending)", "到着待ち(ordered)"...）
- モバイルでもタップ切り替えがしやすいよう、`OrderCard` コンポーネントを作り情報をコンパクトに表示。
- カードの「次へ進む」ボタンでステータスをポンポン進められる UX。

---

### 3-2. 未一致売上解消UI（`/products/unmatched`）

**目的**: Pos データ連携時にマスタと非一致だった（`unmatched_master=true`）売上に対して、直接 UI から新規マスタ登録・エイリアス登録（POS名のひも付け）を行う。これにより Python スクリプトを使った複雑な CSV 運用の手間を無くす。

**データソース**:
- 読み取り: `public.sales_enriched_v` (`where unmatched_master = true`)
- 書き込み: `public.products` または `public.product_aliases`

**運用フロー（UIへの落とし込み）**:
1. 画面には「未紐付けのPOS商品名一覧」とそれぞれの出現回数を表示する。
2. クリックするとサイドパネルまたはモーダルが開く。
3. **選択肢 A: 既存商品に紐付ける (エイリアス追加)**
   - 既存の `products` を検索できるドロップダウン/検索窓。
   - 選んで「保存」すると、`product_aliases` に対象POS名をインサート。
4. **選択肢 B: 新規商品として登録**
   - フォームが表示され、JAN、原価、カテゴリなどを入力。
   - 保存すると `products` にインサートされ、同時に `product_aliases` にもインサートされる（1トランザクションでできると丁寧だが、Next.jsのServer Actionから2連続リクエストでも可）。

---

### 3-3. 商品マスタ管理 (`/products`)

**目的**: 登録済み商品の原価、売価、カテゴリ、アクティブフラグを直接ブラウザからメンテする。

**データソース**: `public.products`
- **主要カラム**: `id`, `jan_code`, `product_name`, `cost_price`, `selling_price`, `category`, `is_active`

**UI 検討**:
- 売上一覧と同じ `DataTable` コンポーネントを流用。
- インライン編集、もしくは「編集」ボタンからのモーダル起動。
- 非アクティブ化（`is_active` のトグル操作）。

---

## 4. Next.js 開発者への推奨実装順序とヒント

実装は以下の順番で進めることを強く推奨します。

#### Step 1: Navへの導線追加
- `components/layout/SideNav.tsx` と `BottomNav.tsx` のコメントアウトを外し、`/orders`, `/products` などのリンクを有効にする。

#### Step 2: 客注管理 (`/orders`)
- 独立性が高く、最もよく使われる機能です。
- 最初に `lib/queries/orders.ts` を作り、Server Actions でのステータス更新関数を用意。
- モーダル用の汎用コンポーネントか Shadcn-like なダイアログを追加するとスムーズです。

> 2026-04-02 追記:
> 上記 Step 2 は初版実装済み。次の AI は Step 3 の `/products/unmatched` から着手してよい。

#### Step 3: 未一致解消 UI (`/products/unmatched`)
- 売上分析がスムーズに進むよう、この機能が非常に重要になります。
- フォームが複雑になるため、React Hook Form (+ Zod) を導入するかシンプルに State 管理するかを判断してください。
- `import_products_from_csv.py` で行っていた処理を TypeScript に移植するイメージです。

#### Step 4: 商品マスタ管理 (`/products` と `/products/aliases`)
- 最後に、残った商品マスタ本体とエイリアス一覧のマスターメンテ画面を作ります。

---

## 5. 技術的な注意点

1. **Server Actions の活用**: データの登録・更新（`INSERT`, `UPDATE`）は、API Routesではなく **Server Actions** を使用すると簡潔に書けます。
   - 例: `app/actions/orders.ts` のようなファイルに `'use server'` を宣言して関数を定義。
2. **Turbopack の仕様**: Next.js 16.2.1 を Turbopack で動かしているため、`middleware.ts` ではなく **`proxy.ts`** を使用している点に留意してください。
3. **DB接続**: PostgreSQL 直結ではなく、必ず `@supabase/ssr` の `createServerClient` か `createBrowserClient` を通じて REST API / RPC ベースでアクセスしてください（RLSと安全性を担保するため）。
4. **型安全**: `lib/types/database.ts` にスキーマの型が定義されているため、これを使用して型推論を効かせてください。

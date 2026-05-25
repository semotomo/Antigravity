# Phase 2 残り画面の全体設計

## 1. 残り Phase 2 の全体設計

Phase 1 (売上ダッシュボードベース) および 客注管理 (`/orders`) 初版が完了した現状から、残りの主要機能単位は「商品マスタ（未一致解消・マスタメンテ）」に絞られます。
実装の優先度は以下の順です：

1. **`/products/unmatched` (最優先)**: POS で売上があったがシステム上のマスタがない「未一致」商品の解消。
2. **`/products`**: 登録済み商品マスタの一覧および編集。
3. **`/products/aliases`**: 既存の別名（エイリアス）一覧および管理。
4. **`/orders/[id]`**: 必要に応じた客注の詳細表示または追加要件の受け皿。

構成アプローチとしては、先行する `/orders` 実装での成功パターン（Server Componentで並列データ取得、Server Actionsへの更新処理集約、`@supabase/ssr`クライアント利用）を踏襲し、Next.js 16 App Router に最適化した構成とします。

---

## 2. 最優先の `/products/unmatched` の画面構成・データフロー

### 2-1. UI / UX 構成

未一致商品を効率よく解消できるよう、画面を「未一致リスト」と「詳細・登録フォーム」の2ペイン（左右分割、または一覧から開くサイドパネル/モーダル）で構築します。

*   **左ペイン (未一致POS商品一覧)**:
    *   `sales_enriched_v` ビューから `unmatched_master = true` のものを POS 商品名 (`product_name`) 単位で抽出・集約（`GROUP BY product_name`）。
    *   「出現回数」や「直近の売上日」などを併記し、業務影響の大きい（売れ筋の）商品から解消できるようにする。
*   **右ペイン (解消アクション)**:
    *   一覧から一つを選択すると、以下の2つのタブ（またはラジオボタン）で解消方法を選択できる UI を表示。
    *   **パターン A: 既存商品に紐付ける（エイリアス登録）**
        *   既存の `products` の中から正しいマスタを検索できるサジェスト付きインプット（ComboBox など）。
        *   選択後、「紐付ける」ボタンで `product_aliases` に対象 POS 名を登録。
    *   **パターン B: 新規マスタとして登録し、そのまま紐付け**
        *   マスタの基本情報（JANコード、カテゴリ、原価、売価等）を入力するフォーム。
        *   POS 商品名を「新規マスタの商品名」の初期値としてセット。
        *   「登録して紐付ける」ボタンで、1回の操作として商品登録とエイリアス登録を連続実行。

### 2-2. `products` と `product_aliases` の 2 段書き込みの扱い

パターン B (新規登録+紐付け) では、`products` テーブルへの `INSERT` で採番された `id` を利用し、続けて `product_aliases` への `INSERT` を行います。
*   **実装方針**: Server Actions は Node.js 環境上で走るため、Next.js API Routes へのリクエストではなく直接 Supabase へ 2 段階の非同期リクエスト (`await supabase.from('products').insert(...).select('id')` → 取得した `id` で `await supabase.from('product_aliases').insert(...)`) を投げます。
*   **フォールバック**: もし1つ目が成功して2つ目が失敗した場合、画面上へ「マスタの登録には成功しましたが、紐付け処理でエラーが発生しました」とエラー表示を行い、ユーザーには「パターンA」でのリトライを促します（安全のためゴミデータとしての削除処理までは追わない）。

---

## 3. データ取得 / 更新の責務分割

### 3-1. Server Component (`app/(dashboard)/products/unmatched/page.tsx`)
*   **責務**: 初回表示用のデータ取得。
*   `lib/queries/products.ts` から `fetchUnmatchedProducts()` を呼び出して一覧を取得し、Client Component (`UnmatchedBoard` 等) にプロパティとして引き渡します。

### 3-2. `lib/queries/products.ts` (データフェッチ)
*   **責務**: `fetchUnmatchedProducts()` (未一致の一覧)、`fetchActiveProducts()` (既存商品検索用・パターンA向け) などを定義。
*   `createClient()` を使用して Supabase から取得し、必要な整形を行って Component 仕様に合わせます。

### 3-3. Server Actions (`app/actions/products.ts`)
*   **責務**: `INSERT` / `UPDATE` 処理の集約。
*   **アクション名**:
    *   `matchToExistingProductAction(formData)`: 「パターンA」を実行（`product_aliases` への新規登録）。
    *   `createNewProductAndMatchAction(formData)`: 「パターンB」を実行（`products` 新規登録 → `product_aliases` 新規登録）。
*   処理完了時に `revalidatePath('/products/unmatched')` および `refresh()` を呼び出し、UI を再同期します。

### 3-4. `components/products/*` (UI Component)
*   `UnmatchedBoard.tsx`: 全体状態（選択中の未一致アイテム）を管理する Client Component。
*   `UnmatchedList.tsx`: 左ペイン向けの未一致アイテム一覧。
*   `ResolveMatchPanel.tsx`: 右ペイン。選択中アイテムと、パターンA/B を切り替えるタブを管理。

---

## 4. 作成・修正予定ファイル一覧

**新規作成ファイル:**
*   `next_app/app/(dashboard)/products/unmatched/page.tsx`
*   `next_app/app/actions/products.ts`
*   `next_app/lib/queries/products.ts`
*   `next_app/components/products/UnmatchedBoard.tsx`
*   `next_app/components/products/UnmatchedList.tsx`
*   `next_app/components/products/ResolveMatchPanel.tsx`
*   `next_app/lib/products.ts` (共有インターフェースや定数、バリデーションロジック)

**修正ファイル:**
*   `next_app/components/layout/SideNav.tsx` (リンク活性化 / 未一致件数のバッジ追加)
*   `next_app/components/layout/BottomNav.tsx`
*   `next_app/lib/types/database.ts` (不足している場合、`sales_enriched_v` や `product_aliases` の `Row/Insert/Update` 定義を追加)

---

## 5. 推奨実装順序

1.  **型の整備**: `lib/types/database.ts` に対して `product_aliases` と `sales_enriched_v` の型安全性が保たれているか確認（手書き補完）。
2.  **クエリの作成と動作確認**: `lib/queries/products.ts` を作成し、`fetchUnmatchedProducts()` によるデータ抽出を実行・確認。
3.  **UI ガワの構築**: `products/unmatched/page.tsx` および `UnmatchedBoard.tsx` 系を作成し、左ペインを描画（右ペインはモック状態）。
4.  **Server Actions のスケルトン作成**: `app/actions/products.ts` を作成し、`formData` の受け取りと認証チェック (`requireAuthenticatedClient()`) のみを実装。
5.  **右ペインフォームと Actions の結合**: `ResolveMatchPanel.tsx` を実装し、実際の Supabase への書き込みと `revalidatePath()` の連携まで通す。
6.  **（余裕があれば）商品マスタ関連 `/products` 等の構築**: 未一致解消が終わった段階で、`/products` や `/products/aliases` の構築へ着手。

---

## 6. リスクと注意点

*   **Supabase Client の利用**:
    Next.js の規約通り、データの取得・更新は必ずセッション付きの `@supabase/ssr` クライアント経由で行ってください。直接ドライバー叩きなどは行いません。
*   **型定義の乖離（TypeScript）**:
    `database.ts` は手書きによる補完の段階にあるため、Server Action 内での `INSERT/UPDATE` 時には `as never` によるアサーションを妥協点として使っている箇所があります（現状の `/orders` 実装に倣う）。まずは動作（ビルド成功）を優先してください。
*   **エイリアスの重複**:
    すでに別のマスタエイリアスに紐付けてしまっている POS名に対して、紐付けアクションを実行した際、データベースからユニーク制約エラーが返る可能性があります。この場合は適切に catch して "登録済みの商品名です" と等と UI へエラー状態（`OrderMutationState` パターン）を返却するようにしてください。
*   **State なしでの簡潔な実装**:
    できる限り `useOptimistic` などの複雑な Client State 管理は導入せず、`/orders` 実装の際と同様に FormData と Action State を用いたシンプルな Server Actions として構築してください。

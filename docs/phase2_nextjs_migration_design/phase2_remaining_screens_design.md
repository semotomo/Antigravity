# Phase 2 残り画面の詳細設計 (`/products`, `/products/aliases`, `/orders/[id]`)

本ドキュメントは、Next.js (App Router) への移行プロジェクトにおける Phase 2 の残り機能（`/products`, `/products/aliases`, `/orders/[id]`）の詳細設計書です。
既存の `/orders` および `/products/unmatched` （Server Component で取得・Client Component で表示・Server Actions で更新）の設計方針を踏襲しています。

## 1. 実装順序の提案
他の実装にブロックされず、独立して進められるものから着手します。
1. **【最優先】ログイン画面の漏洩修正**: URL にパスワードが乗る脆弱性の修正（HTMLフォームのメソッド追加）。
2. **`/products` (商品マスタ一覧)**: 全機能のベースとなるマスタ管理画面の作成。
3. **`/products/aliases` (エイリアス管理)**: マスタ作成後に紐付くデータのため、次点。
4. **`/orders/[id]` (客注詳細)**: `/orders` に詳細用のレイヤーを追加。

---

## 2. 各画面の詳細設計

### 2-1. `/products` (商品マスタ)

#### 目的
登録済みのシステム商品マスタ（`products` テーブル）を閲覧、検索、編集し、販売停止した商品の非アクティブ化などを管理する。

#### UI/UX構成
- 画面上部に検索バー（商品名、JAN、カテゴリ）を配置。
- `DataTable` を活用し、JANコード、商品名、原価、販売価格、粗利率、ステータスを表形式で表示。
- 行末に「編集」ボタンを配置。クリックで「商品編集モーダル (`ProductFormModal`)」が開く。
- モーダル内で入力後、保存ボタンで更新。

#### 必要なファイルと職務分割
- **追加: `app/(dashboard)/products/page.tsx`** (Server Component)
  - `fetchProducts()` を実行し、初回一覧データを Client Component へ渡す。
- **追加: `components/products/ProductsBoard.tsx`** (Client Component)
  - 表全体のレイアウト構成。
- **追加: `components/products/ProductFormModal.tsx`** (Client Component)
  - 編集フォーム。`useActionState` にて Server Action へ送信。状態管理はモーダルの開閉フラグのみ。
- **更新: `lib/queries/products.ts`**
  - **`fetchProducts()`**: 削除や非アクティブ（`is_active=false`）なものも含め、商品マスタを一覧取得。
- **更新: `app/actions/products.ts`**
  - **`updateProductAction(formData)`**: `products` の既存レコードを UPDATE する。
- **既存の再利用**: `lib/products.ts` に定義された ProductMutationState 等を使い回す。

#### バリデーション / エラーハンドリング
- **バリデーション**: FormData から値を取り出し、`JAN`のフォーマットや金額のマイナス値等をはじく。
- **エラーハンドリング**: `jan_code` (UNIQUE) のコンフリクト時 (`error.code === '23505'`) は「このJANコードはすでに使われています」とユーザーフレンドリーに返す。

#### `revalidatePath` の方針
- 更新に成功したら `revalidatePath('/products')` および各種 `'/sales'` (売上分析等へ商品名変更が波及するため) を実行する。

---

### 2-2. `/products/aliases` (エイリアス管理)

#### 目的
POSシステムからの名称（`product_aliases.alias_name`）とマスタ（`products.product_name`）の紐付け一覧を管理し、紐付け先の変更や誤った紐付けの削除を行う。

#### UI/UX構成
- `DataTable` で「生POS名」「紐付け先システム商品名」「登録日時」を並べて表示。
- 検索窓で POS 名を検索。
- 各行に「先を変更」と「削除」の操作を配置。

#### `unmatched` 画面との責務分離
- `/products/unmatched`: 「**未登録**の POS 名」を対象とし、新規の紐付けを生む画面。
- `/products/aliases`: 「**登録済み**の POS 名」を対象とし、既存の紐付けを管理・削除・修正する画面。両者の対象データは交わらないため、Query の責務は明確に分かれる。

#### 必要なファイルと職務分割
- **追加: `app/(dashboard)/products/aliases/page.tsx`** (Server Component)
- **追加: `components/products/AliasesBoard.tsx`** (Client Component)
- **更新: `lib/queries/products.ts`**
  - **`fetchProductAliases()`**: `product_aliases` に `products` を `join` して一覧を引く。
- **更新: `app/actions/products.ts`**
  - **`updateAliasTargetAction(formData)`**: `product_id` を別マスタへ UPDATE する。
  - **`deleteAliasAction(formData)`**: 指定の紐付けレコードを論理削除 or 物理 DELETE する。

---

### 2-3. `/orders/[id]` (客注詳細)

#### 目的
単一の客注（カスタマーオーダー）の全容を把握する。カードサイズには収まりきらない長文メモや、将来的な履歴追加などの拡張枠となる。

#### UI/UX構成
- 最上部に大きく「受付番号」「顧客名」「現在のステータスバッジ」を配置（サマリーカード）。
- 中段に編集フォームを展開しておく（`/orders` で使っている `OrderFormModal` の構造を流用し、インライン表示化）。
- 下段またはサイドに「タイムライン（登録日時や更新日）」などのプレースホルダ枠を設ける。

#### 必要なファイルと職務分割
- **追加: `app/(dashboard)/orders/[id]/page.tsx`** (Server Component)
  - `props.params.id` を受けて `fetchOrderDetails(id)` で1件取得。存在しないなら `notFound()` を呼ぶ。
- **追加: `components/orders/OrderDetailView.tsx`** (Client Component)
  - インラインの編集フォーム。
- **更新: `lib/queries/orders.ts`**
  - **`fetchOrderDetails(id)`**: 単体取得クエリ (`.eq('id', id).single()`) 。店舗(`stores`)・マスタ(`products`)を JOIN。
- **既存の再利用**:
  - `app/actions/orders.ts` の **`saveOrderAction`** は既存のもので ID があれば UPDATE 処理へ回るように組まれているため、これを詳細画面からも完全に再利用する。

#### `revalidatePath` の方針
- `revalidatePath('/orders', 'layout')` を呼び出す。これにより `/orders` 以下の全画面 (`/orders` 一覧 および `/orders/[id]` 詳細) のキャッシュを一括破棄する。

---

## 3. 将来考慮すべき点と実装時リスク

### 3-1. 今回は実装しないが将来考慮すべき点
1. **在庫・入出荷との連動**: 今回のフェーズでは、システム上で商品紐付けを行っても、客注が「完了」となった瞬間に在庫を差し引くロジックまでは含まれていません。マスタ整備後のPhase 3以降での実装余地となります。
2. **客注の変更履歴自動記録**: 「いつ・誰が・何を変更したか（ステータス変更含む）」を追える `order_history` テーブルがないため、将来的なトラブル防止のための設計が必要です。

### 3-2. 実装時のリスクと注意点
- **Supabase の Client 切り分け制限**: 画面ごとに Client Component と Server Component の境界を越える際、Supabase インスタンスや Date 型オブジェクトなどが serialize 不能エラーを起こすため、クエリ層 (`fetchProducts` など) や Server Acttions において、**Component へ渡す前に不要なオブジェクトを剥がし、プレーンな型に整形**してから渡すよう留意してください。
- **ログイン画面のセキュリティインシデント**: 現在 `next_app/app/(auth)/login/page.tsx` の `<form>` に `method="POST"` 属性が存在しません。React Hydration 完了前にエンターなどで Submit が行われると、ブラウザのHTMLネイティブ挙動として GET リクエストが発動し、URL文字列にパスワードが乗ってしまいます。「実装着手時の最優先タスク」として同ファイルへの `method="POST"` の追記を規定してください。

---

## 4. この設計で実装を始める前にユーザー確認が必要な点
1. **`/products/aliases` (エイリアス管理) における「変更」操作のUIについて**
   - 紐付け先マスタを変更する場合、商品マスタが数百個〜数千個あると、単なるプルダウン（`<select>`）では重く操作しづらくなります。今回「変更」UI は、文字検索が可能な ComboBox（例: Shadcn UI を使ったサジェストなど）を採用する前提で進めてよろしいでしょうか？（実装難易度は少し上がります）
2. **`/orders` → `/orders/[id]` への遷移導線**
   - すでにある `/orders` 画面の客注カード上に、「詳細を見る」といったアイコンや遷移リンクを追加する修正もセットで行ってよろしいでしょうか？

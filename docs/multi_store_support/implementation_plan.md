# 複数店舗（わんわん・マスター）サポート機能 実装計画

「わんわん用」のアカウントの新規作成、および「マスター」アカウントと「わんわん」アカウントごとの表示デフォルト化、商品の個別JANコード判別用「タグ」機能の実装を行います。

## ユーザーレビューが必要な内容

> [!IMPORTANT]
> - **アカウント区分と店舗デフォルト表示（表示制限は行いません）**: 
>   - Supabase Auth の `raw_user_meta_data` （メタデータ）に `store_type` を持たせることで判定します。
>     - `'master'`: 初期デフォルト表示は **「本店」** (全店舗切り替え可能な管理者)
>     - `'wanwan'`: 初期デフォルト表示は **「わんわん（わんわんペットセンター）」**
>   - セキュリティ上の表示制限（非表示化）は行わず、あくまで「開いた際のデフォルト」を各アカウントに最適化します。切り替えトグルは全員が使用可能です。
> - **JANコード混同の防止（最重要）**:
>   - わんわんと他店舗で商品のJANコードがすべて異なるため、商品マスタに「タグ」項目を追加して区別できるようにします。
>   - エクスポートや入出庫での商品検索時にも、現在選択されている店舗（わんわん ⇄ 本店）や商品タグに基づいて適切に検索が切り替わり、JANコードの混同が起きないように配慮します。
> - **商品タグ機能**: 
>   - `products` テーブルに `tags` カラム（TEXT型、カンマ区切り）を追加し、商品編集画面で編集できるようにします。
> - **店舗切り替え**:
>   - 共通サイドバーに「店舗表示切替」セレクターを配置し、表示店舗設定を **Cookie（クッキー）** で保持します。
>   - `'all'`（両方表示）、`'main'`（本店のみ）、`'wanwan'`（わんわんのみ）を切り替えられるようにし、アプリ全体の生体表示・商品検索・移動履歴・エクスポートに即座に反映させます。

---

## 提案する変更点

### 1. データベーススキーマの拡張
#### [NEW] [20260721155000_add_tags_to_products.sql](file:///C:/Users/kirik/Desktop/Antigravity/supabase/migrations/20260721155000_add_tags_to_products.sql)
- `products` テーブルに `tags` TEXT カラム（デフォルト：`NULL`）を追加。

### 2. アカウント区分・店舗表示設定の共通関数の整備
#### [NEW] [storeAuth.ts (lib/storeAuth.ts)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/storeAuth.ts)
- ログイン中のユーザーメタデータ（`store_type`）および Cookie に保存された `current_store_view` から、アクセス権限と「現在のアクティブ表示店舗」を判定するヘルパー。

### 3. オプション設定（店舗切り替えトグル）の追加
#### [NEW] [StoreViewSelector.tsx (components/layout/StoreViewSelector.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/layout/StoreViewSelector.tsx)
- ヘッダー（SideNavなど）に表示する、マスター用の店舗切り替えセレクトボックス（またはトグルボタン）。
- 選択時に Cookie の値を書き換えてページをリロードし、表示を動的に切り替えます。（わんわんユーザーの場合は非表示で「わんわん」に固定されます）

### 4. 各画面の店舗表示・切り替え対応
#### [MODIFY] [page.tsx (app/(dashboard)/pets/page.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/pets/page.tsx) / [PetsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetsBoard.tsx)
- ログインユーザーに応じた生体管理の初期店舗の設定（わんわん ⇄ 本店）。
- 表示される生体リストのフィルタリングを、設定Cookie（またはアカウント制限）と連動させます。

#### [MODIFY] [page.tsx (app/(dashboard)/products/page.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/products/page.tsx) / [ProductForm.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/products/ProductForm.tsx)
- 商品一覧に「タグ」列を追加。
- 新規登録・編集モーダルで「タグ」のテキスト入力をサポート。
- エクスポート時および商品検索時に、ログイン中の店舗設定（わんわん / 本店 / 両方）に応じてリストを自動フィルタリングする仕組みを実装。

#### [MODIFY] [transfers.ts (lib/transfers.ts)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/transfers.ts) / [page.tsx (app/(dashboard)/products/transfers/page.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/products/transfers/page.tsx)
- 移動（入出庫）のデフォルト店舗判定（`chooseDefaultTransferFromStoreId`）を、ログインユーザー設定に合わせるよう修正。

---

## 検証計画

### 自動テスト
- `npx tsc --noEmit` および `npm run build` の正常動作確認。

### 手動検証
- 新規で `wanwan@example.com` ユーザー（メタデータ `store_type: 'wanwan'`）を作成してログインし、生体の初期店舗が「わんわん」に固定されること。
- マスターユーザーでログイン時、設定セレクターから「本店のみ」に切り替えると全ページのデフォルトが「本店」になり、「全店舗」なら全て表示されること。
- 商品にタグ（例: "わんわん"）を登録し、商品検索や一覧に正しくタグが表示されること。

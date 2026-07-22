# 複数店舗・アカウント別制御 追加開発タスクリスト

- [ ] データベースマイグレーション
  - [ ] `supabase/migrations/20260721155000_add_tags_to_products.sql` を新規作成し、`products` テーブルに `tags` カラムを追加
- [ ] 共通ロジック & ヘルパーの実装
  - [ ] `next_app/lib/storeAuth.ts` を新規作成し、ユーザー種別判定（`store_type`）および Cookie による表示店舗設定の取得・判定を実装
- [ ] 共通UIコンポーネントの作成
  - [ ] `next_app/components/layout/StoreViewSelector.tsx` を新規作成し、ヘッダー（またはサイドバー）での店舗表示切替UIを実装
  - [ ] `next_app/components/layout/SideNav.tsx` に `StoreViewSelector` を統合
- [ ] 各画面の修正
  - [ ] 生体管理 (`app/(dashboard)/pets/page.tsx`, `components/pets/PetsBoard.tsx`)
    - [ ] アカウント設定（または Cookie 設定）に基づく「初期店舗のデフォルト表示」の適用（切り替えは自由に可能）
  - [ ] 商品マスタ・エクスポート (`app/(dashboard)/products/page.tsx`, `components/products/ProductForm.tsx`)
    - [ ] `products` への「タグ（`tags`）」入力・編集UIの追加と一覧表示への組み込み
    - [ ] アカウント設定（または Cookie 設定）に基づく、商品検索やエクスポート時のデフォルト店舗およびタグによるJAN混同防止のフィルタリング適用
  - [ ] 移動・振替履歴 (`lib/transfers.ts`, `app/(dashboard)/products/transfers/page.tsx`)
    - [ ] `chooseDefaultTransferFromStoreId` をアカウント設定・Cookie設定を考慮するように修正
- [ ] 検証
  - [ ] `npx tsc --noEmit` および `npm run build` によるビルド確認

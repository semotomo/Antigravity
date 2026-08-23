# 棚卸し・在庫管理 Phase 1 本番検証記録

> 実施日: 2026-08-23
> 対象: Supabase本番DB
> 結果: **PASS**

## 適用前

- ユーザーが物理backupなし・保存済み論理backupで進めることを承認。
- `supabase migration list --linked`: 既存13件がlocal/remote一致、Phase 1だけ未適用。
- `supabase db push --linked --dry-run`: 対象は`20260823163000_inventory_phase1_schema.sql`の1件だけ。seed/role混入なし。
- 読み取り専用preflight: `PASS`。
  - 商品: 6,544件
  - JAN欠損: 0件
  - store 6/7以外: 0件
  - `store_id + JAN`重複: 0グループ
  - Phase 1オブジェクト衝突: 0件
  - products競合lock: 0件
  - Authユーザー: 3件

## 本番適用

1. Phase 1 migrationを1件適用。
2. postapplyを実行し、棚卸しテーブルのデータが0件の状態で構造を確認。
3. Git管理外seedを1transactionで実行。
   - Auth UUID・メール3件の一致を実行時検証。
   - 本店専用1名へstore 7を付与。
   - 指定2名へstore 6・7を付与。
   - 全5行を`manager`として登録。
   - 想定外権限0件を同一transactionで検証。

## 適用後

| 検証 | 結果 |
|---|---|
| migration履歴 | local/remote 14/14一致 |
| Phase 1テーブル | 10/10存在 |
| RLS | 10/10有効 |
| FORCE RLS | 10/10有効 |
| `private.can_access_store` | 1関数存在 |
| `products(id, store_id, jan_code)`制約 | 所有マーカー付きで1件存在 |
| 初期店舗権限 | 5行 |
| その他の棚卸しデータ | 0行 |
| 本店専用アカウント | store 6拒否、store 7許可、可視権限1行 |
| 両店舗アカウント1 | store 6/7許可、可視権限2行 |
| 両店舗アカウント2 | store 6/7許可、可視権限2行 |
| authenticated直接UPDATE | 拒否 |
| Supabase DB lint | schema errorなし |
| 関連回帰 | 本番読み取り監査を含む35/35成功 |

本番読み取り監査に必要な`.env.local`は隔離worktreeへコピーせず、検証中だけメイン側ファイルへの一時ハードリンクを使用し、終了時に削除した。

## 変更していないもの

- GASデプロイ
- Vercelデプロイ
- Git commit / push
- 既存商品データ
- POS在庫数の参照・保存

## 次の作業

Phase 2で、計数時刻以降のPOS販売・返品・店舗移動・物品使用・手動調整を再集計し、何度同期しても同じ結果になる計算コアとServer Action/APIをテスト先行で実装する。

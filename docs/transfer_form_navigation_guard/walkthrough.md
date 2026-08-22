# 商品移動フォームの離脱警告・並び順修正 検証結果

## 実装内容

- 未保存の入力がある間、ページ内のリンク遇移をcaptureフェーズで検知し、移動前に確認する。
- スマホ下部ナビ、商品サブナビ、その他メニュのNext.js Linkに同じ警告を適用する。
- リロードやタブを閉じる操作には`beforeunload`を適用する。
- 商品マスタ一致、手入力、手入力待ち、未一致解消のすべての新規追加経路を先頭追加に統一した。
- 同一条件の商品を再読取した場合は既存行の数量を加算する既存動作を維持した。

## 自動検証

- `node --test tests/transfer_form_navigation_guard_test.mjs tests/product_store_separation_test.mjs tests/realtime_history_cache_test.mjs`: 9件成功
- `npx tsc --noEmit`: 成功
- `npx eslint components/transfers/TransferFormModal.tsx lib/useUnsavedChangesGuard.ts`: 成功
- `npm run build`: 成功

## 本番確認

- Gitコミット`0ad8559`を`origin/main`へpushし、Vercelデプロイ成功を確認した。
- 本番の`/products/transfers`が未認証時に`/login`へリダイレクトされることを確認した。
- 自動確認用ブラウザにはログイン状態がなかったため、実アカウントでのモバイル操作は未実施。代わりに、下部タブと同じ`a[href]`をcaptureで防止する回帰テストを実施した。

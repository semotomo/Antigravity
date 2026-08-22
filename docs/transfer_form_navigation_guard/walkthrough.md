# 商品移動フォームの離脱警告・並び順修正 検証結果

## 実装内容

- 未保存の入力がある間、ページ内のリンク遇移をcaptureフェーズで検知し、移動前に確認する。
- スマホ下部ナビ、商品サブナビ、その他メニュのNext.js Linkに同じ警告を適用する。
- リロードやタブを閉じる操作には`beforeunload`を適用する。
- ブラウザ戻る、Android戻る、iPhoneのスワイプ戻るは`popstate`で検知し、キャンセル時は同一URLの保護履歴へ復帰して入力を保持する。
- 戻る・ページ内リンクの移動を続行した場合は保護履歴を先に外し、移動後の戻る履歴に同じ画面を二重に残さない。
- React Strict Modeで副作用が再実行されても保護履歴を重複追加しない。
- 商品マスタ一致、手入力、手入力待ち、未一致解消のすべての新規追加経路を先頭追加に統一した。
- 同一条件の商品を再読取した場合は既存行の数量を加算する既存動作を維持した。

## 自動検証

- `node --test tests/transfer_form_navigation_guard_test.mjs tests/product_store_separation_test.mjs tests/realtime_history_cache_test.mjs`: 11件成功
- `npx tsc --noEmit`: 成功
- `npx eslint components/transfers/TransferFormModal.tsx lib/useUnsavedChangesGuard.ts`: 成功
- `npm run build`: 成功

## 本番確認

- 初回対応のGitコミット`0ad8559`に加え、戻る操作対応`d0f6bd4`を`origin/main`へpushし、Vercelデプロイ成功を確認した。
- 本番の`/products/transfers`が未認証時に`/login`へリダイレクトされることを確認した。
- 自動確認用ブラウザにはログイン状態がなく、ログイン済みChromeへの直接接続も利用できなかったため、実アカウントでのモバイル操作は未実施。代わりに、下部タブと同じ`a[href]`のcapture処理と、戻る操作の履歴保護・復帰・続行処理を回帰テストで確認した。

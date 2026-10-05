# 商品POS連動 P2a 継続記録

- 専用worktree `pos-product-management` のみで作業。元ルートの `scratch/test_gas.mjs` と別worktreeの `petsSync.ts` は保持。
- 通常編集の差分・指紋・保存後照合を `edit-review.server.ts` に追加し、既存server-only台帳へ接続。公開Action、実POS送信は追加していない。
- 追加15テスト成功。機能合計72件成功（通常58、隔離実SQL14）。全回帰160/163で既存3件失敗、型・対象Lint・本番build成功。全体Lintは既存3 errors / 5 warnings。
- 本店のJAN検索→詳細→編集を読取り確認。内部ID候補は取得可能DOMでは空で未確定。商品を保存せず一覧へ戻り、確認用タブを維持した。
- 次は内部ID/保存フォーム契約の確定、CSV同期共通排他、商品DB反映transaction、画面接続。詳細は `docs/pos_product_management/walkthrough.md`。
- 本番DB適用、GASデプロイ、Git commit/push、Vercel反映、POS保存・削除は未実施。

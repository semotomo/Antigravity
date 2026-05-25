# タスクリスト：パフォーマンス ＆ UX全面改善

- `[ ]` Supabase クエリのリファクタリング（Join移行による爆速化）
  - `[ ]` `next_app/lib/queries/orders.ts` 内の `fetchOrders` で `fetchAllRows` を廃止し、Join結合で店舗・商品を取得するよう修正
  - `[ ]` 同ファイルの `fetchOrderDetails` も同様に、Join結合クエリに書き換え
  - `[ ]` 同ファイルの `fetchOrderFormOptions` で、商品マスタを無制限に全件ロードするのを防ぎ、`limit(100)` に制御をかける
- `[ ]` 詳細ページのキャンセル機能ローディング対応
  - `[ ]` クライアントコンポーネント `next_app/components/orders/CancelOrderButton.tsx` を新規作成（`useFormStatus` を適用）
  - `[ ]` 詳細ページ `next_app/app/(dashboard)/orders/[id]/page.tsx` のインラインフォームを `<CancelOrderButton>` に置き換え
- `[ ]` 削除機能のローディングフィードバック追加
  - `[ ]` `next_app/components/orders/DeleteOrderButton.tsx` 内で `useFormStatus`（またはそれに準ずるクライアントサイドフォーム送信中ステータス）を利用して、削除処理中にボタンを「削除中...」に書き換え、非活性化（ロック）する処理を追加
- `[ ]` 検証および本番デプロイ
  - `[ ]` ローカルで `npm run build` を実行し、型チェックと本番ビルドが正常にパスすることを確認
  - `[ ]` 変更を Git コミットし、GitHub に push して Vercel での本番デプロイを再稼働
  - `[ ]` 本番環境で実際のページ表示速度、ボタンクリック時の応答をテスト

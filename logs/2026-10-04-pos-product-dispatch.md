# POS商品編集の永続実行権・復旧照合

状態: P2eローカル完了。本番保存は無効。

- 固定dispatch登録/一度だけのconsume/private復旧読取りを追加。本人manager・店舗・操作hash・内部ID・期待値を束縛し、商品/棚卸し数量/在庫を変更しない。
- 再受付/登録応答消失は元の本文・期限・基準を再利用。独立レビューの認可待機中変更・prepared再登録の2指摘を再現テスト先行で修正し、再レビュー成功。
- 関連44/44、メモリ内DB48/48、全回帰289/292（従来と同じ3失敗）。独立型・対象Lint・本番build成功。全体Lintは既存3 errors/5 warnings。
- 本番DB/GAS/実POS/Git/Vercel未変更。署名付き保存通信/consume HTTP/復旧UI、旧writer切替、実PostgreSQL複数接続、実保存/画像保持は未完了。
- 実装/検証の詳細: `docs/pos_product_management/walkthrough.md`、適用前確認: `docs/pos_product_management/ledger_deployment.md`。

# P2f1 保存通信・GAS専用consume受付

状態: 通信部のローカル実装/検証完了。manager保存制御と復旧UIは未接続。

- 固定本文/期限を使う署名POST1回、GAS専用consumeの要求/応答署名、DB manager再認可を接続。待機中の停止/鍵更新/期限切れをテスト先行で修正し、再レビュー成功。
- 新規通常35件・DB1件。全回帰324/327（同じ既存3失敗）、DB49/49、型・対象Lint・本番build26/26成功。全体Lintは既存3 errors/5 warnings。
- fixture設定のloopback本番サーバーでOFF時の実POST503/no redirect/no-storeを確認。実Node受付→実SQL→実GAS consumerは両店舗true/false成功（通信合成/メモリ内DB）。
- 本番DB/GAS/実POS/Git/Vercelは未変更。詳細・残るgateは `docs/pos_product_management/walkthrough.md` / `ledger_deployment.md`。

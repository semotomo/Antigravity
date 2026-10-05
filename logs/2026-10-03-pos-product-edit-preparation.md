# 商品編集の取得・レビュー受付接続

- 本店JAN4902397868767の検索→詳細→編集を実画面で再確認（保存なし）。
- ローカル変更: `gas/posProductForm.js`、`gas/posProductReadDiagnostic.js`、`inspection.server.ts`、`edit-preparation.server.ts`、新規テスト、Plans/walkthrough。
- manager認可・店舗別DB商品・両POS検索の一致確認・差分レビュー・台帳受付を接続。公開UI/Actionと実保存は未接続。
- 新規11/11、関連37/37、全体198/201（既存3失敗）、SQL36/36。型・対象Lint・本番build成功。全体Lintは既存3 errors / 5 warnings。
- GASはread-only cloneとデプロイ一覧確認のみ。旧診断を含む4ファイル、HEAD/11/12/56。本番DB/POS保存/Git push/Vercel変更なし。
- 次は対象2ファイルをGASへ反映し、同じ本店商品の編集情報を1回手動読取り確認する承認待ち。詳細・固定比較値・未検証事項は `docs/pos_product_management/walkthrough.md`。

## 承認後の続行

- ユーザーが対象2ファイルのGAS HEAD反映・本店読取りを承認。直前pull照合、元4ファイル退避後に隔離コピーから反映した。公開Web App、トリガー、設定は変更していない。
- 手動診断は途中5回安全停止し、例外原文を出さない固定工程/属性分類で `CONTROL_ATTRIBUTES_DUPLICATE_TYPE` と特定。完全一致typeの重複のみ許可し、異なるtype・店舗/JAN/項目重複は拒否。表示用class/styleは判定に使用しない。
- 8:06:19の成功結果: 店舗7、JAN4902397868767、内部ID0-0-721485575、両検索完了/同一検査、デイリーディッシュ子猫チキン 35g、価格126、原価75、分類721420887、仕入先null、分類候補9/仕入先候補25、税0、一括/固定価格。商品保存/削除・DB更新なし。
- レビューで偽template/引用属性内の所属項目と文字参照の値変化を修正。署名inspect通信/受付をローカル追加し、認可→DB照合の後に専用接続を生成。異常応答の本文も閉じ、再送しない。新受付ファイル・公開入口はGASへ送っていない。
- 最新検証: 関連48/48、全回帰209/212（同じ既存3失敗）、独立型・対象Lint・本番build成功。SQLは今回変更せず直前36/36を継承。
- 最終pullで既存3ファイルのバイト一致と対象2ファイルの内容一致、公開デプロイ4件不変を確認。初回退避先 `C:/Users/mario/AppData/Local/Temp/kennel-pos-inspection-backup-20261003-3e835886b7b44c2c819f91d993ffda40`（一時ソース退避、資格情報/Script Propertiesを含まない）。
- 次は非対象状態を保護する保存アダプターとUI/公開接続の完成。実保存、DB本番適用、GAS公開版、Git/Vercelは対象・差分確認後の別承認。

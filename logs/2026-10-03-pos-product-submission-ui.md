# POS商品編集の送信準備・UI検証

状態: ローカル実装/合成データ検証に加え、承認済みGAS HEADの3ファイル反映と所有者組立診断を実施。実保存・公開デプロイは未実施。

- 本店の既知商品を未変更で表示し、multipart/未選択file/Teeda hidden/保存submitの契約だけ確認。未保存で一覧へ戻った。
- 5項目だけのpatch、最新状態保持、整数円、店舗別候補、hidden/URL action混入、外側form所有者を検証。独立レビュー3件を修正して回帰追加。
- 公開読込/レビューActionと準備用モーダルをサーバーフラグOFFで追加。毎回manager認可と店舗別DB商品→POS再取得。台帳・DB・POSへ書き込まない。
- 34新規テスト成功。全回帰243/246、残る3件は従来と同じ。型・対象Lint・本番build成功。全体Lintは既存3 errors / 5 warnings。SQL変更なし。
- 合成データのPC/390pxスマホ表示、正常差分、入力保持、破棄キャンセル、通信失敗、競合、最新基準の明示採用を実ブラウザで確認。実サービス非接続のfixture harnessを使用。
- 次の承認対象: GAS HEADのform更新/submission追加/診断更新だけ（3ファイル）と、固定本店商品の読取り・送信データ組立診断。商品POST/DB/公開版/既存同期/Git/Vercelは対象外。
- 残件: 画像等の保存後保持、実保存/結果再取得、公開署名inspect接続、旧CSV writer切替/重複JAN解消、通常PostgreSQL2接続競合、追加/JAN訂正/削除。

## 承認済み反映と実診断

- ユーザー「２つともそれで続けて」で対象3ファイルと固定本店診断を承認。16:57:32にHEAD反映。既存3ソースはハッシュ不変、対象3ソースはfresh cloneでローカルと一致、公開版HEAD/11/12/56不変。
- 退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-submission-backup-20261003-b12f4858c3dc4dc5b2bdaca6ac0017e9`（一時ソース退避、認証値は含めていない）。
- 16:58:57〜16:59:19、組立診断1回完了。本店7/JAN4902397868767、両検索一致、組立2回、成功control96、空file1、更新submit1、multipart、商品保存送信なし。関連42/42・構文検査成功。
- `hasFrameworkState=false`（te-conditions未収録）。通常ブラウザの同一未変更フォームでは対象formの同名enabled hiddenとview-state hiddenが各1件存在。値は読まず、保存せず一覧へ戻った。原因/必要性未確定の保存前条件として記録し、実保存可能とは扱わない。新しいPOS/GASコード修正・再診断はしていない。
- 診断画面: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-submission-diagnostic-20261003.jpg`。

## 状態項目件数の再診断

- ユーザー「お願い」で診断1ファイルの件数追加/HEAD反映/本店再診断を承認。対象外の別formの曖昧な属性・復号不能名では停止せず、固定2項目の数値だけ返す。追加5テストと独立レビューの再現ケースを検証。関連47/47、全回帰248/251（同じ既存3失敗）、構文・差分検査成功。Next/SQL未変更。
- 17:17:53に診断1ファイルだけ更新。SHA-256 `0130E43B04D0A26A528B4B0109447F4192EA89096B58C217CD55D5F95E604546`。fresh cloneで全6ソース一致、他5ソースと公開版HEAD/11/12/56不変。
- 退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-state-counts-backup-20261003-f0e9fc626bb947e1a0defa9b8a4e7d78`（一時ソース退避、認証値を取得・コピーしていない）。
- 17:19:27〜17:19:50、診断1回完了。本店7/JAN4902397868767・両検索一致・組立2回・商品保存送信なし。te-conditionsは実HTML/対象form/enabled hidden/組立entry/inline script参照すべて0、別view-stateは各1（inline script参照のみ0）。欠落は実HTML input段階。ブラウザとの差異の生成元・保存時の必要性は未確定で、実保存前gateは継続。
- 商品保存/DB更新/公開版変更/Git push/Vercel反映はしていない。
- 再診断画面: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-state-counts-20261003.jpg`。

## 生成scriptの切り分けとローカル対応

- 上のinline script参照0は、script内の旧式`<!-- ... //-->`を診断が除去していたため無効な観測と訂正。実input/組立entry0は引き続き有効。カウンターだけを修正し、17:39:04に診断1ファイルをHEAD更新。fresh cloneで他5ソース/公開版HEAD/11/12/56不変を確認。
- 17:40:06〜17:42:30の1回診断: 本店7/JAN4902397868767、両検索一致・組立2回・商品保存なし。生成script参照1、te-conditions実input/組立entry0、既知view-state実input/組立entry各1。
- ブラウザでは既知2フォームへ非表示spanを追加し、そのinnerHTMLから状態項目を作る定型文法を確認（状態値の取得/表示なし）。保存せず一覧へ戻った。
- ローカルform parserはこの定型文法だけを静的解析し、GAS内部の送信準備へ状態を保持する。JS実行・任意コード解釈なし。余分な命令/式・外部script・重複状態・別フォーム・未知属性/項目等を拒否。DTO/ログ非公開を合成10通信のowner診断で検証。状態欠落も省略して通さない。
- 独立レビューのform欠落/同ID別要素ケースを修正。固定参照先が先に成立した一意な正しいformであることを確認し、重複/欠落/後置/入れ子/未閉鎖等を拒否。
- 関連57/57、全回帰258/261（同じ既存3失敗）、GAS構文/差分検査成功。Next/SQL未変更、型/対象Lint/build/SQLは前回結果を継承。
- 次の別承認対象はform更新1ファイルのHEAD反映と本店の保存なし再診断だけ。実商品保存・DB・公開版・Git/Vercelは対象外。
- 診断SHA-256 `B0CB493B7756FADC086156A4203D26307C2DF90C0DA4C4A11F752B346372E74F`、未反映form SHA-256 `F4C11C2BBA04C866A7272607334EB0DF2DE694C03606166D42A5C8B8290055F5`。
- 退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-state-script-backup-20261003-a374c97f7f2742c5834eda4709d124ef`（一時ソース退避、資格情報なし）。証跡: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-state-script-diagnostic-20261003.jpg`。

## form単独HEAD反映と安全停止、実画面属性への限定修正

- ユーザー「はい、お願い」でform1ファイルと保存なし診断を承認。最新6ソースの退避・他5ファイルの同一性確認後、18:10:50にHEADへ反映。再取得で6ソース一致、公開版HEAD/11/12/56不変。現行form SHA-256 `F4C11C2BBA04C866A7272607334EB0DF2DE694C03606166D42A5C8B8290055F5`。
- 18:12:00〜18:12:15の1回診断は、最初の編集フォームで店舗/JAN照合後に `POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE` で停止。両検索/組立2回/状態保持成功とは扱わない。商品保存/DB変更・自動再実行なし。
- 実ブラウザの定型scriptは `language="JavaScript" type="text/javascript"`。現行parserがlanguageを拒否する不一致をテストで再現したが、GAS生HTMLの正確な拒否分岐は未確定。固定フォームの成立/順序も読取り確認し、商品名/価格126/原価75を変えず一覧へ戻った。状態値取得/表示なし。
- ローカルだけ、確認済みlanguage値を限定許可し、別言語/src/module/未知属性を引き続き拒否。検査工程名を固定コードへ追加、例外原文/受信値は公開しない。関連59/59、全回帰260/263（同じ既存3失敗）、GAS構文/差分空白検査成功。Next/SQL未変更で型/対象Lint/build/SQLは前回結果を継承。
- 未反映form SHA-256 `35B9BC7E129BF607DD6E2F65980FD37F9959FAAC2F3DF32B30AA3D4E94959770`、現行HEADから14追加/3削除。次はこの1ファイルのHEAD反映と同じ本店の保存なし診断を別承認。商品保存/DB/公開版/Git/Vercelは含めない。
- 独立レビュー追加指摘なし。現行HEADの他3GAS＋新formだけのlanguage付き合成owner診断1/1成功（状態保持、通信10回、保存/秘密ログなし）。外部通信/実再診断ではない。
- 退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-generated-form-backup-20261003-879937a467e74960ae681c75a9330911`（一時ソース退避、資格情報なし）。証跡: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-generated-form-stop-20261003.jpg`。

## 承認済みlanguage属性修正の単独反映、実診断成功

- ユーザー「お願い」でform1ファイルのHEAD反映・本店の保存なし再診断を承認。最新ソース退避・独立セット監査（差分14追加/3削除、他5ソース/manifest不変）後、22:04:06にHEAD反映。再取得で全6ソース一致、公開デプロイHEAD/11/12/56不変。form SHA-256 `35B9BC7E129BF607DD6E2F65980FD37F9959FAAC2F3DF32B30AA3D4E94959770`。
- 22:06:15〜22:06:37、所有者診断1回成功。本店7/JAN4902397868767、両検索完了・同一業務値、組立2回、multipart、成功control97、空file1、更新submit1、状態保持true、商品保存送信false。
- te-conditionsは実input0/script参照1/組立entry1、既知view-stateは実input/組立entry各1。hidden値・本文・Cookieは出力なし。以前の96コントロールから不足状態1項目を加えた97を確認した。
- GAS構文/差分検査成功、直前の関連59/59・全回帰260/263（同じ既存3失敗）を検証済みhashのまま継承。今回Next/SQL変更なし、型/対象Lint/build/SQLは以前の結果で再実行していない。
- 商品保存/DB/在庫/既存同期/公開版/Git/Vercel変更なし。実保存/保存後の画像保持/公開機能有効化等は未完了。今回の承認対象は完了したが、商品編集の本番利用可能とは扱わない。
- 退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-language-backup-20261003-128a2635f0a84f5eb29b701efbe0bfff`（一時ソース退避、資格情報なし）。成功証跡: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-generated-state-success-20261003.jpg`。

# POS商品操作台帳: 適用前確認・復旧手順（未適用）

対象ブランチ: `codex/pos-product-management`。本番DB、GAS、Git、Vercelの反映はこの資料を作っただけでは承認されない。

## 今回の差分

- `20260908120000_pos_product_operation_ledger.sql`: 新規3テーブル（操作、対象予約、イベント監査）、索引、制約、6トリガー、RLS/権限。
- `20260908121000_pos_product_operation_functions.sql`: service_role専用の受付・claim・結果記録RPCとprivate検証helper。
- `20260910090000_product_master_sync_fence.sql`: 店舗版と同期受付の2テーブル、開始/一括適用RPC、products変更・POS操作受付時の版更新trigger。
- `20260910120000_pos_product_edit_apply.sql`: 通常編集の固定基準値/反映記録/POSリンク、専用受付・反映RPC、POS内部IDの全店舗共通予約、完了遷移の制約。商品反映はPOS確認後のRPC実行時だけ。
- `20261004120000_pos_product_edit_dispatch.sql`: 通常編集の固定送信記録/一度だけの消費記録、登録/消費/復旧読取りRPC。業務値だけを保持し、商品・在庫の値や操作状態は変更しない。
- 元の5本は既存products、棚卸し、在庫、店舗権限の行や既存RLS/GRANTを変更しない。ただしproductsへの以後の書込みには版更新triggerが加わる。追加4本は下記の範囲で商品書込み権限・同期/取消経路を変更するため、全writerの切替順序を確認する。
- `20261005120000_pos_product_operation_cancellation.sql`: 未送信の通常編集だけを本人managerが監査付きで取消し、同じ操作IDの遅延受付も拒否する。送信済み・結果不明は取消しない。
- `20261005121000_product_master_sync_notifications.sql`: 店舗別の同期拒否/結果不明を永続化し、店舗memberが商品画面で確認する。匿名/直接書込みは拒否。
- `20261005122000_product_master_write_cutover.sql`: productsへの匿名・通常利用者・serviceの直接書込みと列GRANTを失効。認証済み店舗memberのSELECT、認可済みSECURITY DEFINERの編集/同期/棚卸し停止RPCを維持。CSV欠落JANの自動停止を無効にし、migration自体は商品値を変えない。
- `20261005123000_product_master_sync_gateway.sql`: 署名request UUIDに一度だけのCSV開始権を束縛し、旧service開始RPCを閉じる。新規開始/状態読取りは専用RPCだけ。
- 商品IDは監査用snapshotとして保存する。操作受付時とclaim時に、商品ID・store_id・JANを照合する。将来の商品削除で監査を消さない。
- SQL受付はcreate/update限定。通常編集のDB反映RPCはローカル実装済み。create完了/JAN訂正/削除は未実装。通常編集のAction/UI・GAS送信入口は2026-10-05にローカル接続済みだが、本番には未反映。

## 本番適用前の確認

1. Supabaseの対象projectを照合し、読み取り専用 `supabase/preflight_pos_product_operation_ledger.sql` の結果を確認する。店舗6/7、既存権限helper、列型、ロールが期待どおりであること。
2. 対象の9 migrationと本番適用履歴を比較する。既存オブジェクトがある場合、CREATEや置換を繰り返さず定義差分を確認する。別featureの未適用migrationを混ぜない。4本目は未解決の通常編集操作があると適用を拒否する。旧受付からの操作を自動移行/取消しせず、POSの結果を確認してから解決する。
3. 既存スキーマ/GRANT、productsと棚卸し関連、user_store_accessを含む論理バックアップを取得し、件数・復元手順を確認する。資格情報・バックアップ本文はGitへ追加しない。以前のバックアップが現在の状態を含むとは仮定しない。
4. 通常PostgreSQL/Supabaseの独立した2接続で、同一操作IDの同時受付、同一JANの別操作、同時claim/consume、権限剥奪・期限切れ・登録/消費と対象行ロック待機との競合を検証する。期待値は受付1件、claim trueとconsume accepted trueは各1回、別店舗は独立、監査と予約の整合。
5. 正確な差分・対象・バックアップ・復旧方針を示して、本番適用承認を得る。
6. 承認された未適用の対象migrationだけを一つのtransactionとして適用する。エラー時はtransaction全体をrollbackし、部分適用しない。SQL Editorから適用する場合も明示的なBEGIN/COMMITで囲む。
7. 新規RLS/EXECUTE/テーブル権限を確認する。anonは参照/実行不可、authenticatedは自分かつ現在managerの店舗の操作と監査だけ参照可能、service_roleは限定RPCのみ実行可能で新規テーブル直接書込み不可。

## 有効化は別工程

`ledger.server.ts` はサーバー専用で、呼出しごとに既存のgetUser＋user_store_access manager判定を使う。SQLでも同じ依頼者・店舗を再確認する。

- `POS_PRODUCT_WRITES_ENABLED` は未設定なら拒否する。今回、本番には設定していない。
- `POS_PRODUCT_DISPATCH_ENABLED` も未設定なら固定送信記録を登録しない。ON時のprivate準備経路は既存記録を先に取得し、再受付で本文/期限/照合基準を更新しない。今回はローカル実装のみで、本番には設定していない。
- 2026-10-04の保存通信もローカル実装のみ。Next側 `POS_PRODUCT_EDIT_GATEWAY_ENABLED` / `POS_PRODUCT_EDIT_GAS_URL` / `POS_PRODUCT_SIGNING_SECRET`、GAS側 `POS_PRODUCT_EDIT_GATEWAY_ENABLED` / `POS_PRODUCT_EDIT_EXECUTION_ENABLED` が必要。専用consumeは双方の `POS_PRODUCT_CONSUME_ENABLED` / `POS_PRODUCT_CONSUME_SECRET` とGASの `POS_PRODUCT_CONSUME_URL` が必要。消費鍵は署名inspect/dispatch鍵と設定名・用途を分離し、値は専用のランダム鍵にする。今回は鍵/URL/フラグを本番へ登録していない。
- 2026-10-03の署名inspect通信はローカル実装のみ。Next.jsの `POS_PRODUCT_INSPECTION_ENABLED` / `POS_PRODUCT_INSPECTION_GAS_URL` / `POS_PRODUCT_SIGNING_SECRET` とGASの専用フラグ/同じ専用鍵が必要。いずれも今回登録していない。GASの `handlePosProductInspection_` は2026-10-05にローカルdoPostへ接続したが、現行v56 URLへ送っても新inspectは動作しない。公開入口の差分・対象を確認して承認後にデプロイし、読取り試験をしてから使用する。
- `SUPABASE_SERVICE_ROLE_KEY` は新規RPC用にサーバー内でのみ使用する。anon keyへのfallback、ブラウザ配布、ログ出力はしない。
- これらの設定だけでは商品編集/追加は完成しない。POSフォーム契約、商品link、同一transaction内のDB反映、既存CSV同期との競合制御、実保存検証が揃うまで有効化しない。
- 保存用prepare/save/recover Server Actionはローカル追加済み。読込/レビューActionとは分け、保存用review（POS候補・内部ID・期待結果hash）をブラウザから信用せず、サーバーで取得/検証する。新規送信には6フラグ、既存操作の照合/DB反映には書込み用3フラグ、読取り復旧には送信許可不要。各Actionの店舗manager認可は維持する。

### 専用設定の登録先（値はチャット/ソース/ログへ出さない）

| 設定 | 登録先 | 注意 |
|---|---|---|
| 対象projectの `SUPABASE_SERVICE_ROLE_KEY` | Vercelサーバー環境変数とGAS Script Properties | ブラウザ用NEXT_PUBLICには登録しない。anonへのfallbackはしない |
| `POS_PRODUCT_SIGNING_SECRET` | VercelとGAS | inspect/編集の両側を一致させる専用鍵 |
| `POS_PRODUCT_CONSUME_SECRET` | VercelとGAS | 消費確認専用。上の署名鍵とは別の値 |
| `POS_PRODUCT_MASTER_SYNC_SECRET` | VercelとGAS | 商品同期専用。編集署名鍵とは別の値 |
| `POS_PRODUCT_*_GAS_URL` / `POS_PRODUCT_CONSUME_URL` | 前者はVercel、後者はGAS | 確認した新GAS公開URLと対応するPreview/Productionのconsume URLだけ |
| `POS_PRODUCT_SYNC_STORE_6_*` / `POS_PRODUCT_SYNC_STORE_7_*` | GAS | BASE_URL / LOGIN_ID / PASSWORD / COMPANY_CD / COMPANY_KEY / TENPO_GROUP_ID / TENPO_GROUP_NAMEを店舗ごとに固定。COMPANY_KEYは空でも明示設定。実画面で確認した値だけを使う |

初期登録では書込み/実行/同期フラグをfalseのままにする。GASの公開gatewayフラグ、同期のMASTER/FENCE、Next側の各フラグを一括でONにせず、DB適用・署名読取り・実CSVの検証後に段階有効化する。新規資格情報の設定画面への入力は本人に引き継ぎ、パスワード/キー値をチャットへ送ってもらわない。

## 一度だけの保存開始と中断後の照合（ローカル実装済み）

- `registerProductEditDispatch` / `register_pos_product_edit_dispatch` はprepared・未送信の操作だけで、新規本文と変更前/期待結果の業務指紋を固定する。操作hashとdispatchHashは別物。本人manager、店舗6/7、POS内部ID、JAN/商品/POSの3予約、現在のDB商品と固定intentを照合し、登録直前にも期限を検査する。
- 記録は更新/削除/期限延長不可。完全一致する同じ登録だけ既存値を返す。登録commit後の応答消失・prepared再受付では `loadProductEditDispatchRecovery` の再認可付きprivate読取りで元の本文/期限/reviewを取得する。復旧情報は公開状態DTOへ含めない。
- `consume_pos_product_edit_dispatch` はdispatching/send_attempts=1・同じhash・有効期限・本人manager・3予約/現在商品を確認し、対象行ロック待機後も期限を検査する。一度だけ消費行を挿入してaccepted=true、再呼出しは期限後もfalse。同じtrue応答を再掲しない。操作状態/商品/在庫は変更しない。
- この消費はNode側claimと別のGAS側保存開始権。署名付き保存受付/consume HTTP/Node→GAS通信と、manager保存Action・claim/結果記録/DB反映の実行制御・復旧UI・GAS公開doPostはローカル接続済み。公開doPostは専用設定OFFでは拒否し、署名付きinspect/dispatchだけを別経路へ渡す。本番反映は未実施。accepted=false/通信失敗では保存せず、自動再送しない。
- 新しい `/api/pos-products/consume` はGAS専用POSTで、通常のCookieログインをこの完全一致POSTだけ除外する。他のAPI/画面の認証は維持する。既定OFFでは503/no-storeの固定応答、ONでもWRITES/DISPATCH/CONSUMEの3フラグ・専用audience/30秒署名・DB店舗manager再認可が必須。GASの転送先は固定本番URLだけで、要求1回・応答も要求署名に束縛する。署名本文やservice_role鍵をブラウザへ渡さない。
- HTTP/RPC待機中の停止・鍵更新・期限切れも再検査し、消費commit済みでも有効な応答を返せない場合は結果照合へ進む。trueを返すためにRPCを再試行しない。`dispatch-transport.server.ts` も保存済み本文/hash/期限/業務値を再検証し、外側期限を保存済み期限へ束縛した一回のPOSTだけを行う。GAS結果転送は既知Googleホストへの本文なしGETのみ。観測値一致は実保存commitの証明ではない。
- 送信記録と消費行はFORCE RLS、anon/authenticated/service_roleから直接アクセス不可。service_roleは本人/店舗を再検査する限定RPCのみ実行可能。HTML/Cookie/セッション/フォームhiddenはDBへ保存しない。
- 期限後の復旧読取りは送信許可ではなく、固定期待値と最新POSの照合用。保存済み画像バイナリやprivate画像名の再起動越し保持はこのDB記録で保証していない。実保存/画像保持と外部POS同時編集の検証は別途必要。

## 通常編集のDB反映（ローカル実装済み）

- `prepareProductEditOperation` は認証後に取得したPOS snapshot・店舗別候補ID・名称カタログを専用受付へ渡す。DBの比較基準を同transactionで固定し、再受付では基準を取り直さない。旧汎用受付だけで作った通常編集はclaimを拒否する。名称カタログをブラウザ入力から信用してはいけない。
- `applyProductEditToDatabase` / `apply_pos_product_edit` は本人の対象店舗manager権限、操作版、POS確認指紋、商品ID/store/JAN、受付時のDB値、予約を再検証する。商品名・分類/グループ・価格/原価・仕入先・粗利率を反映し、POSリンク・旧名称別名・反映記録・完了監査・予約解放を一transactionで処理する。
- ブランド、手動停止、棚卸し数量・計数時刻・snapshotは変更しない。旧DB名と旧POS名の別名を残すが、他商品/停止済み別名の付け替えや再有効化は拒否する。変更後の名前が他商品の別名に当たる場合も拒否する。
- 同じPOS内部IDは別店舗でも同時予約不可。リンクの対応付け先を勝手に変更しない。POS会社は現行の一社に限定し、会社設定変更時は既存リンクを流用せず別移行が必要。
- DB競合・別名競合ではPOSを再送しない。DBエラー応答や通信断では、まず同じ操作IDの状態を確認する（commit済みで応答だけ消えた可能性がある）。未完了ならDBだけを再試行、完了なら既存結果を返し、商品値を再上書きしない。
- 実POS再読取りアダプター/UI、送信前取消/照合可能な破損storage救済のローカル接続と通常PostgreSQLの独立接続競合試験は実施済み。元IDを証明できない破損は凍結を維持する。実保存後の画像保持、create/JAN訂正/削除、本番の旧writer遮断は未完了。既存writerの遮断条件は下記のまま必須。

## CSV同期の段階切替（本番未実施）

- GASの `POS_PRODUCT_SYNC_FENCE_ENABLED` は未設定/OFFなら従来経路。ON時は専用 `SUPABASE_SERVICE_ROLE_KEY` と新規RPCが必須。匿名キーへのfallbackは無い。新規 `gas/posProductSync.js` を含む一式が必要。
- POSへアクセスする前に店舗6/7の版を取得し、10分以内・版不変・未解決商品操作なしの場合だけ一括transactionで適用する。CSV全件取得を証明できないため、追加22000で未取得JANの自動停止を無効にする。応答不明は自動再送せず同じrunの状態を確認し、安全に未適用が確定した後に限り新しい受付/CSV取得へ進む。適用済みなら再送しない。
- 新経路の受付後にフラグがOFFになっても、そのCSVは旧writerへ渡さない。店舗未指定呼出し、外部CSVの直接取込み等も受付なしでは拒否する。定期実行・手動実行・Next.js経路をすべて明示店舗付きに揃える。
- **元の5 migrationだけでは旧直接writerは禁止されない。** 追加22000はproductsへの直接書込みをDBで失効し、23000は旧service開始RPCを失効する。POS編集公開前に全writer・実行中ジョブを棚卸しし、旧経路停止→実行終了→新9本の適用→GAS/アプリの署名経路切替の順を確認する。同期フラグをOFFにして旧writerを復活させるrollbackは行わない。資格情報そのものの失効や旧デプロイ削除は別途対象確認する。
- GASのdryRunは引き続きDB/Driveへの保存をしない。9/10の本店読取り診断は3,835行、JANあり3,823行、JAN種類3,793で重複30行分・JAN空12行を確認。商品区分列は1/2で、内部商品IDではない。新版の `syncSafety` 診断は同一行/内容違い/区分違いの重複件数・金額不明件数を返すが、**まだデプロイも実データ実行もしていない**。原因確認前に重複拒否を緩めたり同期フラグをONにしない。
- 新経路は全行のPOS店舗コード・店舗名を照合し、重複JAN・欠落商品名・不正金額を全件拒否する。JANなし行は既存どおり対象外。会計時入力や技術商品を含むCSVの適用可否・取込み範囲は実データで確定する。POS商品保存用の内部ID一意性とは別の確認である。
- 通常PostgreSQLの2接続で同期同士・同期対編集・同期対旧writerを試験する。products→版の通常writerと版→productsの同期はロック順が違うため、デッドロック時の全件rollbackと安全な復旧を検証する。PGliteの直列試験や関数内timeout設定だけでは実サーバーの待機時間を保証しない。ロール/接続のタイムアウトも検証する。
- POS編集を有効化した後の復旧はまず商品編集・同期の入口/ジョブを止める。**同期フラグをOFFにするだけでは旧writerが復活するので安全なrollbackではない。** run/操作/監査を削除せず、期限切れ受付の保守方針も別途定める。

## 失敗時の復旧

- **migration未commit**: transactionをrollbackし、エラーと定義を調べる。
- **commit後にアプリ側の不具合**: 公開の保存経路を停止し、フラグを無効化する。新規テーブルや履歴は残す。DROP/TRUNCATE、操作IDの作り直し、自動再送をしない。
- **prepared**: 本人managerが未送信を確定した通常編集だけ、新しい取消Action/UIから監査付きで取消可能（ローカル実装）。期限切れ/基準値競合でも自動送信しない。未作成IDは単なるnotfoundで解除せず、取消墓標をDBへ確定して遅延受付を拒否する。記録が破損して元IDを証明できない場合は入力凍結を維持する。
- **dispatching/uncertain**: 送信有無が不明な場合を含む。POSを読み直して対象・値を照合する。予約を自動解放せず、別操作IDで再登録しない。
- **pos_confirmed/db_pending**: POSへは再送しない。通常編集は専用DB反映RPCだけを復旧する。手動でcompletedを偽装しない。createにはまだ完了RPCがない。

操作とイベント監査のDELETE/TRUNCATE、イベントのUPDATEはDBトリガーでも拒否する。既存の履歴を消すrollback SQLは用意していない。物理的な撤去が必要な場合は、対象と退避先を改めて確認・承認する。

## ローカル検証の範囲

`tests/pos-products-db` にアプリ依存と分離した `@electric-sql/pglite@0.5.8` を固定。`npm ci --ignore-scripts --no-audit --no-fund` 後に `npm test`。
メモリ内PostgreSQLへ既存のinventory Phase 1と手動停止保持triggerを適用し、fixture別に必要なmigrationを使用する。cutover fixtureは新9本をすべて組み合わせ、RLS/テーブル・列GRANT・認可済みRPC・状態遷移・監査・全件rollback・取消/復旧・署名同期・通知を検証する。外部DBのURLやキーは使用しない。最新84件成功。両店舗で実TS builder→SQL登録/claim/consume/読取り→TS復旧に加え、実HTTP handler→実SQL consume→署名応答→実GAS consumerの初回true/再消費falseまで検証。4,000商品同期・棚卸し入力済み12個の数量/時刻/snapshot保持も含む。通常PG17.11の別backendによる競合試験は取消/復旧/同期受付を加え21件成功、専用clusterは停止済み。

[PGliteの公式資料](https://pglite.dev/docs/)では単一の排他的接続で動作するため、このテスト成功だけで複数worker間の同時実行を実証したとはしない。

通常PostgreSQL用の `concurrency.integration.mjs` を分離し、`run-concurrency.ps1 -PostgresBin <公式PostgreSQLのbin絶対パス>` で専用loopback clusterを毎回作成する。既存DB/汎用PG環境変数へのfallbackはなく、data_directory・test専用user/control DBを照合する。A/B/observerの別backend PIDと `pg_blocking_pids` による実ロック待機を確認し、同時prepare/claim/consume、権限剥奪/期限切れ、同期対編集/旧writer、deadlock時の全件rollbackを検査。生成UUID DBはnonce/owner/接続数照合後だけ削除し、専用clusterは停止してログを保持する。本番Supabaseへの接続やテスト行作成は行わない。実POS保存と本番writer停止・切替は引き続き別工程。

2026-10-05に本番列型（商品名text、金額/原価integer、粗利率real）へ4 fixtureを合わせ、型一致と金額のnumber比較を追加。PGlite49/49、通常PostgreSQL17.11の13/13成功。合成clusterは停止済み。元のnumeric fixtureだけの成功と区別し、これを最新結果とする。

## 2026-10-05 本番の読み取り監査と追加切替の続行承認

- project `wpxewebmezghoulnasre` / kennel_DB、PostgreSQL 17.6。19 migration適用済み、新規5本は未適用。店舗6/7・既存認可helper・複合キー・手動停止保持triggerを確認。商品金額/原価はinteger、粗利率はreal。
- productsはRLS ON/FORCE OFF、`Allow all access to products` がpublic/ALL/USING true/WITH CHECK true。anon/authenticatedに直接書込み権限がある。新規5 migrationは既存RLS/GRANTを変えないため、これだけの適用では旧商品同期による上書きを止められない。
- 旧GAS/Next.jsの直接商品writer停止、店舗固定・版管理付きRPC、商品直接書込み権限制限、利用者向け同期拒否通知について、ユーザー「いいですね、…問題ないなら続けて」で続行承認。ローカル実装と検証を進めている。移行中の商品同期は一時停止し、売上/入出庫/棚卸しを維持する。新しい9本の定義・切替順・退避を確認してから適用する。現時点で本番RLS/GRANTや本番データは変更していない。
- 10/5監査時点では最新の論理backupは未取得。GAS HEADは既存6ソース、公開Web App v56、Vercel Productionはmain `ac06232`。署名/consume鍵・新機能設定は未登録。Git CLI認証も更新が必要だった。

## 2026-10-06 論理退避と復元確認（本番変更なし）

- 対象projectを固定した `backup_pos_product_cutover.sql` と `tests/backup_pos_product_cutover.mjs` で、READ ONLY/REPEATABLE READの単一snapshotを取得。17テーブルの商品/別名/店舗/権限/移動/棚卸し/在庫データ、公開/privateの関数・列・制約・索引・trigger・RLS・ACL・sequence状態と19 migration履歴をGit対象外へ保存した。Authユーザー/資格情報、売上行/履歴キャッシュは今回のデータ退避対象外。
- `local_exports/pos-product-cutover-2026-10-05T17-49-01-408Z-46f3601f-f232-4457-b05e-2f26d0d3638b.json`（10/6 02:49 JST、10,488,816 bytes）。SHA-256: `6f52fd19cf3553485c5d07b5822a07909006d61dcc295b2ccc372d6356ffa957`。商品6,568、棚卸し明細6,544、移動505、店舗権限6行。本文はGit/ログへ出さない。
- `tests/pos-products-db/backup-restore.mjs <backup絶対パス>` でchecksum、17テーブルの型・NOT NULL・主キー、復元後の全行全列一致を確認済み。保存された関数/trigger/権限DDLは実行しない。これは完全なDB/外部FK/Auth/RLS復元試験やPITR backupではない。実復元では入口停止・対象/差分確認・個別承認が必須で、旧writerの権限を一括で戻さない。
- 署名/同期/取消/通知のDB84件、通常PG独立接続の競合21件は成功。型・対象Lint・26ページ本番buildも成功。通常回帰は419/422で、変更前からの棚卸し静的検査2件・Sentry/CMS検査1件が残る。全体Lintも既存3 errors/5 warningsが残り、完全greenとは扱わない。
- 指定商品4779/本店7/JAN4582107173062は、退避snapshotでも旧名/199円/95円/有効のまま。データ削除、本番migration/GAS反映、Git push、Vercel反映、実商品の保存は未実施。
- その後Git CLIを再認証し、アカウントsemotomoと対象semotomo/Antigravityのpush/admin権限、main ac06232を確認。GAS現行6ソースを再取得し、現行manifest保持の12ファイル候補をlocal_exportsに用意した（公開反映は未実施）。Vercelの変数名一覧はCRON_SECRET/GAS_WEBAPP_URL/公開Supabase2キーだけで、新service/署名/機能設定は未登録。キー値は取得/表示していない。
- 続行で専用ブランチだけe30300dをpushし、Vercel Preview CDEC56xnGqXanr5bxLDthXcFPaSJのReadyを確認。本番ブランチ/Productionは未反映であり、専用設定未登録のまま実保存や新同期が使えるとは扱わない。

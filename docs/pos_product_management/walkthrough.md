# 商品POS連動: P0調査・P1安全基盤のローカル実装

日付: 2026-09-10 JST

## 現在地

商品機能全体は実装途中。入力・店舗照合・JAN訂正/削除のガード、署名検証、保存状態の遷移規則に加え、DB操作台帳・監査・一度だけのclaim・店舗manager再認可・server-only DALをローカル実装した。P2aの編集差分・競合指紋・保存後照合も台帳へ接続した。
9/10にCSV同期の版管理・全件反映と、通常編集のPOS確認後DB反映transactionをローカル実装した。公開API/Server Action、POS保存アダプター、編集/追加UIは未接続。画面に完成済み機能として公開せず、本番への変更も行っていない。

専用worktree `pos-product-management`、branch `codex/pos-product-management`、基点 `ac0623292836f609570084234fe1cb137bd8f0fd`。
元ルートの `next_app/scratch/test_gas.mjs` と別worktreeの `next_app/lib/actions/petsSync.ts` は変更・混入していない。
調査ツールのローカルcache/補助設定（再生成された `.serena/project.yml` を含む）は `.serena/.gitignore` で成果物から除外している。既存ユーザーデータは削除していない。

## POS実画面で確認した契約

ログインURLはユーザー指定。ログインと店舗変更確認ダイアログのOKはユーザーが実施した。

| 対象 | 確認内容 |
|---|---|
| 通常一覧 | `/hm-hmma/view/hmma/hmma024/hmma02400.html`、form `hmma02400Form` |
| 検索 | `schOfficeCd`（店舗名）、`schTenpoGroupNoSingle`（所属）、`schGoodsId`（商品コード）、`schMakerCd`（メーカー品番）、submit `doSerchNormal` |
| 本店 | 店舗11053、所属11098（アプリstore_id=7） |
| わんわん | 店舗11054、所属11099（アプリstore_id=6） |
| 全店 | 所属11097。書込み対象から除外する |
| 商品詳細 | 一覧の `goodsItems:{row}:doHmma02402` → `hmma02402.html` |
| 商品編集 | 詳細の `doHmma02403` → `hmma02403.html`、form `hmma02403Form` |
| 商品追加 | 一覧の `doHmma02401` → `hmma02401.html`、form `hmma02401Form` |
| 店販 | `genreShopName` / `goodsSalesKbnOnClick('2')` |
| 名前・JAN | `goodsName`、`gdsPublicGoodsCd`、`gdsManufacturerPartNumber` |
| 所属・グループ | `tenpoGroup`、`goodsGroup`。変更後にAjaxで選択肢が更新される |
| 価格 | `gdsGoodsPriceFlg` 0=一括 / 1=店舗別、`gddPriceInputFlg` false=固定 / true=会計時入力、`gddGoodsPrice`、`gddGoodsCost` |
| 仕入先 | `gdsSupplierFlg`、`gddSupplierCd`。候補はPOS取得値を使い固定辞書にしない |
| 税 | `goodsTax`。初期版で勝手に変更しない |
| 編集保存 | 表示リンク `beforUpdateDisabledCtrl()`、submit `doUpdate`、確認関数 `saveConfirm()`。クリックしていない |
| 追加保存 | submit `doInsert`、確認関数 `insertConfirm()`。クリックしていない |
| 削除 | 一覧の選択チェックと `doDelete`。画面に復元不可の警告あり。実削除していない |

各field名は `includeChildBody:{formId}:` のprefix付き。複数formや多数のhidden状態があるため、既存の緩い正規表現で任意のformを選んだり、値を推測して送信しない。
Cookie、hidden状態の値、資格情報はfixture/本書へ収録していない。商品内部IDの安全な抽出と保存フォームの完全な契約は未確定。

わんわんのサンプルをメーカー品番で検索し、同店所属・店販・JAN一致を確認。商品コードは空欄だったため、通常編集で両欄を自動変更しない。既存フリガナも保持対象。
本店は店舗名・所属の両方で絞り、同じJANを商品コードのみ・メーカー品番のみで別々に検索し、それぞれ同じ1商品を確認。編集画面で本店・店販・両コード一致、既存原価・フリガナ・一括価格を確認して未保存で離脱した。
追加フォームは店販を先に選び、所属変更の確認後にAjax完了を待つと、本店9件・わんわん13件の店舗別グループ候補に更新された。候補IDを業務辞書へ固定しない。
所属変更時のPOS側JSに、存在しない `totalTimeFlg0` のchecked設定エラーを確認した。候補更新Ajaxはエラーより前に開始されるため、エラーの有無だけで完了判定せず最終の所属・区分・候補・価格方式を検証する。ベンダーJSは改変していない。
原価499.5の入力後、フォーカス離脱で499になることを未保存フォームで確認。ユーザーが2026-09-09に切り捨てを承認し、自動原価は半額の1円未満切り捨てに変更した（999円→499円）。手入力・既存原価は保持する。確認用フォームの「商品一覧へ戻る」を押すと、セッション期限切れのログイン画面へ遷移した。商品保存は一切行っていない。
安定した内部商品ID、保存フォームの完全な契約、API/利用条件、保存後再読取は未確認。

同日の追加調査: ユーザーの再ログイン後、本店の商品をメーカー品番で検索して1件に絞り、詳細・編集フォームを読取り確認した。`goodsId-30`、`excludeGoodsId`、DTO用hiddenは取得可能なDOMでは空欄で、安定した内部IDを確定できなかった。行番号・JANを内部IDとして代用しない。商品を保存・変更せず一覧へ戻り、確認用タブを維持した。ユーザーは以後の保存済み情報を使ったログインボタン操作を承認した。

## ローカル実装

| ファイル | 内容 |
|---|---|
| `next_app/lib/pos-products/types.ts` | create/update/change_jan/deleteの型、店舗・候補・参照調査型 |
| `validation.ts` | 厳格な許可項目、店舗/JAN/金額/理由/明示確認、原価50%の自動/手動切替 |
| `identity.ts` | 店舗とPOS所属の一致、商品コード/メーカー品番両検索の完全性、内部IDの一意性、訂正/削除の参照拒否 |
| `protocol.ts` | HMAC-SHA256、利用者/店舗/操作/用途/内容hashの束縛、最大120秒有効、UTF-8本文サイズ制限 |
| `gas/posProductProtocol.js` | 同じ署名のGAS側検証。末尾underscoreのprivate関数のみ。既存doPost/GETに未接続 |
| `operations.ts` | prepared→dispatching→verifying→pos_confirmed→completedと、uncertain/db_pending/rejectedの遷移規則 |
| `ledger.server.ts` | 既存認証で本人と店舗managerを再確認、書込みフラグ既定OFF、受付/claim/結果記録、本人の操作状態DTO取得 |
| `edit-review.server.ts` | 通常編集5項目の差分とPOS項目patch、開始時の競合指紋、保存後の同一商品・変更値・保護値照合。送信処理なし |
| `20260908120000_pos_product_operation_ledger.sql` | 操作・店舗別予約・追記監査の3テーブル、RLS、状態/送信回数/版数のDB制約 |
| `20260908121000_pos_product_operation_functions.sql` | service-only受付/一度だけのclaim/結果記録RPC、権限・商品所属・内容hash・予約再検証 |
| `supabase/preflight_pos_product_operation_ledger.sql` | 読取り専用の適用前検査。本番未実行 |
| `tests/pos-products-db/` | PGlite 0.5.8で実SQLを実行する隔離テスト環境。アプリ依存は変更していない |

留意点:

- 署名は認可の代わりではなく、リプレイ防止もしない。DBの店舗manager再確認・内容一致・原子的claimを接続するまでPOS保存を許可しない。
- 純粋関数に加えてDBでclaimと状態保存を原子的に実装した。結果不明の操作は予約を維持し、自動再送しない。PGliteは単一接続なので、本番適用前に通常PostgreSQLの2接続競合試験が必要。
- `pos_verified` はPOS再取得の内部ID・所属・変更値を照合した後だけ発行する。単なる完了画面や検索0件を成功証明にしない。
- 参照がある/不明なJAN訂正・物理削除を現在は拒否する。過去JAN対応表・複合FK移行・再計算対応前に棚卸しsnapshotを更新しない。
- 金額小数2桁/整数9桁等はアプリ通信上の暫定安全上限で、実POSの保存対応を保証しない。原価の自動初期値だけは承認済みの1円未満切り捨てとする。手入力小数をPOSへ黙って送信・切り捨てしないよう、保存アダプター側の制約検証は引き続き必要。
- feature公開用の環境変数や専用鍵はまだ本番へ設定していない。新コードへの公開経路自体がない。

### P2a 編集レビューと台帳接続

- `prepareProductEditOperation` は差分から期待結果の指紋を計算して台帳へ登録する。クライアント由来snapshotや任意の結果指紋を公開Actionに直結しない。
- `recordProductEditVerification` は操作ID・店舗・期待指紋の一致、送信後に新規取得した実値の照合、本人/manager権限を確認して `pos_confirmed` を記録する。商品DB反映前に `completed` へしない。
- 無変更、古い/不完全なsnapshot、別店舗・別商品・共有所属、編集開始後の変更を拒否する。snapshotにはCookieやhidden状態を含めない。
- 初期対応は固定金額/一括価格/一括仕入先と整数円のみ。手入力小数、店舗別価格、会計時入力を自動切り捨て・一括変換しない。原価50%の初期値計算とは区別する。
- `otherSettingsFingerprint` は、将来のアダプターが税以外の非対象業務設定を漏れなく読取り正規化して算出する前提。セッション値をhash対象にせず、未知・未取得項目があれば `complete` にしない。現段階ではこの抽出アダプターがないため、fixture成功は実POSの全項目保持を実証しない。
- 指紋は確認した業務状態の比較であり、POS側の原子的な比較更新ではない。最終読取りから保存までのPOS外部編集の競合窓は、実フォーム/API契約の確認が必要。

## 検証

| 検査 | 結果 |
|---|---|
| 新規テスト | 72/72成功（入力9、同一性8、署名9、状態遷移7、DAL12、編集レビュー13、実SQL14） |
| 正式全回帰 `node --test tests/*_test.mjs` | 160/163成功、既存失敗3件（下記）。実SQL14件は別実行 |
| 基点HEADのみ別の一時フォルダに展開して回帰 | 102/105成功、同じ3件失敗。新規失敗なし |
| `tsc --noEmit` | 成功 |
| 追加コードのESLint | 0 errors / 0 warnings |
| 全体ESLint | 既存3 errors / 5 warnings。対象ファイルがHEADと同じことを確認 |
| 本番build | Next.js 16.3.3、Turbopack成功、25静的ページ生成 |
| GAS構文、差分空白検査 | 成功 |
| POS保存、通常PostgreSQLの2接続競合、実端末、Production | 未実施（隔離PGliteの実SQL試験のみ実施） |

ビルドには既存設定からSupabaseの公開URL/anon keyの2項目だけを子プロセスへ渡し、ファイルへコピーしていない。Sentryアップロード用tokenは渡していない。既存Next設定はbuild時の型検査を省略するため、独立した`tsc`を実行した。

既存の失敗:

1. 棚卸し確定前チェック/実確定の静的ソース検査2件。正規表現がLF改行固定で、CRLFソースでは切出しが空。読み取り文字列だけをLF正規化すると対象関数を切り出せることを確認。ソース/テストファイルは変更していない。
2. CMS秘密情報のフォールバック禁止検査1件。mainには保留中のフォールバック削除が含まれていない。別worktreeの未コミット修正を取り込んでいない。秘密値は記録しない。
3. 全体Lint: `BarcodeScannerModal.tsx`のimmutability 2件、`petsSync.ts`のprefer-const 1件。警告は既存の画像・hook依存・相対URL代入。

## 次の実装単位

### 2026-09-10: CSV同期の版管理・一括反映

- `gas/posProductSync.js` と `20260910090000_product_master_sync_fence.sql` を追加し、既存ダウンロード/CSV処理へ接続。既定OFF、本番未適用。取得開始後の編集や別同期は全件拒否し、更新と未取得商品の停止を同一transactionへ移した。
- ブランド・手動停止・別店舗を保護。入力不正・期限切れ・DB途中エラーでは部分反映なし。専用資格情報だけを使用し、自動再送/旧経路へのfallbackなし。取得中のフラグ変更とCSV自身の店舗不一致も拒否/保護をテストした。
- 既存GASの読み取り専用dryRunが成功。本店3,835行、JANあり3,823行・種類3,793（重複30行分）、JAN空12行。列2は区分1/2で内部IDではない。原因未確定なので先頭採用へ緩和しない。追加した件数診断 `syncSafety` はローカルfixtureのみ検証済みで、実データでの重複分類は次の確認事項。
- **追加機能93/93成功**（通常68・SQL25）。全体170/173、既存の同じ3失敗。GAS/parser関連17/17、構文/差分検査成功。4,000商品の一括反映と再取得値照合成功（PGliteの試験約0.5秒、本番性能の保証ではない）。型・Lint・本番buildは9/9の検証結果で、今回はTypeScript/依存を変更していないため再実行していない。
- 本番のPOS保存、DB適用、GASデプロイ、Git commit/push、Vercel反映は未実施。元ルート/他worktreeの未コミット変更は混入させていない。
- 旧writerを残したままでは上書きを防げない。[適用手順](ledger_deployment.md)に旧経路停止・重複診断・複数接続のロック競合試験・フラグOFFだけでは戻さない復旧条件を追加した。同期競合対策の本番完了とはしていない。

### 2026-09-10 続行: 通常編集のDB反映・復旧

- 新規 `20260910120000_pos_product_edit_apply.sql` とserver-only DALを接続。変更前のDB値とPOSカタログ名称を受付時に固定し、POS再取得で確認済みの場合だけ商品・旧名称別名・POSリンク・完了監査を一括反映。途中エラーなら全体rollback、同一操作の再試行はDBだけで完了する。
- DB値の別端末変更、別名衝突、POS内部IDの重複予約、権限剥奪、完了偽装を拒否。手動停止・ブランド・別店舗・棚卸しの数量12/計数時刻/名称snapshotの保持を実SQLで確認。
- 新規15テスト追加（SQL11・DAL4）。機能全体108/108（通常72・SQL36）成功。全回帰174/177で同じ既存3失敗。型検査・対象Lint・Next本番build（25ページ）成功。全体Lintは既存ファイル未変更のため前回結果3 errors / 5 warningsを継承。
- CUAは `failed to write kernel assets: 指定されたパスが見つかりません`、agent-browserは有効セッションなし。ユーザーの保存済みログイン情報には触れておらず、今回はPOS実画面の内部ID調査を再開できなかった。アプリ再起動等でブラウザ接続が戻った時点で読み取り調査を再開する。
- POS保存、DB本番適用、GAS/Git/Vercel反映は未実施。新規SQLはローカルのみ。名称カタログはサーバー取得必須で、UI入力を信頼して接続しない。

### 2026-09-19: ブラウザ復旧と内部ID読取り診断の準備

- CUA接続が復旧。許可済みの保存済みログインを使用し、パスワード値を取得せずログインした。本店の店舗11053・所属11098・JAN `4902397868767` で1件に絞り、詳細・編集フォームを確認後、保存せず商品一覧へ戻った。
- `goodsId-30` / `excludeGoodsId` はDOM読取りで値を取得できなかった。区分hiddenも値を取得できないため、これをPOS側の内部ID欠落とは断定しない。JANを内部IDとして代用しない。
- 新規 `gas/posProductReadDiagnostic.js` は所有者が手動実行する読取り診断。既存ログイン/フォーム/Cookieの補助関数を使用し、商品コード・メーカー品番の各検索→1件の場合だけ詳細→編集フォームを読む。URL/操作を許可リストで制限し、全submitと削除チェックを除外して読取りactionだけを送る。店舗/JAN不一致は中止し、IDが空ならnullを返す。HTML・Cookie・認証値は出力せず、例外原文も隠す。
- 診断テスト9/9成功、GAS構文検査と差分空白検査成功。全回帰183/186、失敗は上記の既存3件と同じ。TypeScript・SQL・依存は変更していないため、型・対象Lint・本番build・実SQL検証は9/10の結果を継承し、今回の実施結果とはしない。
- **GAS未追加・未実行、実レスポンスでの内部ID取得は未確認**。診断は製品の保存アダプターではなく、P0/P1の完了や本番提供開始とは扱わない。

#### 次に承認を求める範囲

1. 現行GASソースと版を読み取り比較・退避し、**`posProductReadDiagnostic.js` 1ファイルだけ追加**する。既存ファイルへの差分が出る場合は中止して再確認する。
2. 所有者用 `diagnoseHontenProductReadContract` を1回手動実行。本店JAN `4902397868767`（デイリーディッシュ子猫チキン 35g）だけを対象とする。既存Script PropertiesのPOS資格情報はPOSへのログインにのみ使用し、値を出力しない。
3. 商品保存/追加/削除、DB・Drive書込み、同期フラグ変更、トリガー作成、Web App再デプロイ、Git push/Vercel反映は含めない。現在ローカル変更中の `autoDownload.js` / `importCSV.js` や同期フェンスは一緒に送らない。

### 次の接続作業

#### 2026-09-19: 承認済み診断ファイルのGAS追加

- ユーザーが上記の診断1ファイル追加・本店対象商品の読取りを明示承認。clasp 3.3.0、アカウント `kirikan22@gmail.com`、プロジェクト `.clasp.json` のscriptIdを確認。
- 現行HEADの3ファイルを専用一時フォルダーへcloneし退避。`clasp push`は全体置換のため、この隔離コピーだけを使用し、作業worktreeの既存GAS変更は含めなかった。診断の依存補助関数4つが現行HEADとローカルで同じであることも確認。
- 診断追加後にpullして照合し、既存 `appsscript.json` / `autoDownload.js` / `importCSV.js` は退避版とバイト一致、追加診断はローカルと改行正規化後一致。既存デプロイ4件（HEAD/11/12/56）不変、新しい版・Web Appデプロイなし。HEADには診断が追加されたが、入口やトリガーへ接続していない。
- Script Editorを開くブラウザはGoogleログアウト状態で、対象アカウントのパスワード入力待ち。実行APIの追加公開や認証権限拡大は行わず、ユーザーへログインを依頼。**診断未実行・内部ID未確認**。
- 退避先: `C:/Users/mario/AppData/Local/Temp/kennel-pos-read-196414eaae9b4728b717a4a3e3ba7d96-backup`。一時領域のため恒久バックアップではない。取得したソースのみで、Script PropertiesやOAuth資格情報はコピーしていない。

#### 継続手順

2026-09-20 最新結果: 診断のみの修正・再実行を内部ID確認まで承認され、GAS受信HTMLの店舗selectを厳格に抽出する処理を診断内へ追加。12:45:18〜12:45:41の実実行で、本店JAN4902397868767は商品コード・メーカー品番の両検索で各1件、同一内部ID `0-0-721485575`・店販2・所属11098・両JAN一致を確認した。内部IDの読取り確認は完了。診断13/13、回帰187/190（既存3失敗）。既存GAS3ファイル不変、商品保存/削除・DB変更・公開Web App更新なし。以下の古い未取得記録は経緯として保持する。

2026-09-20追記: 対象Googleアカウントを確認し、診断関数を1回手動実行した。ログインフォームのinput9/対象field8の件数ログ後、安全中止メッセージで終了。商品内部IDの結果は取得できていない。秘密情報保護のため例外原文を隠しており、失敗工程・原因はまだ不明。既存接続処理との差異は確認したが原因とは断定せず、工程名と固定エラーコードだけを診断1ファイルへ追加する修正・再実行の承認待ちとした。商品保存/削除/DB変更・追加デプロイなし。

1. POS画面契約を完成させる（内部ID、保存制約、非対象値保持）。
2. 新CSV経路の実データ互換性・旧writer停止条件を確定し、POSアダプターと通常編集の受付/反映RPCを実フローへ接続。[DB適用手順](ledger_deployment.md)の事前試験を完了する。
3. 商品編集を先に接続し、次に追加。JAN訂正/削除は独立した安全確認導線を設ける。
4. 実保存対象と差分の承認後に指定商品で検証。DB/GAS/Git/Vercelは別途確認して反映。

## 2026-10-03: 編集フォーム読取りとレビュー受付の接続（ローカル）

- 保存済みログイン情報を使ってPOSへログイン。本店11053/所属11098/JAN4902397868767で1件→詳細→未変更の編集画面を確認。税の単一selectにはselected属性が付かない場合がある。略称の項目名は `abbreviateGoodsName`、通常保存は `doUpdate`。商品保存はしていない。
- `gas/posProductForm.js` はフォーム/所属/区分/JAN二欄/内部ID/価格方式を検査し、商品名・金額・原価・分類・仕入先・店舗別候補だけを取得する純粋処理。店舗selectは明示選択必須。税等の非identity単一selectはHTMLの既定選択を扱う。説明・税・フリガナ・略称等の業務指紋と通信hidden状態を分け、opaque hidden値はDTO/ログへ出さない。
- `inspection.server.ts` は両検索の完了、候補一意性、同一商品・業務値・分類/仕入先候補の一致を検査して既存レビューsnapshotへ変換。`edit-preparation.server.ts` はmanager認可と `store_id + product_id` のDB照合をPOS取得より先に行い、DB由来JANを使用して既存の差分/台帳受付へ接続する。feature flag未設定では通信・受付なし。
- 新規11/11、既存編集レビュー/診断を含む関連37/37、全回帰198/201。既存失敗3件は棚卸し静的検査2件とSentry/CMSの秘密情報検査1件。SQL36/36、独立型検査・対象Lint・構文・差分空白検査成功。全体Lintは既存3 errors / 5 warnings。Next本番buildは25静的ページ生成まで成功。ビルドには既存設定から公開Supabase URL/anon keyのみを子プロセスへ渡し、ファイルへコピーしていない。
- 実GAS HTMLで新パーサーを動かした確認はまだない。ブラウザではhidden項目の存在を確認できるが、値の評価は保護されており、hidden所属との一致を現在の実データで保証していない。画像等のopaque状態の保持・実保存・保存後再取得、UI、旧CSV writer停止、通常PostgreSQL複数接続検査は引き続き未完了。未検証事項を保存可能と扱わず、公開経路/有効化は行っていない。
- clasp 3.3.0、認証 `kirikan22@gmail.com`、同一scriptIdへread-only cloneを実施。現行は既存3ファイル＋旧診断の4ファイル、デプロイはHEAD/11/12/56。`autoDownload.js`/`importCSV.js`は前回確認ハッシュと一致。取得先は `C:/Users/mario/AppData/Local/Temp/kennel-pos-inspection-read-aec07f48131e4a0dae9b26b17debf17b`（一時領域）。GASへpush・版作成・公開デプロイはしていない。
- 次のGAS差分は2ファイルだけ: `posProductForm.js`追加、`posProductReadDiagnostic.js`更新。既存診断結果を維持し、内部callbackと新しい所有者手動診断 `diagnoseHontenProductEditInspection` を追加する。本店の同じJANを両検索し、業務値/分類候補/価格方式を確認する。POS保存・DB反映・トリガー・公開Web Appへの接続は含めない。前回は診断1ファイルのみの追加承認だったため、今回の2ファイル反映は承認待ち。

### 反映時の固定比較値

- 対象scriptId: `1nixIMLQV4pA2Panl2LAvvXumftccUrZ6dPixbPLDygIxveYXViy-1Hhj`。
- 現行 `autoDownload.js`: SHA-256 `C9749CEDAF2DE77C40FF6968BC76C2FA15A204D759D79F2AFDCC23EA6996F51C`。
- 現行 `importCSV.js`: SHA-256 `A684660FC407C162D9157C6EB2DE868002F88DB91A5CD1DFB613E093B4EED718`。
- 現行旧診断: SHA-256 `15833C585A5DBFE676DF8D6B106C924C3B7DD0F63E7F153F4544373445D5A964`。承認後も直前pullで前提の変化を確認し、隔離コピーの旧版を退避、対象2ファイルだけ差し替え、再pullで既存3ファイル不変を確認する。

## 2026-10-03 続行: 承認済みGAS反映と実読取りの完了

- 上の承認待ち/未実行の記録は反映前の経緯。ユーザー承認後、隔離コピーから `posProductForm.js` と `posProductReadDiagnostic.js` だけをHEADへ反映した。途中の5回の安全停止を固定コードで切り分け、同一type属性の重複に対応した。異なるtypeや店舗/JAN/項目の曖昧さは許可していない。
- 8:06:19の実結果: 本店7、JAN4902397868767、内部ID0-0-721485575、両検索完了・同一業務値。商品名「デイリーディッシュ子猫チキン 35g」、POS入力価格126、原価75、分類721420887、仕入先未設定。分類候補9件・仕入先候補25件。税0、一括固定価格、一括仕入先を確認。既存原価を半額へ変更していない。
- parserレビューで、template/引用属性内の偽店舗selectを拒否し、文字参照を一度だけdecode・未対応形式は停止する検査を追加。表示用class/styleは値照合に使わず、type重複は完全一致だけを認める。
- `inspection-transport.server.ts` と `gas/posProductInspection.js` は署名inspect専用のローカル実装。manager認可→店舗別DB商品→DB由来JAN/サーバーactorで設定を生成し、署名POST・GAS受付・相関検査・既存DTO検査へ接続する。期限/サイズ/許可ホストを検査し、転送先へはGETだけを送る。署名本文は転送せず、異常応答の本文も閉じる。設定OFFや失敗時に再送/台帳受付/POS保存へ進まない。
- 新しい受付ファイル、鍵/フラグ、doPostへの接続は本番に追加していない。現行Web App v56で署名inspectを使えるとは扱わない。関連48/48、全回帰209/212（同じ既存3失敗）、独立型・対象Lint・本番build成功。SQL未変更で直前36/36を継承。
- 最終pullで既存3ファイル不変、対象2ファイル一致、デプロイHEAD/11/12/56不変を確認。最終SHA-256: form `BDAEA2DF11028995BAD3C9EAA90CDB6E86F74FF15B1E4A143308D2A1792F400B`、diagnostic `352AF88A8533231DB63538F045D4DEC0325F149801AE367FDA74FF4155F4A609`。初回退避は `C:/Users/mario/AppData/Local/Temp/kennel-pos-inspection-backup-20261003-3e835886b7b44c2c819f91d993ffda40`（一時領域、ソースのみ）。
- 実POS保存/削除、DB本番、Git push、Vercel反映はしていない。画像/opaque hidden状態の保持、保存後再取得、公開UI、旧writer停止・通常PostgreSQL複数接続検証は残る。次はこの保存契約を完成させ、対象と差分の承認後に実保存を試す。

## 2026-10-03 続行: 送信データの生成と読込/レビューUI（ローカル）

- `posProductSubmission.js` は通信を行わず、最新フォームの成功コントロールと通常編集の5項目だけで送信データを生成する。JAN/店舗/内部ID/税/画像/通信状態のpatchを拒否し、商品グループ/仕入先は同店舗の有効候補、金額は整数円、readonly/maxlengthも検査する。hidden状態は最新取得分を保持し、ブラウザ/ログ/DBへ返さない。
- 実POSで本店JAN4902397868767の未変更フォームを読み取り、`multipart/form-data`、未選択の`uploadThumbnailFile`、外側のTeeda hidden2項目、`doUpdate` submit、`doubleSubmitChk`/`saveConfirm`を確認。保存せず商品一覧へ戻った。空file partを含むmultipartを合成フォームで生成し、標準FormData parserで復元・画像名/非対象値保持を確認。**実POSTや保存後の画像保持はまだ検証していない**。
- 独立レビューでhidden action混入/重複save、任意queryからのaction混入、外側の未引用form所有者による項目省略を再現した。操作名偽装の拒否、action queryの既知キー限定、属性解析による外側所有者検査を追加し、回帰テストを通した。
- `editor.server.ts`/`app/actions/posProducts.ts`は、店舗manager認可→`store_id + productId`でDB照合→DBのJANとサーバーactorでPOSを取得→厳格照合の順。ブラウザへは5項目・店舗別候補・指紋だけを返し、内部ID/設定snapshot/送信本文は渡さない。レビューは毎回再取得し、変更前後の分類/仕入先を名前で表示する。台帳受付・商品保存・DB更新は呼ばない。
- `POS_PRODUCT_EDITOR_ENABLED`はサーバー専用で既定OFF。ONの準備画面は読込/差分確認までで、保存ボタンなし。OFFは従来の編集を維持する。ONでは通常更新ActionのDB直接編集を拒否するが、既存CSV upload/他writerの停止・共通排他は未完了であり、全面的なwriter切替完了とは扱わない。署名inspect公開入口/鍵/フラグも本番未設定。
- モーダルは失敗/再取得で入力を保持し、最新値を別表示する。採用・置換は明示選択、確認後の変更でレビューを無効化、通信中は閉じる/Escapeを拒否、入力破棄には確認を要求する。
- `tests/pos-products-ui/serve.mjs`は実コンポーネントと合成actionだけで動くloopback検証用。実サービスコード混入時は起動拒否、CSP `connect-src 'none'`、固定GET以外は拒否。本番routeや設定は追加していない。CUAでPC/390pxスマホ、正常差分、再編集、破棄キャンセル、通信失敗、競合、再取得→明示採用を確認。原価75を自動で半額63へ変更せず、失敗時も入力が残り、スマホ横はみ出しなし。
- 新規34/34、全回帰243/246成功（従来と同じ棚卸し静的検査2件・Sentry/CMS secrets検査1件が失敗）。独立`tsc --noEmit`、対象Lint、本番build成功。全体Lintは既存3 errors / 5 warnings。SQL未変更で直前36/36を継承し、通常PostgreSQL2接続試験は未完了。
- `diagnoseHontenProductEditSubmission`をローカル追加。固定の本店商品を両検索し送信データを組み立てるだけで、商品保存/DB反映や本文・資格情報の出力はしない。GAS HEADへ`posProductForm.js`更新、`posProductSubmission.js`追加、`posProductReadDiagnostic.js`更新の3ファイル反映と所有者診断は**次の別承認待ち**。公開Web App・実POS保存・DB・Git/Vercelは変更していない。

## 2026-10-03 続行: 承認済み3ファイル反映と送信データ組立診断

- ユーザーがHEADの3ファイル反映と固定本店商品の読取り・組立診断の両方を明示承認。clasp 3.3.0、Googleアカウント `kirikan22@gmail.com`、既知scriptIdを確認。現行5ソースをfresh cloneして退避し、対象3ファイルだけ差し替えた隔離コピーから反映した。他のローカルGAS変更は含めていない。
- ソース退避先: `C:/Users/mario/AppData/Local/Temp/kennel-pos-submission-backup-20261003-b12f4858c3dc4dc5b2bdaca6ac0017e9`。一時領域、ソースのみ。Script Properties/OAuth資格情報は取得・コピーしていない。
- 反映後fresh cloneで6ソースの一覧とSHA-256一致を検証。既存manifest/autoDownload/importCSVは前回値と一致。対象の最終ハッシュ: form `BB7F0CEE49C291D20C7DBB762BA746952D7CD5A177B3D5C1AA98D55DBD9F726C`、submission `5742C77C51EC13852C2ACEF7BC0B0DD5F169DA686E1880FFADF52F46D8766E0F`、diagnostic `645EBF1F039FEFFC9FEC02E80617BDC2ABD5AB3ADD41D8BB2EFD57845BF7BD28`。デプロイ4件HEAD/11/12/56不変。新しい版/公開デプロイ/トリガー接続なし。
- 所有者が実行する `diagnoseHontenProductEditSubmission` を1回実行（16:58:57〜16:59:19）。本店7/JAN4902397868767の両検索一致・組立2回、multipart、成功control96、空file1、更新submit1、`productSaveSent=false`。本文・hidden値・Cookieを出力せず、商品保存を送信していない。
- **保存前の未解決事項**: `hasFrameworkState=false` は送信データに `te-conditions` がないことを示す。通常ブラウザで同一商品の未変更フォームを確認すると、対象formに同名のenabled hiddenが1件あり、既知view-state hiddenも1件存在する（値は取得せず、名前/type/disabled/form所属だけ確認）。GAS受信HTMLとブラウザ状態の差異の原因や、保存時の必要性は未確定。組立診断の完了を実保存の成功とは扱わない。商品価格126/原価75のまま、保存せず一覧へ戻った。
- 今回は関連42/42、3ファイルの構文・差分空白検査成功。Next/SQLコードは変更せず、直前の型/対象Lint/build/SQL検証を継承する。DB本番、実POS保存/削除、Git push、Vercel反映、公開署名inspect接続は未実施。

## 2026-10-03 続行: 状態項目の有無・件数だけの再診断

- ユーザーが診断1ファイルへの件数追加・GAS HEAD反映・固定本店商品の再診断を承認。`posReadSubmissionStateCounts_` は固定2項目について実HTML input、対象form input/enabled hidden、組立entry、inline script内の項目名参照の件数だけを返す。値・HTML・script本文は出力せず、script実行・商品保存・通信追加は行わない。
- テストを先に追加し、他form/コメント/script/属性内の偽input、disabled、文字参照名、曖昧な属性、組立漏れを検証。独立レビューで対象外の別form属性不備が追加停止条件になることを確認し、固定項目以外の重複属性・復号不能名で止まらないよう修正した。関連47/47、全回帰248/251（同じ既存3失敗）、GAS構文・差分空白検査成功。Next/SQLコード未変更で直前の型/対象Lint/build/SQL検証を継承。
- fresh cloneで現行6ソースを退避し、差分が `posProductReadDiagnostic.js` 1つだけであることを確認して17:17:53にHEADへ反映。最終SHA-256 `0130E43B04D0A26A528B4B0109447F4192EA89096B58C217CD55D5F95E604546`。再取得で全6ソース一致、他5ソースとデプロイ4件HEAD/11/12/56不変。退避先は `C:/Users/mario/AppData/Local/Temp/kennel-pos-state-counts-backup-20261003-f0e9fc626bb947e1a0defa9b8a4e7d78`（一時領域・ソースのみ、認証値は含めていない）。
- 所有者診断1回（17:19:27〜17:19:50）: 本店7/JAN4902397868767、両検索一致・組立2回・商品保存送信なし。te-conditionsは全HTML input/対象form input/enabled hidden/組立entry/inline script参照すべて0。既知view-stateは全HTML input/対象form input/enabled hidden/組立entry各1、inline script参照0。
- この結果は、te-conditionsがGAS受信HTMLの実inputには存在せず、別のview-stateは保持されることを示す。ただし後続のブラウザ調査で旧式HTMLコメント付きinline scriptを診断が除去していたと判明し、上のinline script参照0は無効な観測として訂正する。ブラウザではinline scriptが非表示spanを各formへ追加して状態項目を生成していた（値は取得・表示していない）。GAS側の参照件数は修正後の再診断で確認する。実保存成功・画像保持・商品機能本番利用可能とは扱わず、公開有効化は進めていない。

## 2026-10-03 続行: 動的状態の生成元確認とローカル対応

- 通常ブラウザの未変更フォームで、inline scriptが既知2フォームへ非表示spanを追加し、`innerHTML`の文字列から`te-conditions`を生成する定型処理を確認。スクリプトの文字列は状態値を伏せ、固定フォーム名/タグ/表示方式だけを確認した。商品を保存せず一覧へ戻った。
- `<!-- ... //-->` はscript内の旧式コメント記法。前回診断のコメント除去がその本文を消していたため、inline参照0の観測は無効だった。実コメント/属性/style/textarea内の偽scriptを除外し、実script内の旧式コメントを保持する件数カウンターへ修正した。追加再現テスト・独立レビュー成功。
- fresh clone/ソース退避/1ファイル差分確認後、17:39:04に診断だけをHEADへ反映。最終diagnostic SHA-256 `B0CB493B7756FADC086156A4203D26307C2DF90C0DA4C4A11F752B346372E74F`。再取得で6ソース一致、他5ソースと公開デプロイHEAD/11/12/56不変。退避は `C:/Users/mario/AppData/Local/Temp/kennel-pos-state-script-backup-20261003-a374c97f7f2742c5834eda4709d124ef`（一時領域・ソースのみ）。
- 所有者診断1回（17:40:06〜17:42:30）: 本店7/JAN4902397868767、両検索一致、組立2回、成功control96、空file1、更新submit1、商品保存なし。te-conditionsは実input/対象form/組立entry各0、script参照1。既知view-stateは実input/対象form/enabled hidden/組立entry各1、script参照0。GASにも生成scriptは届いており、literal inputだけの解析では動的項目を拾えないと切り分けた。
- **ローカルのみ**: `posProductForm.js`に既知生成文法の静的parserを追加。JS実行はせず、2フォーム・ループ・非表示span・hidden1個の定型からだけ状態を抽出し、送信準備の内部entryへ保持。余分な文/式、別フォーム、表示変更、外部script、重複状態、未知属性/項目、未対応escape、巨大状態は固定コードで停止。状態欠落/未知生成方式も状態なしで通さない。業務snapshot/DTO/ログには状態値を含めず、同じ商品を再取得した最新状態だけを使用する。
- 独立レビューで、参照先layout formがない場合と対象formより先に同IDのdivがある場合にブラウザと解析が食い違うケースを再現。両参照IDが一意な正しいformで、入れ子でなく生成scriptより先に閉じられていることを確認するチェックを追加。別要素・重複ID/属性・欠落・後置form・未閉鎖/入れ子・form内scriptを拒否する。修正後の独立再レビューで正常組立と指摘2ケースの拒否を確認し、追加指摘なし。
- 追加9テストとowner診断の合成10通信を含め、関連57/57、全回帰258/261（従来の棚卸し静的検査2件・Sentry/CMS秘密情報検査1件）、GAS3ファイル構文・差分空白検査成功。Next/SQL未変更で、型/対象Lint/build/SQLは前回結果を継承し今回再実行していない。
- 未反映form SHA-256 `F4C11C2BBA04C866A7272607334EB0DF2DE694C03606166D42A5C8B8290055F5`。次はこのform更新1ファイルだけのHEAD反映と同じ保存なし診断で、実GAS HTMLから状態を1件保持できるか確認する（別承認待ち）。商品保存・DB変更・公開版作成・Git/Vercel反映は含めない。実保存後の状態/画像保持・商品機能本番有効化は引き続き未完了。
- 診断証跡: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-state-script-diagnostic-20261003.jpg`。

## 2026-10-03 続行: form単独反映と生成script属性の不一致

- ユーザー「はい、お願い」でform更新1ファイルのHEAD反映と同じ本店商品の保存なし診断を承認。最新GASを取得・退避し、18:10:50に `posProductForm.js` だけを変更した隔離コピーを反映した。再取得で全6ソースが予定内容と一致し、他5ソースとデプロイ4件HEAD/11/12/56は不変。公開バージョン作成・既存同期の反映はしていない。
- 現行HEAD form SHA-256: `F4C11C2BBA04C866A7272607334EB0DF2DE694C03606166D42A5C8B8290055F5`。反映前6ソースの退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-generated-form-backup-20261003-879937a467e74960ae681c75a9330911`（一時領域・ソースのみ、資格情報なし）。再取得コピー: `C:/Users/mario/AppData/Local/Temp/kennel-pos-generated-form-verify-d9dda72e930a432693f138fb78c2fc08`。
- 所有者診断1回（18:12:00〜18:12:15）は、本店7/JAN4902397868767の検索→詳細→編集フォームの店舗/JAN照合を通過し、最初の組立に入る生成状態検査で `POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE` として安全停止。組立2回・両検索完了・状態保持の実確認は未達。商品保存・DB更新は行わず、自動再実行していない。
- 通常ブラウザの同じ未変更フォームで、生成scriptの属性が `language="JavaScript"` と `type="text/javascript"`、参照先が一意な非入れ子form2個でscriptより先に閉じられていることを確認。状態値は取得/出力していない。現行parserがlanguage属性を拒否する不一致をローカル再現テストで確認した。ただし実GASの固定コードは生成状態全体のため、生HTMLのどの検査で停止したかはまだ特定できていない。価格126/原価75を変えず、保存せず一覧へ戻った。
- **追加修正はローカルのみ**: 確認済み `language=javascript`（大文字小文字不問）だけを許可し、別言語・空欄・src・module・未知属性・重複languageは拒否する。生成状態の候補/参照先/属性/文法/markup/状態値を固定工程名だけで切り分ける。JS実行・任意script解釈・認可/店舗照合の緩和はしない。
- 修正差分は現行HEAD formから14行追加/3行削除。未反映ローカルform SHA-256: `35B9BC7E129BF607DD6E2F65980FD37F9959FAAC2F3DF32B30AA3D4E94959770`。2再現テストを追加し、既存owner診断をlanguage付き合成フォームでも確認。関連59/59、全回帰260/263（同じ既存3失敗）、GAS構文・差分空白検査成功。Next/SQL未変更で、型/対象Lint/build/SQLは前回の結果を継承し今回は再実行していない。
- 独立レビューで追加指摘なし。現行HEADの残り3GAS（autoDownload/diagnostic/submission）と新formだけを組み合わせ、language付きの合成owner診断を1回実行し1/1成功。状態保持・通信10回・商品保存なし・状態値/本文のログ非公開を確認した。ネットワーク通信や実GAS再診断ではなく、実環境での成功は未確認。
- 次の別承認対象はこのform修正1ファイルのHEAD反映と、本店7/JAN4902397868767の同じ保存なし診断。実商品保存・DB・公開版・Git/Vercelは対象外。実保存/画像保持/商品機能の本番有効化は未完了。
- 安全停止の証跡: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-generated-form-stop-20261003.jpg`。

## 2026-10-03 続行: language属性の限定修正をHEADへ反映、保存なし実診断成功

- ユーザー「お願い」で、前節のform修正1ファイルと固定本店商品の保存なし再診断を承認。最新6ソースをfresh clone・ソースのみ退避し、唯一の差分が承認済みformの14追加/3削除であることを独立監査した。Googleの既存claspアカウントも `kirikan22@gmail.com` と確認。通常認証更新以外の権限変更なし。
- 22:04:06にHEADへ反映。別のfresh cloneで全6ソースが予定内容と一致し、他5ソース（manifest含む）と公開デプロイ4件HEAD/11/12/56不変を確認。現行form SHA-256 `35B9BC7E129BF607DD6E2F65980FD37F9959FAAC2F3DF32B30AA3D4E94959770`。既存ローカルGASの未承認変更や新しい受付ファイルは混入していない。公開版作成・トリガー接続・実保存の有効化なし。
- 退避: `C:/Users/mario/AppData/Local/Temp/kennel-pos-language-backup-20261003-128a2635f0a84f5eb29b701efbe0bfff`。反映用: `C:/Users/mario/AppData/Local/Temp/kennel-pos-language-stage-adc779ff9b504e9cac2bfacd519b8806`。再取得検証: `C:/Users/mario/AppData/Local/Temp/kennel-pos-language-verify-a6ac4337b5c74db5b52a36400fef4fa1`（すべて一時領域、退避はソースだけで資格情報を含めない）。
- Script Editorを更新し、`diagnoseHontenProductEditSubmission` の選択を確認して1回実行（22:06:15〜22:06:37）。本店7/JAN4902397868767、両検索完了・同一業務値、組立2回、multipart、成功control97、空file1、更新submit1、`hasFrameworkState=true`、`productSaveSent=false` を実ログで確認。
- te-conditionsは実HTML input/対象form/enabled hidden各0、inline script参照1、組立entry1。既知view-stateは実HTML/対象form/enabled hidden/組立entry各1。前回96コントロールから97へ増え、欠落していた生成状態を1項目保持できた。状態値・送信本文・Cookie・例外原文は出力していない。
- 今回は前節の検証済みhashをそのまま反映し、追加実装なし。関連59/59・全回帰260/263（従来と同じ3失敗）を継承。隔離セットのGAS3ファイル構文・差分空白検査も成功。Next/SQLコードは未変更で型/対象Lint/build/SQLの前回結果を継承し、今回の再実行ではない。
- **検証範囲**: 実POSへの商品保存を送らず、DB/在庫/既存同期/公開版/Git/Vercelは変更していない。確認できたのは実GAS取得HTMLからの保存データ組立と状態保持まで。実保存後の再取得・画像等の保持、公開署名inspect接続、旧CSV writer切替、通常PostgreSQL複数接続検証等は残り、商品編集機能が本番利用可能になったとは扱わない。
- 成功診断の証跡: `C:/Users/mario/.codex/visualizations/2026/08/22/01a02aaa-2ed2-7283-8de5-abf1552fc508/pos-product-generated-state-success-20261003.jpg`。

## 2026-10-04 続行: private通常編集実行アダプター（ローカルのみ）

- `gas/posProductEditExecution.js`を追加。専用フラグは既定OFF、永続実行権の消費ポートが未接続ならPOS通信も行わない。公開入口・所有者診断・トリガー・既存CSV同期へ接続していない。
- 固定URL/店舗/JAN/操作ID/利用者ID/有効期限と通常編集5項目だけを受け付ける。呼出入力を内部コピーし、最新の店舗別両検索・既存フォーム契約・変更前値の照合後に送信本文を組み立てる。実行権の受理は操作/利用者/店舗/dispatchHashの一致を必須にし、消費前後の運用OFF/期限切れで保存開始前に停止する。
- 保存POSTは1箇所・1回だけで、自動再送しない。応答HTMLや成功画面には依存せず、固定一覧から両検索を新規実行し、内部ID・変更5項目・非対象業務設定・候補を照合する。不明応答や取得/照合失敗は`verification_required`。切断後に最新値が一致した場合の`values_verified`も、観測値の一致であって保存commitやexactly-onceの証明ではない。
- 新しいテストで、既存fingerprintが全hiddenを除外するため画像名変更を見逃すことを再現。既存parser/公開DTOを変更せず、既知`imageFileName`だけをprivateで保持・比較するよう補強した。両検索間・保存前後の不一致、欠落/重複/無効化/別typeで停止し、空文字は画像なしとして保持する。Teeda状態などの通信hiddenは比較対象にしない。値・HTML・本文・Cookie・例外原文を結果/ログ/消費ポートへ渡さない。ファイル名メタデータの一致までで、画像バイナリの不変は未証明。
- 合成UrlFetch/プロパティ/実行権ポートで新規15/15、関連94/94成功。全回帰275/278（従来と同じ棚卸し静的検査2件・Sentry/CMS秘密情報検査1件が失敗）。新規GASの構文・差分空白検査と独立レビュー成功。Next/SQLコードは変更せず、型/対象Lint/build/SQLは10/3の検証結果を参照しており今回再実行していない。既存form/diagnostic/submissionのローカルhashは10/3の反映済み値から不変。
- **未接続の必須条件**: DBの既存claimだけではGASの二重送信を防ぐ消費記録にならない。別の永続消費記録でdispatchHashとDB command hash・POS内部ID・期待結果を束縛し、再起動後にserver-onlyで照合情報を復元する経路が必要。現テストのSetは合成ポートであり本番永続実装ではない。POS側の同時編集競合、通常PostgreSQL複数接続、旧CSV writer切替、実保存/画像保持も未完了。
- 今回はローカル新規アダプター・テスト・進捗記録だけ。外部通信、GAS反映、商品保存/削除、DB/在庫変更、Git stage/commit/push、Vercel反映はしていない。次は永続消費と復旧照合の接続をローカルで実装し、実保存対象の確認はその後に行う。

## 2026-10-04 続行: 永続実行権とprivate復旧照合（ローカルのみ）

- 新規migration1本で通常編集の固定dispatchと消費記録を追加。登録はprepared/send0、消費はdispatching/send1に限定し、本人manager/店舗/操作/command hash/POS内部ID/3予約/現DB商品/固定期待値を再検査する。一度だけaccepted=trueで以降はfalse、登録/消費のロック待機後も期限を検査する。操作・商品・棚卸し/在庫の値は変更しない。
- `edit-dispatch.server.ts`はGASの7項目だけを再帰sortした本文/hashと変更前/期待結果の業務指紋を作り、保存済み値を厳格再検証してprivate reviewを復元する。Cookie/HTML/hidden状態や資格情報は記録/DTOへ混入させない。既存のsnapshot hash形式は変更しない。
- `ledger.server.ts`の登録/復旧RPCは本人のDB店舗manager権限を毎回再確認し、未知応答/別店舗/hash/版/receipt不一致や通信切断を固定例外で止める。復旧読取りは書込みOFF/期限後でも利用できるが送信許可ではない。公開状態DTOは従来5項目のまま。
- 専用フラグは既定OFF。private準備経路へ固定登録を接続し、再受付/登録commit後の応答消失では既存本文/期限/照合基準を復旧読取りから再利用する。登録済みpreparedの期限を作り直す問題と、認可await中の呼出元変更でRPC店舗がずれる問題を独立レビューで発見し、再現テスト先行で修正。状態進行時はpreparedへ戻さず、復旧失敗/不一致では登録も再送もしない。修正後の再レビューで追加指摘なし。
- 新規通常14件とDB12件、関連通常44/44・DB全48/48成功。両店舗で実TS builder→実SQL登録→claim→consume→get→TS復旧の本文/hash/期待指紋/receipt一致、期限後復旧、権限剥奪/別店舗、再消費false、RLS/GRANT、記録不変、JSON重複キー/未知キー拒否を検証。DBはメモリ内PGliteであり通常PostgreSQLの複数接続競合を実証していない。
- 全回帰289/292（従来と同じ棚卸し静的検査2件・Sentry/CMS秘密情報検査1件が失敗）。独立`tsc --noEmit`・対象4ファイルLint・本番build25ページ成功。全体Lintは既存3 errors/5 warnings。初回buildは作業用フォルダの公開Supabase設定不足で失敗したが、既存の公開2キーだけを子プロセスへ設定して成功。envファイルやprivateキーはコピー/出力せず、保存/dispatch/editorフラグはOFF。
- **範囲と次工程**: ローカル実装/合成通信/メモリ内DBまで。外部DB/POS/GAS通信、商品保存/削除、本番DB適用、GAS反映、Git stage/commit/push、Vercel反映はしていない。UI変更はなくスマホ/印刷を今回は再検証していない。署名付き保存受付・Node→GAS送信・consume HTTPポート・復旧UIが次工程。旧CSV writer切替、通常PostgreSQL複数接続、実保存/画像保持も未完了であり、本番利用可能とは扱わない。

## 2026-10-04 続行: P2f1署名付き保存通信・専用consume API（ローカルのみ）

- `gas/posProductEditGateway.js`は専用フラグOFFで通信せず、既存署名protocolのdispatch限定・操作/actor/店舗/固定期限を確認してprivate実行器へ渡す。consumerは専用鍵・固定URLへ1POSTだけ送り、30秒期限・正確な要求/応答キー・相関・応答署名を確認してからreceiptを返す。GAS公開doPost/トリガーは変更していない。
- Nodeの `consume-protocol.server.ts` / `consume-handler.server.ts` / `/api/pos-products/consume` を追加。専用audience/鍵で操作/actor/店舗/dispatchHashと30秒期限を署名し、DBの本人店舗manager再検査を伴う4引数consume RPCだけを1回呼ぶ。応答も今回の要求署名へ束縛し、再配送でtrueを再掲しない。既定OFFは503/no-store、認可拒否/署名不一致/通信断/未知DB応答では固定失敗を返し、例外本文を出さない。
- Cookieログイン除外はこのAPIの完全一致POSTだけ。GET・末尾slash/下位path・商品/棚卸し画面は従来認証を維持する。共有Google通信helperは一回の署名POSTと既知Google結果URLへの本文なしGETだけ。既存inspectの8回帰テストも成功し、保存本文/秘密鍵を外部転送しない。
- `dispatch-transport.server.ts`は保存済みcommand本文・hash・期限・変更前/期待結果・候補を再検査し、外側署名の期限も元の期限と一致させる。既存16KB payload上限を超える場合は送信前に拒否。実行器が持つoutcome/code/flagsだけを受け付け、values_verifiedは新しい両検索DTOを既存decoderで店舗/JAN/内部ID/期待値と照合する。通信失敗でも再送せず、観測値一致をDB完了や保存commitとして扱わない。
- 独立レビューで、Node RPC/GAS HTTP待機中に運用OFF・鍵更新・期限切れになっても有効なreceiptを返せる検査不足を再現。NodeはRPC後にも3フラグ/鍵/安全時刻/期限、GASはconsumer実行前と応答後にフラグ/鍵/URL/期限を再確認するようテスト先行で補強。commit済みでも不明結果なら再消費/再送せず、後の固定記録照合で解決する。再レビューで追加指摘なし。
- 新規通常35件（consume6/GAS gateway16/dispatch transport13）、DB接続1件成功。全回帰324/327（以前からの棚卸し静的検査2件・Sentry/CMS秘密情報検査1件が失敗）、DB49/49。実Node HTTP handler→実SQL consume→署名応答→実GAS consumerを両店舗で接続し初回true/再消費falseを確認。通信はVM合成、DBはメモリ内PGliteで、実サービスへの保存や通常PostgreSQL複数接続の証明ではない。
- 独立型・対象6ファイルLint・本番build26/26・GAS構文・差分空白検査成功。全体Lintは同じ既存3 errors/5 warningsで未解消。ローカル本番サーバーを127.0.0.1だけで起動し、実HTTP POSTでOFF時503/リダイレクトなし/no-store/固定コードを確認した。起動時はfixture公開設定だけ・全新機能フラグOFFで、実資格情報を使わず、検証後停止した。
- **範囲/残件**: 本番DB・GAS反映・実POS保存/削除・Git stage/commit/push・Vercel反映は行っていない。画面/UIは未変更のためスマホ/印刷を今回は再検証していない。P2f2でmanager保存制御（固定記録→claim一度→送信→独立照合→DB反映）と送信不明時の復旧Action/UIを接続する。旧CSV writer停止/切替、通常PostgreSQL複数接続、実保存/画像保持のgateも残し、本番利用可能とは扱わない。

## 2026-10-05 続行: 保存制御・復旧UIと本番前監査

- `edit-execution.server.ts` とprepare/save/recover Actionを接続。認証済みmanager・店舗・商品・JAN・固定台帳を再検証し、新規送信はclaim一度だけ。成功応答の観測値だけでDB反映せず、独立POS再読取りと消費記録を照合する。応答不明は同じ操作の読取り復旧へ進み、再送しない。DB反映応答消失も先に状態を照会する。
- 認可await後のフラグ停止を再現テストで修正。GASの公開doPostは専用設定OFFで拒否し、署名付きinspect/dispatchを厳格に振り分ける。旧段階の「公開経路なし」2テストは承認どおり署名・設定・対象・再送防止の検査へ変更した。公開入口はローカルのみ、本番v56には未反映。
- UIは操作ID・固定した5項目・公開編集開始指紋・prepare/execute段階をタブ内に保持し、失敗しても入力を戻さない。準備だけの明示再試行と保存を分け、新規送信OFFでも認可済みの照合/DB反映を続行できる。completedまたは送信前の確定rejectedだけ明示closeで復旧情報を解除する。秘密鍵・actor・POS内部ID・Cookie/HTML/hidden状態はブラウザに渡さない。
- 本番非接続のloopback previewをCUAで検証。PCと390×844スマホの正常保存、RPC前の準備失敗→同じ固定入力で準備だけ再試行→別の明示確認で保存、保存応答消失→読取り状態確認→再送なし照合→完了を確認。商品名・200円/100円・同じ操作IDを保持。スマホのdocument幅390px、dialog幅358pxで横はみ出しなし。temporary viewportを戻し、専用previewサーバー/タブを終了した。これは合成データであり実POS保存の証明ではない。
- **本番ON前の未完了条件**: preparedの期限切れ/持続する基準値競合からの監査付き取消、storage3キーの途中書込み/削除・破損・保存拒否からのサーバー照会付き限定解除。結果不明操作のpointer削除・別IDでの再送は救済策にしない。この終端復旧はまだ実装/検証していない。
- 最終通常回帰383/386、既存失敗3件（棚卸し静的検査2件・Sentry/CMS names-only検査1件）は残る。新UI29件、保存Action5件、制御21件、ledger24件、公開GAS10件を含む新規範囲は成功。独立型・対象Lint・差分空白検査成功。全体Lintは既存3 errors/5 warnings、Next本番buildは26ページ成功。印刷コードは変更せず今回再検証していない。
- 本番列型を確認後、sync/apply/dispatch/concurrencyの4 fixtureを金額integer/粗利率realへ一致させ、information_schema型一致と厳密なnumber比較を追加。本番型版PGlite49/49・通常PostgreSQL17.11の13/13成功。専用loopback clusterの独立A/B/observer接続で実ロック待機、同時受付/claim/consume、期限・権限剥奪、同期対編集/旧writer、deadlock rollbackを検証し、生成DBの所有照合後のcleanupとcluster停止を完了。本番DB接続なし。値・監査・予約・棚卸し保持を検査し、今回の型変更に伴う不具合はなかった。
- 上記はNode/GASの重複送信抑止と固定記録の整合を検証したもので、POS側transactionのexactly-once commitや遅延した保存POSTの不在を保証しない。実保存後の再読取り・非対象設定/画像保持・通常同期後の値保持は本番前の検証に残す。
- SupabaseのOAuth state期限切れは通常ログインからやり直して解消。semotomoのkennel_DB/project `wpxewebmezghoulnasre` を確認し、明示BEGIN READ ONLY/ROLLBACKでスキーマ・権限・適用履歴を監査。PostgreSQL17.6、19 migration適用済み、新規5本/台帳等は未適用、店舗6/7と既存認可helper/複合キー/手動停止保持triggerを確認。商品名列はproduct_name、金額/原価integer、粗利率real。
- 指定対象のDB商品は4779/本店7/JAN4582107173062で一意、旧名「95ミツヤ もみじ焼き」、売価199円/原価95円/有効。保存予定は新名「ミツヤ もみじ焼き」、200円/100円。分類/仕入先/非対象設定と棚卸し・在庫は保持する。本番の値はまだ変更していない。
- **旧writer遮断の追加承認待ち**: productsはpublic ALL/trueのRLSポリシーでanon/authenticatedにも直接更新権限が残る。既存GAS/Next.jsの直接upsertを残すと編集後の値を上書きでき、新規5 migrationだけでは防げない。旧経路停止・商品更新権限制限・店舗固定/版管理付きRPC同期切替を提案した。切替中は商品同期だけ一時停止し、売上/入出庫/棚卸し維持を検証する。承認前にRLS/GRANT・旧ジョブを変更していない。
- GASはfresh cloneで既存6ソースと公開版HEAD/11/12/56を確認、新受付/同期は未デプロイ。Vercel Productionはmain ac06232のReadyを確認、編集鍵/新設定は未登録。Git CLI認証は更新が必要で、connectorのdoo-seと所有者semotomoを同一扱いしない。最新DB論理backup・本番migration適用・実POS保存・Git stage/commit/push・Vercel反映は未実施。元ルート/他worktreeのファイルは編集していない。

## 2026-10-06 続行: 旧writer切替・通知・取消復旧と本番退避

- 旧GAS/Nextの商品直接writerを閉じる切替とproducts専用のDB権限制限をローカル実装。table/column/sequenceの直接書込みを失効し、店舗memberのSELECTと認可済み同期/編集/棚卸し停止RPCを維持する。CSV全件取得を証明できないため、欠落JANの自動停止は無効にする。元5本だけではなく、取消・通知・権限切替・署名同期受付を加えた新9 migrationが対象。
- 固定6/7店舗の設定と専用署名/audienceでNext→GASの受付を束縛。要求UUIDにつき開始は一度だけ。応答不明は再送せず同じrunを照会する。旧requestなしのrunも、同じUUID/店舗の実記録だけ照会対象にでき、入力だけで閉じた受付を復活させない。CSVの既知検証拒否と不明応答を区別し、診断dryRunから重複原因の件数だけを返す経路も実関数で検証した。
- 手動同期は正規の同一Origin・本人認証・対象全店舗managerを送信前に検査。拒否理由/未変更/次の対応を表示し、自動失敗は永続通知へ保存する。全店失敗/部分失敗で成功や最終成功時刻を偽らない。結果不明は変更済みの可能性を明示し、再送しない。適用成功と通知だけの保存失敗も区別する。未通知pendingを状態確認で検出し、同じrunの適用/未適用が確定した場合は当時の通知を残して確認済みと表示する。
- prepared/send0だけの本人manager取消と監査/予約解放を原子的に実装。未作成IDへも取消記録を残し遅延prepareを拒否する。破損storageは元UUID/店舗/商品を照会できた場合だけ限定解除し、不明/混在/送信済みは凍結を維持する。別IDでの再送を復旧策にしない。
- 新9本を既存inventoryと組み合わせたDB84/84、通常PG17.11の別backend/実ロック待機付き競合21/21が成功。手動Origin拒否を追加後の通常回帰419/422は同じ既存3失敗だけ。独立型・対象Lint・26ページ本番build・差分検査成功、全体Lintは既存3 errors/5 warnings。純粋UI合成previewでPC/390pxスマホ通知を確認し、358pxカード・document幅390px・横はみ出しなし。viewport/専用server/tabは終了した。印刷コードは変更せず今回は再確認していない。
- Supabase CLIの読取り専用接続を確認し、10/6 02:49 JSTに対象17テーブル/公開private定義/ACL/19履歴を単一READ ONLY/REPEATABLE READ snapshotで退避。10,488,816 bytes、SHA-256 `6f52fd19cf3553485c5d07b5822a07909006d61dcc295b2ccc372d6356ffa957`。商品6,568、棚卸し明細6,544、移動505、店舗権限6行。PGliteでchecksum/型/NOT NULL/主キー/全行全列一致を確認。関数/RLS/Auth/外部FKを含む完全DB復元試験ではない。本文はGit対象外のlocal_exportsだけに保持した。
- GASのkirikan22アカウント/対象scriptを確認し、現行6ソースを `local_exports/gas-pre-cutover-09c4071d242649efa37a3093525fdcbb` へ再取得。form SHA-256は前回値と一致、公開版HEAD/11/12/56は不変。現行manifest保持の12ファイル候補を `local_exports/gas-release-candidate-a4ba14c952374e079995b5e045785754` に準備、11script構文と共有109関数の衝突なしを確認。Vercel画面でもProduction Ready/main ac06232を再確認し、新設定未登録を変数名だけで確認。401だったGit CLIはユーザー再認証後にsemotomo/push/admin/main ac06232を確認。対象商品4779は旧名/199円/95円/有効のまま。
- **残る本番前条件**: 実CSVの重複/商品区分/金額/取込み範囲、旧writer/稼働ジョブの停止順、専用キー・固定店舗設定の登録、対象差分の最終承認/適用と段階有効化。商品名/200円/100円の実保存、保存後の非対象設定/画像、再同期後の保持は未検証。本番migration・GAS公開反映・Git push・Vercel反映・実POS保存は未実施。元ルート/他worktreeの未コミットファイルは混入していない。
- その後のGit続行: 再認証semotomo/push/admin/main一致を確認後、taskの117ファイルだけをe30300dにcommitし、codex/pos-product-managementへpush。stage差分の空白検査と追加行の実tokenパターン検査も実施（該当0、一般的なtoken検査であり全秘密情報不在の証明ではない）。local_exports/実env/元ルートscratch/別worktree petsSyncは含めていない。GitHub Vercel status成功、画面でもPreview/Ready/同じcommitを確認。URLは `https://antigravity-744nrym2s-semotomos-projects.vercel.app/`、deployment CDEC56xnGqXanr5bxLDthXcFPaSJ。本番main/Production、GAS公開版、DB、指定商品は変更していない。

## 2026-10-06 設定保存後: 所有者エディタ専用のCSV診断

- 本人がGAS Script PropertiesとVercel Production Secretへservice_role鍵と用途別3鍵を保存。値を取得せず、登録名と保存済み状態だけを確認。新しい書込み/同期フラグは未登録で既定OFF。Previewに専用鍵があるとは扱わない。
- `diagnoseHontenProductMasterReadiness`はWeb App/トリガーへ接続しない。書込みフラグOFF、3鍵の64桁小文字hex/相互独立、service鍵の存在、既知POS URLと明示本店グループ11098を検査してから既存dryRunを実行する。返却/最終ログは固定stage/code・boolean・件数だけ。CSVサンプル/JAN/商品値/例外原文/資格情報は出さない。列3/7の統計、行幅、店舗一致、重複分類を確認し、診断成功を同期許可と扱わない。
- 新規8件と関連回帰35/35、全回帰427/430成功。既存3失敗（棚卸し静的regex2件、Sentry/CMS検査1件）を維持。12script構文/共有114関数衝突なし/差分検査成功。Next/DB/UIは変更せず、直前の型・対象Lint・本番build・DB競合・スマホ検証結果を継承する。
- 最新ソース退避 `local_exports/gas-pre-inspection-20261006-b72e16a1` の6ファイルを保持し、manifest変更なしで13ファイルをGAS HEADだけへ反映。反映後の別フォルダ `local_exports/gas-post-readiness-upload-20261006-c42d8d6a` へ再取得し、13/13 hash一致。公開HEAD/11/12/56の版一覧は不変。既存月次売上トリガーは維持し、所有者の一覧に商品マスタ定期トリガーはなかった。他所有者や外部旧writer全停止の証明ではない。
- 所有者エディタで診断を実行し、`READINESS_CSV_INSPECTED`を確認。書込みフラグOFF、GAS3鍵の書式/相互独立とservice鍵存在はすべてtrue。本店のみ3,970行・全行12列、旧パース有効3,928/skip42。列3は非空3,958/一意3,928/JAN形式3,944、列7は非空45/一意44/JAN形式0。区分1が8行、区分2が3,962行。重複20群/余剰30行はすべて内容不一致・区分混在0。差異列は4:1群、5:1群、6（商品名）:20群、7:1群、8（売価）:8群、9:1群、11（原価）:12群。JANなし12、短行/不正金額0。GAS鍵の確認はVercelとの一致やservice鍵の有効性の証明ではない。
- **同期ONの停止条件**: 新しい厳密同期は上記20群を拒否する。区分だけを絞っても今回は解決せず、先勝ち/後勝ちや名称・金額の推測採用はしない。旧パースの有効件数は同期可能な件数ではない。重複の実POS内部IDと意図した商品対応を追加確認してから切り替える。
- 続行で`duplicateProfile`を追加し、元コードの完全一致対正規化由来・区分・群サイズ・各変換の影響を件数だけで検査。関連37/37、全回帰429/432（同じ既存3失敗）、GAS構文/共有関数衝突/差分検査成功。最新13ファイル退避 `local_exports/gas-pre-duplicate-profile-20261006-ae10c3e7` は直前HEADから変更なし。候補差分はautoDownload/readinessの2ファイルのみ、再反映後13/13 hash一致、公開v56不変。
- 実診断で店販区分2の衝突20群、群サイズは2行19群/12行1群、元コード完全一致20群、正規化由来0群、空白/全角/末尾.0の影響各0群を確認。表記補正や区分混在は原因ではない。一方、CSVに内部商品IDがあると証明できておらず、この結果だけで別商品IDと断定しない。POSの出力項目と候補内部IDの読取り確認が残る。確認用のPOSタブはセッション切れで保存済み情報も未入力のため、本人へログインを依頼。資格情報はチャットへ求めない。
- 本番DB適用、公開GAS切替、新書込み/同期ON、main push/Production更新、指定商品の実保存はまだ行っていない。

## 確認した一次資料

- [Apps Script Utilities](https://developers.google.com/apps-script/reference/utilities/utilities): UTF-8を明示したHMAC-SHA256/ダイジェストAPI。
- [Node.js Crypto](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b): HMAC計算と固定長署名比較。
- POS実画面のscript参照で確認した `hmma024.js?ver=2` / `hmma02401.js?ver=2`: 店販選択と店舗切替のAjax処理。取得・読取りだけで実行や改変はしていない。

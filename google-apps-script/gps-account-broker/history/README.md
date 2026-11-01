# 無料GPS履歴バックエンド：合成試験限定で公開済み

本人承認後、既存GASデプロイをバージョン3（2026/11/01 8:55）へ更新済み。同じURL/実行者/全員アクセスを維持。実GETのrevision=history-v3/historyTrialOnly=trueを確認し、公開試験ページから実Google本人で合成履歴の保存・全内容照合・削除・墓標確認が成功した。公開ソースはここにあるCode.candidate.gsで、親Code.gsは版2の本人連携部を生成に再利用する基盤。

## 構成

- History.gs: GPS専用Firestore RESTの履歴保存/本人再取得/一覧/墓標/監査先行の管理者閲覧・CSV/削除/本人CSV監査/期限整理。
- Code.candidate.gs: 公開中の本人連携ソースと、既存のfunctions/gps-history-validation.jsの**同じ検証実装**とHistory.gsをまとめた生成物。第二の距離/料金計算は作らない。
- 再生成: `node scripts/build-gps-history-gas.js`。公開中の親Code.gs/manifestを上書きせず、本番へ接続しない。

候補は `GPS_HISTORY_TRIAL_ONLY_=true` 固定。実履歴の保存/読取は拒否し、`shift-<時刻>-gastrial<UUID>` の固定1点（緯度0/経度0/精度1/速度・方位なし/区間1）の合成データだけを扱う。クライアントがフラグを送っても解除できない。整理関数はこのモードでは実行不可。Webのaction一覧にも整理関数を含めない。

## 認証・保存・監査

毎回、日報/GPSの両tokenの本人一致、actorUidとGPS本人UIDの一致、日報側の現在資格、GPS側の期限付き対応を確認。クライアントの管理者フラグを採用しない。操作の前/commit前/応答前にも日報資格を確認し、管理者操作は現在の管理者資格も要求する。別プロジェクト間の同時原子更新や変更通知ではないため、日報側で停止した瞬間の完全な即時取消は保証しない。

Firestoreは固定GPSプロジェクトのgpsHistory/gpsHistoryTombstones/gpsHistoryAuditだけを読み書きする。所有者OAuthを日報に送らず、日報の資格読取は本人tokenだけ。全拒否ルールを開放せず、GASが同じ既存datastore権限で操作する。

履歴は共有検証・SHA-256を照合し、既存原本の上書きを拒否。保存後の全点列も読戻し/ハッシュ照合する。監査保存のcommitと読戻しが失敗したら他者の座標を返さない。削除は監査/墓標/原本削除を1つのFirestoreトランザクションで行い、墓標のある履歴の再送を拒否。応答消失時の同一再送と削除再要求も扱う。

## 検証

```sh
node scripts/build-gps-history-gas.js
GPS_HISTORY_GAS_TEST=1 node scripts/run-gps-emulator-tests.js
node --test tests/gps-account-bridge.test.js tests/gps-firebase-project.test.js tests/gps-cloud-policy.test.js
node tests/gps-account-ui.browser.cjs
```

Node22/Java17、依存と実行環境のパスはtests/gps-tools/README.md。Firestore RESTトランザクションは実Emulator、Google本人/token/日報資格は合成。実GAS/IAM/ブラウザ通信で固定1地点の保存・読戻し・削除は確認済み。実履歴/他者閲覧/13時間量の実GAS通信/APIの応答時間上限/無料枠の実使用量は未検証。

8件の実REST試験で本人保存/監査前失敗/監査読戻し失敗/停止/降格/別人・actor不一致/期限/ハッシュ/削除と応答消失/再送防止/CSV監査冪等性/整理対象分離/13時間1560点を確認。全機能の回帰時だけVM内の合成限定フラグをfalseへ変更し、最後の試験は公開候補と同じtrueで実履歴拒否と固定合成データだけの保存を確認する。公開候補のフラグはtrueのまま。

最初のREST単件取得＋transactionはEmulatorでタイムアウト。ローカルcurlのプロキシ除外だけでは解消せず、公式batchGet＋transactionへ実装を変更して成功。8秒の試験側通信上限は成功判定を緩和していない。

## 適用結果と未完成部分

- 既存試験ページの合成確認ボタンを本人承認後に限定公開済み。明示操作で固定1点を保存→読戻し→全内容ハッシュ照合→その試験履歴だけ削除→墓標確認を行う。測位や日報/端末履歴の取得はしない。失敗時は同じ試験IDと段階を保持して再操作するが、ページ再読込後の自動復旧はない。
- 既存gps-history-sync/管理者履歴画面の通常データ経路はまだFunctions/Firestore方式であり、この候補への本統合は未完了。GPS UIDと日報UIDを区別する端末履歴の接続も残る。
- GAS更新と試験HTML/本人連携3JSの限定公開、合成履歴1件の作成/削除は承認済み・適用済み。mainコミット38c1a4cb2f58fc63708340bb048a64098b0dc7c9。具体的対象/結果/切戻しはdocs/gps-history-gas-trial-review-20261101.md。この適用の再承認は不要。
- GPS送信停止、無料Spark、全拒否ルールは維持。実履歴の送受信/管理者による実履歴閲覧/実データ削除は今回の公開対象外。
- 期限整理のコードは実装・Emulator検証済みだが、GASの03:00 JSTトリガーは未作成。公開候補では整理実行自体も拒否。監査の90日期限はデータ/閲覧に反映するが、物理削除の定期実行は未有効。3時ちょうどの実行保証は未検証であり、既存Schedulerを無料で有効化できた意味ではない。

公式仕様: [batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet)、[commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit)、[Write](https://firebase.google.com/docs/firestore/reference/rest/v1/Write)、[list](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list)。


## 次の未公開候補：通常アーカイブ接続

`Code.archive-candidate.gs` は通常履歴を扱うAPIへの更新候補。公開中の合成限定Code.candidate.gsとは別に生成する。通常版でも整理実行は無条件拒否のまま。新しい公開/実データの扱いは [通常履歴レビュー](../../../docs/gps-history-archive-review-20261101.md)の承認対象であり、現在の公開版3は変更していない。

`gps-history-gas-adapter.js` と既存gps-history-sync.jsのcreateGasで、端末の日報UIDとクラウドGPS UIDを分けたまま既存履歴欄へ接続する。GPS送信/新規測位は停止したまま、既存本人履歴の手動操作だけを扱う。Node58件、実DOM/実IndexedDB＋合成Auth/GAS、実REST Emulator10件が成功。後者の結合はfake-indexeddbと実クライアント/GAS VMを使い、Google認証/日報資格だけは合成。管理者画面/実通常履歴/実端末は未完了。

管理者画面の次候補は `Code.manager-candidate.gs`（history-v5-admin、未公開）。`Admin.gs`の管理者限定利用者一覧を追加する。既存版3/公開版4の候補は保持する。次の限定公開と復旧範囲は `docs/gps-history-admin-review-20261101.md`、作業結果は `WORK_HANDOFF.md`第24節。今回の検証はNode45件、実DOM＋合成Auth/GAS、実REST Emulator11件成功。新一覧/管理者画面の実Google/GAS/IAMは未検証。

# 無料GPS履歴バックエンド：未公開の合成試験候補

公開中は親ディレクトリのCode.gsによる本人連携版2。ここにある候補はまだApps Script/試験ページ/mainへ反映していない。

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

Node22/Java17、依存と実行環境のパスはtests/gps-tools/README.md。Firestore RESTトランザクションは実Emulator、Google本人/token/日報資格は合成。実GAS/IAM/本番履歴/API応答時間/無料枠の実使用量は未検証。

8件の実REST試験で本人保存/監査前失敗/監査読戻し失敗/停止/降格/別人・actor不一致/期限/ハッシュ/削除と応答消失/再送防止/CSV監査冪等性/整理対象分離/13時間1560点を確認。全機能の回帰時だけVM内の合成限定フラグをfalseへ変更し、最後の試験は公開候補と同じtrueで実履歴拒否と固定合成データだけの保存を確認する。公開候補のフラグはtrueのまま。

最初のREST単件取得＋transactionはEmulatorでタイムアウト。ローカルcurlのプロキシ除外だけでは解消せず、公式batchGet＋transactionへ実装を変更して成功。8秒の試験側通信上限は成功判定を緩和していない。

## 未完成・次の承認

- 既存試験ページの合成確認ボタンは開発ブランチだけ。明示操作で固定1点を保存→読戻し→全内容ハッシュ照合→その試験履歴だけ削除→墓標確認を行う。測位や日報/端末履歴の取得はしない。失敗時は同じ試験IDと段階を保持して再操作するが、ページ再読込後の自動復旧はない。
- 既存gps-history-sync/管理者履歴画面の通常データ経路はまだFunctions/Firestore方式であり、この候補への本統合は未完了。GPS UIDと日報UIDを区別する端末履歴の接続も残る。
- 公開後の合成確認には、GASの既存デプロイ更新と試験HTML/本人連携3JSの限定公開、合成履歴の作成/削除の承認が必要。具体的対象と切戻しはdocs/gps-history-gas-trial-review-20261101.md。
- GPS送信停止、無料Spark、全拒否ルールは維持。実履歴の送受信/管理者による実履歴閲覧/実データ削除は今回の公開対象外。
- 期限整理のコードは実装・Emulator検証済みだが、GASの03:00 JSTトリガーは未作成。公開候補では整理実行自体も拒否。監査の90日期限はデータ/閲覧に反映するが、物理削除の定期実行は未有効。3時ちょうどの実行保証は未検証であり、既存Schedulerを無料で有効化できた意味ではない。

公式仕様: [batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet)、[commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit)、[Write](https://firebase.google.com/docs/firestore/reference/rest/v1/Write)、[list](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list)。

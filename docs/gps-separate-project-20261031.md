# GPS専用Firebaseへの分離（2026-10-31）

## 本人の最新決定

GPSだけ別Googleアカウントの既存TAXIGPSプロジェクトへ分離する。日報は現行のまま。Sparkを維持し、Blaze/請求先登録/有料Functions/Schedulerを有効化しない。旧「分離は未採用」の記録はこの決定で更新する。

## コンソールで実施・確認したこと

- 本人操作後の管理画面で、TAXIGPS / `taxigps-9f82e` のログイン成功とSpark（無料・月額0ドル）を確認。CLI認証の成功ではない。
- 未登録だったWebアプリを `TAXIAPP GPS` の名前で登録。appId: `1:330658753332:web:b55d2e136ca2cf618ad361`。Hostingを同時設定していない。
- Standard Firestoreの `(default)` を `asia-northeast1`（Tokyo）に作成。バックアップ/課金アップグレードなし。本番環境モードの初期ルールで作成し、ルール画面の本文が `allow read, write: if false;` であることを確認した。利用者データの読書権限はまだ付与していない。
- 本人の追加承認と再ログイン後、公開名 `TAXIAPP GPS`・本人のGPS管理用サポートメールでGoogleプロバイダを保存。**プロバイダ一覧の「Google：有効」を実画面で確認済み**。Spark継続。アプリからの実Google OAuth受入は別工程であり未実施。

## コードに実装した分離

- `gps-firebase-config.js`: コンソールで取得したGPS専用の公開Web設定だけを保存。Analytics/Storageは初期化しない。日報の `firebase-config.js` は変更しない。
- `gps-firebase-project.js`: GPSのprojectId/authDomain/appIdを検査し、日報と同一プロジェクト・設定欠落・別プロジェクトを接続前に拒否。日報のdefault Appを再利用せず、名前付き `TAXIAPP_GPS` Appを初期化する。同名Appが既にあれば実設定の一致を確認する。
- 一般・管理者の両GPS画面で上記を使用するよう変更。SDK/Auth/Firestore/Functionsの引数はGPS Appになる。既存のFunctions呼出しはGPSプロジェクトの未配置サービスであり、無料で使えるバックエンドが完成した意味ではない。
- `gps-cloud-policy.js` は `enabled:false` を維持し、未完成の認証・権限連携でGPS通信が始まらないようにする。本人の日報・端末履歴・未送信データを移行/削除しない。

## 残る実装と公開条件

1. GPS側Googleログイン、専用GASの権限付与と公開は承認後に適用済み。次はGPS側へのelpapityo.github.io許可追加と同一オリジン試験ページ公開への個別承認。[具体的な次の変更](gps-identity-trial-review-20261031.md)を参照。
2. GPS側の認証UIDと日報のUIDを区別する専用GASを公開済み。実GETと未認証/未対応/不正JSONの拒否を確認。本人資格だけの連携ボタンを既存GPS試験画面に実装・合成検証した。**画面公開とドメイン追加、有効な実tokenでの照合/保存/CORSは未完了**。日報本体のdefault Authを変更しない別名認証を用いる。端末履歴/営業状態の本統合は引き続き日報UIDを維持する必要がある。
3. 日報側のdeviceSessionsをGPSのサーバールールから直接参照できない点を解消する。GPS側へ全日報・全設定をコピーする方式は採らない。
4. 監査先行の履歴閲覧/CSV・削除済み再送防止・保存照合・保持期限の既決仕様を守る無料バックエンドを実装・検証する。別プロジェクトでもSparkで7 Callableが利用できるようにはならない。未完成機能を直接読取開放して代用しない。
5. GPS専用ルールをEmulatorで検証してから適用する。公開試験版・実Google認証2名・Galaxy実GPS・操作端末/閲覧端末切替の受入を行い、その後に本体へ統合する。

日報プロジェクト `taxiapp-2b6bd` の認証・本番ルール・営業原本・印刷・料金計算・正式公開には今回変更していない。

## 検証の範囲

- 分離・誤接続拒否・通信前停止のNode試験9件成功。
- 実Chromiumの390px画面で、日報default Appが存在してもGPS Appへ接続する合成試験と、配布設定の停止（Firebase要求0・既存データ維持）が成功。Firebase/GPSは合成。
- SDK12.4・Auth/Firestore Emulator・公式Callable TCP HTTP結合を、GPS名付きAppで再検証。ルール9件＋HTTP結合1件の全10件成功、失敗/スキップ0。これは旧サーバー機能の回帰用であり、2プロジェクト間の実認証/無料バックエンドが完成した証拠ではない。
- 最初のChromium起動はNode24の `/tmp/fonts` chown EINVALで失敗。既存Node22.23.4を使って成功。最初のHTTP回帰はテスト末尾のdefault App参照で失敗し、テスト側の2箇所を `getApp('TAXIAPP_GPS')` に訂正して再実行後に成功。本番を使った試験ではない。

## 再実行

```sh
node --test tests/gps-firebase-project.test.js tests/gps-cloud-policy.test.js
NODE_PATH=/workspace/scratch/06ce2f7bd621/gps-tools/node_modules GPS_CHROMIUM_NPM=1 /workspace/scratch/06ce2f7bd621/gps-tools/node_modules/node/bin/node tests/gps-sharing.browser.cjs
NODE_PATH=/workspace/scratch/06ce2f7bd621/gps-tools/node_modules GPS_HTTP_TEST=1 GPS_CHROMIUM_NPM=1 /workspace/scratch/06ce2f7bd621/gps-tools/node_modules/node/bin/node scripts/run-gps-emulator-tests.js
```

実行環境固有のパス。通常の依存導入手順は `tests/gps-tools/README.md`。公開設定にはEmulator用の接続先や停止解除機能を加えていない。

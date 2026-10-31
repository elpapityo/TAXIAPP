# GPS試験のローカル再実行

Node 22、Java 17以降を使用。本番用の認証情報は不要。既存firebase.json/firestore.rulesを変更せず、demo-taxiapp-gpsのEmulatorを使う。

```bash
npm install --prefix tests/gps-tools
export NODE_PATH="$PWD/tests/gps-tools/node_modules"
node --test tests/*.test.js tests/gps-history-store.indexeddb.cjs
node scripts/run-gps-emulator-tests.js
npx --prefix tests/gps-tools playwright install chromium
node tests/gps-sharing.browser.cjs
```

Playwright配布ZIPを取得できない環境では、npm同梱Chromiumを使用できる。この作業ではこちらで成功。

```bash
GPS_CHROMIUM_NPM=1 node tests/gps-sharing.browser.cjs
GPS_HTTP_TEST=1 GPS_CHROMIUM_NPM=1 node scripts/run-gps-emulator-tests.js
```

最後のコマンドではFirestoreルール/トランザクション9ケースと、Auth/Firestore/HTTP/複数画面の結合試験を実行する。使用するローカルポートは8189（Firestore）、9098（Auth）、5009（公式CallableハンドラのTCP）。静的ファイル用には空きポートを使う。Google本番アカウントへログインしない。

PowerShellでは環境変数を次のように指定する。

```powershell
$env:NODE_PATH="$PWD\tests\gps-tools\node_modules"
$env:GPS_HTTP_TEST="1"
$env:GPS_CHROMIUM_NPM="1"
node scripts/run-gps-emulator-tests.js
```

## 実検証と合成の境界

- 通常の `tests/*.test.js` は追加依存不要。IndexedDB互換ライブラリ・Emulator・ブラウザ試験は上の明示コマンドで実行する。
- Nodeのルール試験はSDK13.1.0/rules-unit-testing6を使用する。SDK12.4を同じNode依存ツリーへ混在させた際にcompat登録不整合が起きたため分離した。ブラウザ試験には `firebase-browser-sdk` 別名パッケージの**実SDK12.4.0配布モジュール**を使い、本体のimport版と合わせる。
- `gps-sharing.browser.cjs` は実DOM/Leaflet/IndexedDB/CSVを使うが、Firebase/GPS/オンライン状態はモック。
- `gps-sharing.network.cjs` は実SDK12.4・Auth Emulatorの実IDトークン・Firestoreの実ルール/トランザクション・Firebase公式Callable HTTP処理を使う。未認証/不正トークン、別UID、操作者UID不一致、送信画面排他、操作端末切替、実通信断と公開設定CAS、入庫後保存・監査・CSV・管理者閲覧/ログアウトを検証する。
- 公式Functions Emulatorはこの環境でUnixソケットのlisten/connectがEPERMとなるため使用できなかった。代わりに**実装済みonCallハンドラをExpressのローカルTCPで実行**する。認可コードやHTTP認証処理をモックに置き換えていないが、Functions EmulatorそのものやCloud Run/IAMの検証ではない。
- GPS座標はChromium Geolocationの合成、可視状態は試験から制御する。GSIタイル画像は試験では外部取得しない。実機GPS・Google OAuth・実タイル・本番費用・Schedulerの成功とは区別する。
- Emulator起動失敗・試験失敗をスキップして成功にしない。ルール候補は `node scripts/prepare-gps-deployment.js` で再生成できるが、このコマンドも接続・デプロイをしない。
# 取得済み本番ルールでの再確認（2026-10-31）

`docs/firestore-production-observed-20261031.rules` はFirebaseコンソールから読取った現行版（星付き2026-10-24 22:41）。コメント/空白を除くトークンはリポジトリ版と一致。候補はGPS差分のみを挿入する。

```sh
node scripts/prepare-gps-deployment.js docs/firestore-production-observed-20261031.rules
GPS_RULES_BASE=docs/firestore-production-observed-20261031.rules node scripts/run-gps-emulator-tests.js
```

NodeとNODE_PATHは下記と同じ環境を使用。本番ベースで9ケース成功。生成/試験は本番へ変更しない。本番の最新ルールは公開直前にも照合する。


## 期限付き本人資格のGPS専用ルール候補（2026-11-01）

```sh
GPS_ACCESS_RULES_TEST=1 node scripts/run-gps-emulator-tests.js
```

同じローカルEmulatorで `docs/gps-identity-access.rules.candidate` と `tests/gps-identity-access.emulator.cjs` を使用。日報ルールを継ぎ足した旧GPS候補とは別の、GPS専用の本人資格だけの候補。4件成功。期限切れ/旧形式/過大期限/未来時刻/管理者降格/本人分離/自己更新拒否と位置等の全拒否を実ルールで検証する。HTTP/GPS/Google認証の成功ではなく、本番未適用。既存の通常Emulator9件も回帰成功。


## 無料GAS履歴候補の実REST検証（未公開）

```sh
node scripts/build-gps-history-gas.js
GPS_HISTORY_GAS_TEST=1 node scripts/run-gps-emulator-tests.js
```

同じローカルFirestore Emulatorで8件成功。VM内のGoogle本人認証/日報資格だけは合成し、GASの同期UrlFetchAppをlocalhostへのcurlに対応させる。GPS固定プロジェクト以外へアクセスしないことを検査し、試験時のURL/リソース名だけdemoプロジェクトへ置換する。実GAS/IAM/本番の成功ではない。通常データ回帰はVMで合成限定を解除し、公開候補と同じ合成限定trueの拒否/固定1点保存も別ケースで検証する。

curlの実ローカル通信は`--noproxy '*'`、8秒上限。最初のtransaction付き単件GETは20秒上限とプロキシ除外後の8秒上限でいずれも失敗。公式batchGetでのtransaction読取へ変更後に8件成功。ルールやTLS検証を緩めた成功ではない。Node41件・既存実DOMの合成履歴確認も成功。公開候補/適用対象/未完了はgoogle-apps-script/gps-account-broker/history/README.mdとレビュー文書を参照。

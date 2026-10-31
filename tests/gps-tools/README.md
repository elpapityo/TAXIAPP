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

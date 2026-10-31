# GPS試験のローカル再実行

Node 22とJava 17以降を使用。既存firebase.json/firestore.rulesを書き換えず、demo-taxiapp-gpsのFirestore Emulatorだけを起動する。本番認証情報は不要。Functionsは実Admin SDKからエミュレータへ接続して `.run()` で呼び出すため、HTTP Callable認証トークン検証とCloud Scheduler実配送は別途未検証。

```bash
npm install --prefix tests/gps-tools
export NODE_PATH="$PWD/tests/gps-tools/node_modules"
node --test tests/gps-sharing-core.test.js tests/gps-sharing-preferences.test.js tests/gps-history-sync.test.js tests/gps-history-operations.test.js tests/gps-history-store.indexeddb.cjs
node scripts/run-gps-emulator-tests.js
npx --prefix tests/gps-tools playwright install chromium
node tests/gps-sharing.browser.cjs
```

Playwrightのブラウザ配布から取得できない環境では、npmに同梱されたChromiumを使用できる（この作業ではこちらで成功）。

```bash
GPS_CHROMIUM_NPM=1 node tests/gps-sharing.browser.cjs
```

ブラウザ試験は実DOM・Leaflet・IndexedDB・ダウンロードを使う。Firebase、GPS、オンライン状態は合成。実アカウントや実測GPSの成功を意味しない。通常の既存CIは追加依存なしの `tests/*.test.js` を継続し、IndexedDB/Emulator/Chromiumは上記コマンドで明示実行する。

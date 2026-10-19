# GPS距離ラボ v0.5.0 — 単一画面検証アプリ

* 本アプリは従来のTAXIAPP、距離管理テスト v0.4.0とは別アプリです。既存のデータ、日報、Firebase、Google Apps Scriptの情報は読み書きしません。
* 本体は `jp.taxiapp.gpsprototype.distancelab`、表示名 `GPS距離ラボ`。旧APKを削除せず並行インストールできます。GPS計測値は旧アプリから引き継ぎません。
* Web UIのHTMLはAPKに同梱したローカル専用ファイルです。外部Chromeへ距離取得の度に移動しません。キーの入力も不要。Androidで正確な位置情報の許可は必要です。
* 上部の「GPS測定を開始」でフォアグラウンドサービスを開始し、停車中に「ここを0kmとして記録」。以降の各「GPS取得」でGPS累計と前回からの距離を取得。
* 1回目を手入力で10km、次のGPS区間が2kmなら自動補正12km、同じ2回目を15kmに補正し次が1.5kmなら16.5km。
* GPS測定中のホームや画面消灯では通知で継続する設計ですが、電波欠測・OS制限はあり、実車走行テストが必要です。
* GPS累計のリセットはWeb側のみ。Androidの計測値を削除しません。日時や住所、ルート情報のクラウド送信は行いません。
* GitHubの `GPS Distance Lab Android v0.5` でテスト・Debug APK・prereleaseをビルド。Debug署名はビルド毎に変わる可能性があるため、旧APKと同じパッケージIDにはしていません。

注意：`distance-console.html` は同一UIを閲覧できるブラウザ用プレビューです。ブラウザ単独では実GPS取得不可。GPS取得を使うにはAPKで開く必要があります。

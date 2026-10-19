# GPS日報統合試験版 v0.3.59（ブランチ限定・本番未公開）

- 統合Android GPS距離ラボ: **v1.3.1 / 0・20・40・60・100km/h**
- パッケージ: `jp.taxiapp.gpsprototype.distancelabv131`
- 通信: `http://127.0.0.1:48768/`（127.0.0.1のみ）
- 接続識別: `GPS_DISTANCE_LAB_DIARY_V1_3_1_100` / `v1.3.1` / 上記パッケージの一致を必須化。
- Android外部ChromeのHTTPS originは `https://elpapityo.github.io` のみCORS許可。Chromeのローカルネットワーク権限は明示許可が必要です。

## データ保護
- 保存領域: `taxiapp-gps-preview-v0359-store` / `taxiapp-gps-preview-v0359`。
- v0.3.58とは**別**のIndexedDB、localStorage、GPS補正キー。
- Google送受信 / ログイン / 双方向同期 / 本番IndexedDBへの書き込み禁止。
- 模擬GPSは**試験ページの明示ON時のみ**受け入れ、本番日報への取り込みは禁止。
- 本番v0.3.57、既存公開試験v0.3.58、PR #70を変更しない。

## 公開状況
このページは専用検証ブランチ内で作成したものです。GitHub Pages本番(main)へのマージはしないため、
`https://elpapityo.github.io/TAXIAPP/gps-preview/v0359/` は**まだ公開されていません**。
ローカル/CI Chromeテストで起動し、実機公開前にGPS精度・同期・印刷・既存日報の保護を確認してください。

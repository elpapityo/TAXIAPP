# GPS距離ラボ v1.2.2：模擬100km/hモード

実際に走行せず、Androidアプリから外部Chromeへの距離取得を試験するため、既存の模擬速度0・20・40・60km/hに100km/hを追加。

- Android画面の3行目に「模擬 100km/h」ボタンを追加。停止中でも押せ、模擬走行中の速度変更も可能。
- SimulatedDriveとGpsTrackingServiceの速度チェックに100km/hを追加し、通常と同じTripAccumulatorで距離を積算する。GPSの実走行計算式や低速ドリフト判定は変更しない。
- Kotlin単体テスト：100km/hで36秒なら約1.000km、停止中は距離が増えない。
- Androidエミュレーター実APKの100km/hボタン→アプリ内HTTP→外部Chrome→GPSチェックポイント→手入力補正→次回取得をE2Eテストする。
- 旧v1.2.1とAndroid debug署名が異なっても共存できるよう、新たなアプリID distancelabv122、ループバックポート48767、ブラウザ記録キーgps-distance-lab-browser-simulator-v122を使用。
- 本番TAXIAPPの日報・顧客・送受信・Google同期処理は変更しない。模擬値は営業記録に混ぜない。

操作：模擬0km/h→外部Chromeで0km登録→模擬100km/h→約36秒待つ→ChromeでGPS取得（約1km）。停止は模擬0km/h。架空走行試験であり実GPS精度は保証しない。

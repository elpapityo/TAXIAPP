# GPS距離ラボ v1.2.1 — 無効なボタンと模擬GPSの権限依存を修正

v1.2では模擬速度0/20/40/60km/hのボタンを`s.running && sim`の条件で灰色にしていたため、ユーザーが先に模擬走行開始を押す必要があった。実GPSを先に起動してしまうと模擬走行開始ボタンも`!s.running`により無効になり、原因も画面上で分からなかった。模擬だけを試すのに実GPS位置情報許可を要求していた。

対策：
- 速度0/20/40/60のボタンを常時操作可能にし、停止中に速度を選ぶだけで模擬走行を起動する。動作中は選択速度へ変更。実GPS測定中の切り替え操作には停止を促すToastを表示。
- 実GPS・模擬開始ボタンも無効化せず、すでに動作中なら理由を説明する。
- 模擬用foreground serviceは`dataSync`タイプで起動、実GPS時のみ`location`タイプを使う。模擬走行開始時の`ACCESS_FINE_LOCATION`許可チェックを撤去し、実GPSの位置は変更しない。
- 速度0で基準0kmを登録→40km/hで走行→外部ChromeでGPS取得→手入力補正→60km/hで再走行→取得→0km/hで完全停止を自動試験する。
- 旧版とのAndroid debug署名・HTTPポート競合・ブラウザlocalStorageの混在防止として、新アプリ`jp.taxiapp.gpsprototype.distancelabv121`・ポート`127.0.0.1:48766`・Chrome保存キー`gps-distance-lab-browser-simulator-v121`。
- v1.1実GPSラボ、TAXIAPP本体の日報、顧客・同期データには変更なし。

操作：v1.2.1アプリの**「模擬 0km/h」**を直接押す→外部Chromeで0km記録→アプリで**「模擬 40km/h」**→30秒ほど待つ→ChromeでGPS取得。停車中は模擬0km/hを押す。

実車のGPS精度は検証対象外。端末環境での操作はAndroidエミュレーター試験合格後に依頼する。
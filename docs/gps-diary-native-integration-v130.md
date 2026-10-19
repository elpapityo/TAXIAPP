# TAXIAPP 日報距離欄とAndroid GPS距離ラボを直接接続する検証版（v1.3.0）

## 目的
以前のHTML統合版はGPS取得ボタンが存在していたが、GPSを取りに行く先は旧版の127.0.0.1:18765/gps（認証キーあり）だった。新しいv1.3.0では、エミュレーターで0km・GPS区間・手入力補正が成功したAndroidループバックWeb通信を維持しつつ、**日報本体をGitHub PagesのHTTPS originのまま**運用する。

## 距離欄と適用場所
|場所|対象|
|---|---|
|出庫|現在の車両トリップ値を出庫記録した後でAndroidのGPS累計とrunIdを基準へ保存。車両トリップの初期値は勝手にGPSへ変更しない|
|待機|待機中の走行距離の横に「⌖ GPS距離」。位置取得「⌖ 現在地」とは別|
|迎車先到着・乗車|RAW F、既存の⌖ボタン|
|降車|RAW L、既存の⌖ボタン|
|実車高速入口・出口|RAW S/V、既存の⌖ボタン|
|空車高速入口・出口|RAW AB/AE、既存の⌖ボタン|
|入庫|入庫走行距離「⌖ GPSで入庫距離を取得」ボタン。入庫確定ボタンを押す前のみ|
|GPS再起動後|出庫・入庫画面「GPS基準の再設定」に現時点の車両トリップの**実測値**を入力してGPS基準を登録|

**既存派生列X/Y/AJ/AKは入口・出口の車両トリップ値から自動計算。金額・割引・決済・GO/Uber手数料の計算は変更しない。**

## 技術方式
- Chrome本番日報は従来の`https://elpapityo.github.io/TAXIAPP/`。originを変更しないためブラウザのIndexedDB／保存日報／Google同期が別物にならない。
- 新APK`jp.taxiapp.gpsprototype.distancelabv130`は`127.0.0.1:48767`に限定してGET`/api/status`とGET`/api/capture?target=start&nonce=...`を公開。Android foreground serviceのGPS累計を返す。APIは日報の編集・保存を直接行わない。
- HTTPSの本番Origin `https://elpapityo.github.io`**だけ**にCORSを許可。Chromeのプライベート／ローカルネットワークのプリフライトOPTIONSにも適切に応答。その他のOrigin、ホストを拒否する。ブラウザ側のLocal Network Access許可はChrome側ポリシー・ユーザー設定に依存する。
- 日報`gps-diary-bridge.js`でGETを行い、nonce・時刻・GPS走行ID（runId）・欠測・距離を検証。誤ったセッションからの距離転記を拒否する。模擬走行は**営業日報に一切転記しない**（read options allowSimulationを標準false）。
- **出庫IDごとにGPS補正基準を端末ブラウザのlocalStorageへ保存**。手入力を行った直後に新GPS地点を取得できた場合、その実GPS累計を車両トリップ実測値へ再設定し、以降は増分のみ加算。
- 取得中に他の乗務・営業・操作権・手入力値が変化した場合は反映しない。操作可能な端末以外から距離欄へ書き込まない。
- エラー時に既存手入力を消さない。外部Chromeで日報を開いたまま、GPS取得時の別タブ作成やディープリンク往復をしない。
- APKはv1.2.1の模擬テスト版・v1.1の実GPS試験版とは別アプリ／別ポート。旧アプリを強制削除しない。
- **本番の日報データとGoogle送信に触れない**検証ブランチで作業を進める。統合テスト後に安全確認してからメインへの反映を判断する。

## 受入試験
1. ブラウザJSモジュールで出庫GPS開始 → 0.300km走行 → 車両トリップ実測0.350kmへ補正 → GPS0.300km増分で0.650kmになる。
2. runId変更時に旧補正を拒否。異なる乗務IDとの距離混在なし。
3. 模擬GPSなら本番日報への距離取得を拒否。
4. Android HTTPのOrigin制限、OPTIONSプリフライト、ループバックHost制限を検証。
5. GitHub Pages originからAndroidエミュレーター内のGPSポートへ**実際のChrome fetch**を実行し、CORSの成否を報告。Chrome権限の許可に依存する場合は「未確認」と分ける。
6. タブの増加、古いHTMLキャッシュ、手入力欄の無断上書きを禁止。
7. 実GalaxyでのバックグラウンドGPSの長期精度は、別途実走行テストが必要。

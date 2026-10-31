# 次に適用するGPSログイン許可と同一オリジン認証試験

## 確認済みの現況

- 既存公開先 https://elpapityo.github.io/TAXIAPP/ はTAXIAPP v0.3.227のログイン画面とブラウザで確認。READMEの条件付きURLを現況の証拠にしない。
- TAXIGPSの承認済みドメインはlocalhost / taxigps-9f82e.firebaseapp.com / taxigps-9f82e.web.appの3件。elpapityo.github.ioは未登録。
- GPS専用GASは2スコープ付与・バージョン1公開・実GET応答・未認証/未対応/不正JSONの拒否まで確認。有効な実Google tokenでの本人連携・対応表作成は未実施。
- 既存GPS試験画面へ明示操作の本人連携ボタンを実装・合成検証。位置共有/履歴送信の停止は維持。main/本体index.html/日報設定・原本への反映なし。

## 今回だけ承認が必要な具体的変更

1. **TAXIGPS側Authenticationの承認済みドメインへelpapityo.github.ioを1件追加。** 既存3件は維持。ホスト単位であり、/TAXIAPP/というパス単位の設定ではない。任意のgithub.io全体を指定するものではない。日報側のAuthentication設定は変更しない。
2. **既存公開先にGPS認証試験ページと依存ファイルだけを公開。** URLは `/TAXIAPP/gps-sharing-test.html`。本体index.htmlや通常の日報UIへリンクを追加せず、PR #223全体を完成扱いして有効化しない。

## 公開するファイル

gps-sharing-test.htmlと以下13依存ファイル。既存firebase-config.js / device-session.jsは上書きせず参照。適用直前に最新mainのSHA・内容を再照合し、取得済み54a3013を無条件に上書きしない。

- gps-firebase-config.js
- gps-firebase-project.js
- gps-account-config.js
- gps-account-bridge.js
- gps-account-ui.js
- gps-cloud-policy.js（位置/履歴送信enabled:false）
- gps-sharing-core.js
- gps-history-store.js
- functions/gps-history-validation.js（ブラウザ用の形式検査。Functions配置ではない）
- gps-history-sync.js
- gps-presence-sender.js
- gps-sharing-preferences.js
- gps-sharing-test.js

## 操作・送信する情報と限界

- 起動だけではFirebase SDK/認証/本人連携を開始しない。「Googleで利用者を連携する」の明示操作後に開始。
- 日報側は別名App TAXIAPP_GPS_DIARY_IDENTITYで認証し、本体default Authをログイン/ログアウトしない。GPS側も別名App。同じGoogle本人でも2つのUIDを区別。
- 日報とGPSで同じGoogle本人を選択。承認済みGASへ2つの短期tokenをPOST本文だけで送り、日報本人資格を確認し、GPS側へ最小のUID/資格対応表を作成。読戻し一致後だけ成功。
- **閲覧資格の連携だけ**。日報/GPSの操作端末を取得/奪取せず、日報原本・売上・印刷・距離・GPS履歴を変更しない。測位/位置送信/履歴送信を開始しない。
- 実Google tokenでのAPI/Firestore成功・CORS・2人の受入はこれから。成功証拠までは未検証。GPS本体機能や無料の履歴/監査バックエンドの完成ではない。

## 費用と切戻し

課金プラン・請求先・有料Functions/Schedulerを有効化せず、GPS側SparkとGAS利用枠で試験。資格確認では日報側の本人資格を少量読み、日報利用枠の消費が完全に0になる保証ではない。

切戻しは新規試験ページ/連携設定を無効化し、追加GPSドメイン1件を外す。既存ドメイン・本体UI・日報・印刷・実営業原本の切替は不要。GPS対応表ができても自動削除しない。GASは必要に応じデプロイ無効化可能。

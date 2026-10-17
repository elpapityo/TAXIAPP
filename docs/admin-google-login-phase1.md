# TAXIAPP：Googleログイン導入・管理者先行移行（第1段階）

## 守るもの
- 本番の `index.html`・Apps Script・既存のスプレッドシートを変更しない。
- IndexedDB `taxiapp-store-v1` の `state/taxiapp` と localStorage `taxiapp-v1` は読み取りだけ。既存の乗務、GPS、設定、Google接続キーを**移行しない・削除しない・送信しない**。
- 旧Google Apps Script の `TAXIAPP_WRITE_KEY` を一般利用者へ共有しない。秘密キー、サービスアカウント秘密鍵、OAuth client secret、Drive更新トークンをGitHubへ登録しない。
- このブランチのログイン画面は**認証動作の確認用**。旧 `index.html` の利用制限が有効になったことを意味しない。

## 先行実装
- `login.html`：ログイン画面、利用状態確認、同一ブラウザの旧データ件数確認。
- `login.js`：Firebase Authentication の Googleポップアップ認証、Firestore `admins/{uid}` と `users/{uid}` の読み取り。
- `login-core.js`：管理者・利用者状態判定、旧モデルの件数集計。
- `firebase-config.js`：未設定。FirebaseのWeb用設定をユーザーが確認後に反映する。Web用apiKeyは**秘密キーではない**が API キーの制限は検討する。
- `firestore.rules`：未承認の操作をすべて拒否。利用者・管理者の登録・編集はクライアントに許可しない。

## 初期設定（Firebaseへの接続ができたら）
1. [Firebase Console](https://console.firebase.google.com/) で **TAXIAPP専用**プロジェクトを用意する。既存の別システムのプロジェクトと混ぜない。
2. Authentication → ログイン方法 → Googleを有効化し、承認済みドメインに `elpapityo.github.io` を登録する。
3. Firestore Database を作成する。**テストモードで公開しない**。本ブランチの `firestore.rules` を設置し、公開する。
4. プロジェクト設定 → マイアプリ → ウェブアプリを登録し、Firebase Web設定値（`apiKey`, `authDomain`, `projectId`, `appId` など）を取得する。これはFirebaseの**ウェブ公開設定**であり、Apps ScriptやGoogle Driveの秘密キーではない。
5. `firebase-config.js` の `null` を `{ apiKey: '...', authDomain: '...', projectId: '...', appId: '...' }` に置き換える。**本番へ反映する前に**ログイン画面をGitHub Pagesと同じドメインでテストする。開発ブランチは通常のPages公開先には反映されない。
6. 管理者本人がGoogleログインし、画面に表示された **UID** を確認する。まだこの時点では管理者ではない。
7. Firebase Console → Firestore → `admins` コレクション → UID をドキュメントIDとして作成し、フィールド `enabled`（boolean）を `true` に設定する。**これは管理者自身による手動の初期権限付与**であり、画面から権限を与える機能は存在しない。
8. 再ログイン後「管理者登録を確認しました」が表示されたことを確認する。**この後でも旧アプリのログイン制限はまだ未実装**。

## 今後の接続・移行で必要な実装
1. 招待コードのサーバー側検証（招待コードをGitHubに書かない）、オプチャネームとGoogleのメール/UIDの対応記録。
2. 管理者からの停止・再開。オプチャの退会を管理者が確認した場合に手動で停止。停止してもデータは保持。
3. 新しいアプリ本体をログイン必須に変更し、Firestore Rulesで`users/{uid}`および`admins/{uid}`の権限を厳密にチェック。**既存公開URLを保護したと誤認しない**。
4. 既存日報を旧端末・Google同期から読み取り、件数・日付・金額・乗務IDを検証。まず暗号化バックアップを取得し、**本人の操作で**重複・競合を解決してから本人UIDの領域にコピーする。照合前に旧データを消さない。
5. 保存ファイルは所有者のGoogle Drive内 `TAXIAPP_利用者データ/01_利用者別/{uid}` を基本とし、オプチャネームの変更に左右されない。利用者にDriveフォルダーを共有しない。APIバックエンドでIDトークンと利用状態をサーバー側で検証し、UIDのフォルダーだけ操作させる。Googleドライブへの書き込み権限は**所有者が別途安全に付与する必要**がある。
6. 同期の衝突と停止ユーザーのアクセス拒否、請求予算通知、バックアップの復元試験を実施。管理者本人で実機確認してから他のユーザーに公開する。

## 禁止事項
- `admins/{uid}` の作成・編集を誰でも可能にするFirestoreルール
- メールアドレス文字列一致だけで管理者権限を付与する実装
- 招待コードが合致したという**画面側だけの判定**でFirestoreへの書き込みを許可する
- 既存の `TAXIAPP_WRITE_KEY` を配布アプリへ埋め込む
- 管理者のDriveを「リンクを知っている全員」に共有
- 本番日報のバックアップなしの上書き移行

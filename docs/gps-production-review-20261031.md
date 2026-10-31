# PR #223｜実機試験へ進むための適用レビュー

## 現在の状態

承認範囲のコード修正と手元検証を実施。本番反映は未実施。本体の営業UIへの統合は実機受入後。新しいアカウント体系を追加せず既存TAXIAPPログインを使う。

- 本体設定ファイルのprojectIdは `taxiapp-2b6bd`。**実際の配置先・配置済みFirestoreルール・課金プラン・Functions配置状態は、まだ本番へ接続できていないため未確認**。
- この環境で `firebase login:list --json` は認証アカウントを返さず、`firebase projects:list --json` は `Failed to authenticate, have you run firebase login?` で失敗。Googleログインや認証情報の入力は本人操作が必要。認証済みと誤報しない。
- 本番ルール・認証・Functions/Scheduler・公開・追加費用に関わる操作は、WORK_HANDOFF.mdとNotion専用指示により個別承認対象。無料/有料の実状態を未確認のまま課金設定を有効にしない。

## 承認後に適用を検討する具体的な範囲

1. 現行の本番Firestoreルールと配置状態を読取り、リポジトリの `firestore.rules` と照合する。食い違う場合は未適用候補をそのままデプロイせず、既存ルールを保った差分に組み直す。
2. GPS専用のルール差分だけを追加する。対象は `gpsSharePrefs`、`gpsSenderSessions`、`gpsPresence`、`gpsHistory`、`gpsHistoryTombstones`。既存の営業原本・Google印刷・ユーザー登録・管理者設定・操作端末のルールを変更しない。
3. GPS Callable 7関数だけを対象に配置する。既存の管理者関数は配置対象にしない。必要な課金/IAM/プロジェクト設定の変更が生じる場合は、その実際の内容を提示して止める。
4. 検証ページと参照JSを既存TAXIAPPと**同じオリジン**へ試験公開し、既存ログイン・操作端末セッションを引き継いでGalaxy/iPhone実機試験を行う。別ドメインの試験URLを同じログイン/操作権が自動共有されるものとして扱わない。公開操作は未承認。
5. Schedulerの `cleanupGpsHistoryAndAudit` はこの7関数配置に含めない。03:00 JSTの実削除、費用と必要権限は別の確認・承認が必要。期限切れ閲覧拒否のルールと物理削除の実行は別。

## ルールのレビュー用ファイル

- 最小差分：`docs/gps-sharing-firestore.rules.fragment`
- 既存リポジトリ版へ差し込んだ全文候補：`docs/gps-sharing-firestore.rules.candidate`
- 候補を指定する別設定：`firebase.gps-review.json`
- 再生成：`node scripts/prepare-gps-deployment.js`

再生成はローカルファイルを書くだけで、接続・認証・デプロイを行わない。候補は本番配置済みルールを取得したものではない。

## GPS Callable配置対象

- `adminViewGpsHistory`
- `adminExportGpsHistory`
- `adminListGpsHistory`
- `adminListGpsHistoryAudit`
- `deleteGpsHistory`
- `saveOwnGpsHistory`
- `recordOwnGpsCsvAudit`

全GPS Callableはリクエストの `actorUid` と認証トークンのUIDを照合する。ログイン切替中の古い操作を別UIDの処理として受理しない。新しいクライアントと関数は同じ改訂として揃える。

以下は**承認・本番の現行ルール照合・利用費確認・認証が揃った後だけ**使用するコマンド案。ここでは実行していない。Firebase CLI 14.27.0の実装で `functions:codebase:functionName` の絞込み形式を確認済み。

```powershell
firebase deploy --project taxiapp-2b6bd --config firebase.gps-review.json --only firestore:rules
firebase deploy --project taxiapp-2b6bd --only "functions:account-admin:adminViewGpsHistory,functions:account-admin:adminExportGpsHistory,functions:account-admin:adminListGpsHistory,functions:account-admin:adminListGpsHistoryAudit,functions:account-admin:deleteGpsHistory,functions:account-admin:saveOwnGpsHistory,functions:account-admin:recordOwnGpsCsvAudit"
```

## 実機受入の具体的な動線

- 日報の操作端末でTAXIAPPにログイン済みのタブから試験ページへ移動するか、そのタブを開いた元にして新規ウィンドウを開く。試験ページ自体は操作端末を取得・奪取しない。セッションを持たない新規タブや別端末は閲覧専用と表示する。複製タブであってもGPS送信画面は1つに限定する。同一タブの再読込みでは送信元IDを継続し、複製タブとはWeb Locksで分離する。未対応ブラウザでは新IDと期限待ちを使うため実機で待ち時間も確認する。
- 公開ON・営業中だけ共有。非公開/入庫/非表示/通信断/操作権喪失で新しい送信を止める。サーバーへの停止反映と、他端末での最終位置の5分失効を区別して確認する。
- 履歴OFFでは点を残さない。ONで取得した点はOFF後も保持し、欠測/非表示区間をつながない。入庫の原データが確認できた分を保存し、サーバー読戻し後だけ保存済み。
- 閲覧専用PCがスマホの位置を上書き/消去せず、操作端末切替後は古い端末の書込が拒否されることを2端末で確認する。
- 古いオフライン公開操作と他端末の新しい非公開を競合させ、無断上書きせず「選び直し」を案内する。未同期操作と未送信点を勝手に消さない。
- 本人CSV・管理者履歴閲覧/CSV/削除・監査ログを確認する。実営業データや実位置をGitHubのテスト資料・公開ログへ転載しない。
- 画面OFF/ブラウザ非表示中の位置取得継続を保証しない。GPS飛び判定75m/s・低精度表示100mは現行の暫定閾値で、実走行精度の証拠ではない。

## 切戻しと保護範囲

問題が出たら試験ページの利用を止め、GPS新規送信を停止する。既存営業UI・日報・計算・印刷は今回変更していない。ルールを切り戻す場合は、事前に実物を照合した既存ルールへGPS差分だけを戻す。既存の営業原本/売上/Google帳票の移行・削除を切戻しに含めない。GPS履歴や未同期端末データも無断で消さない。

## 検証の区別

- Node回帰、Firestore認可とトランザクション、Chromium実DOM/IndexedDB/CSVを実行。
- Auth/Firestore EmulatorとFirebase公式Callable HTTPハンドラをローカルTCP接続し、実SDK12.4・認証トークン・複数ブラウザコンテキストで検証。GPS座標と可視状態は合成。
- 公式Functions Emulatorはこの環境でUnixソケットのlisten/connectがEPERMとなったため、公式CallableハンドラをTCPで実行。Functions Emulator自体・Cloud Run/IAM・本番Google OAuth・実GPS・実Schedulerの成功ではない。

# Firebaseゴミ箱権限の実機相当テスト（本番とは完全分離）

**このフォルダは検証専用。Firebaseの本番プロジェクトには接続・書込・デプロイしません。**

## 位置づけ
- 権限草案：`../rules-drafts/firestore-trash.rules`（実本番ルールではない）。
- テスト：`firestore-trash.test.cjs`（Firestore Emulator＋認証済みテストユーザーを使用）。
- 設定：`firebase.json`。Emulatorは `127.0.0.1:8086` のローカルにのみ起動する。
- プロジェクトIDは **`demo-taxiapp-trash`**。接頭辞 `demo-` のFirebase Emulator用仮想プロジェクト以外は使用しない。
- `@firebase/rules-unit-testing` の `withSecurityRulesDisabled` はテストデータの初期化に限り使用。本番SDKへ接続しない。

## テスト原本と実行フォルダの保護
- Firebase CLIはプロジェクト外のルールを直接読めないため、`npm run emulator` の開始時に `../rules-drafts/firestore-trash.rules` を `./firestore-trash.rules` へ**一時的にコピー**する。原本を編集・公開しない。コピーは `.gitignore` に登録済み。
- `firebase.json` が読むのはこのローカルコピー。テストの `initializeTestEnvironment` はリポジトリ側の同じ草案を読み込む。
- 実際の本番 `firestore.rules` は読み込みも変更もしない。

## 実行（ネットワークから依存パッケージを取得できる専用環境でのみ）
```sh
cd emulator-trash
npm install
npm run emulator
```

テストが確認する条件：
1. 本人UID以外による日報・ゴミ箱の読取りは拒否。
2. 通常日報の単独削除を拒否。
3. 本人の現行編集セッションでの原本→ゴミ箱退避＋墓標更新＋原本削除を**1トランザクション**で許可。
4. ゴミ箱に移した日報IDは、旧アプリの `revision=1` 再アップロードを拒否。
5. 本人の期限内の復元を許可し、更新番号を進める。
6. 30日未満の完全削除を拒否。
7. 期限経過後、現在の編集端末がゴミ箱本文を削除しても墓標は残り、旧端末による復活は拒否。
8. 過去の編集端末セッションでの完全削除は拒否。

## 本番公開前の必須追加検証
- 3文書同時処理の `get()` / `getAfter()` / `existsAfter()` による**アクセス回数上限と実ルールコンパイル成功**。
- 編集端末変更、認証切替、UID相違、対象IDの不一致、別利用者の操作、期限時刻の改竄、並行編集のCAS競合。
- 日報本文とGPS・売上の復元整合性、旧クライアントとの同期、新規登録・既存更新・削除・復元の回帰確認。
- 管理者のGoogle Sheets原本・印刷には影響を与えないこと。
- 本番公開には**ルール差分の説明と利用者承認が必要**。このテストだけで自動公開しない。

## 現在の検証状況（2026-10-21）
**GitHub Actions上の実Firestore Emulatorで実行済み・成功。** 直近の追加不正操作テストを含むコミット `0ddbd599a9932d92ef0c13dc9c368e2f5175cd6b`、ワークフロー実行 `39530203662` が成功（`Firestore trash security emulator (draft only)`）。

検証したのは、本人/他UID、古い編集端末、単独削除、部分的な3文書操作、偽造ゴミ箱、削除履歴改ざん、30日以内の完全削除禁止、期限切れ整理、復元、旧端末による削除済み日報の再作成拒否。

**あくまで隔離した `demo-taxiapp-trash` の草案ルールテストの成功**。実運用中の本番Firebaseの権限変更・日報データ移行・削除・自動整理は行っていない。アプリのログイン／同期／画面への結合、PR #110とのローカル未同期記録の保護統合、実機による印刷確認は未実装／未検証。

このチャット側のローカルコンテナにはEmulatorを入れていないため、引き続きGitHub Actionsで再現できる専用検証を使用する。

Firebase Emulatorの公式資料：https://firebase.google.com/docs/emulator-suite/connect_firestore

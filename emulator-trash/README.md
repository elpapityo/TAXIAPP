# Firebaseゴミ箱権限の実機相当テスト（本番とは完全分離）

**このフォルダは検証専用。Firebaseの本番プロジェクトには接続・書込・デプロイしません。**

## 位置づけ
- 権限草案：`../rules-drafts/firestore-trash.rules`（実本番ルールではない）。
- テスト：`firestore-trash.test.cjs`（Firestore Emulator＋認証済みテストユーザーを使用）。
- 設定：`firebase.json`。Emulatorは `127.0.0.1:8086` のローカルにのみ起動する。
- プロジェクトIDは **`demo-taxiapp-trash`**。接頭辞 `demo-` のFirebase Emulator用仮想プロジェクト以外は使用しない。
- `@firebase/rules-unit-testing` の `withSecurityRulesDisabled` はテストデータの初期化に限り使用。本番SDKへ接続しない。

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

## 現在の検証状況
**未実行**：このチャット環境にはFirebase CLIとFirestore Emulatorがなく、npm依存関係の取得はネットワークエラーになったため。
GitHub Actionsの一般Nodeテストは別で成功しているが、**Emulatorテストに成功したとは扱わない**。

Firebase Emulatorの公式資料：https://firebase.google.com/docs/emulator-suite/connect_firestore

# TAXIAPP 管理者Firestore原本化：第1段階（検証用・本番切替なし）

## 前提
決定済みの将来方針は、**全利用者のFirestore原本への統一、Google Sheetsの印刷専用化、利用者が選ぶサーバーゴミ箱**。詳細は Issue #105 / #111 および PR #112 の `docs/firebase-originals-print-only-trash.md` を参照。

この段階では**本番運用の管理者ログインは旧Google Sheets保存を維持**し、データ移行・本番ルール公開・Apps Script変更・既存のSheetsデータ操作を実施しない。

## 今回実装したもの
1. `account-diary-store.js` に管理者用の **明示的かつ初期値OFF** の `storageBackend: 'firestore'` オプションを追加。
   - 従来どおり `admin: true` のみでは `kind() === 'legacy'`、Firestore APIは使えない。
   - 認証済み管理者本人のFirebase接続に対して、呼び出し元が明示的に `storageBackend: 'firestore'` を渡した場合だけ、本人UIDの `privateDuties/{uid}/shifts` を利用する。
   - Firestore側の本人UID制限、CAS、端末編集セッションは従来のまま維持。他ユーザーの原本は参照させない。
   - **`index.html` の呼び出し元は変更していないため、通常の管理者アプリ操作からこのオプションは使われない。**
2. `admin-firestore-cutover.js` に **読み取り済みの合成/検証データを使う純粋な事前判定器** を追加。
   - 入力：管理者本人UID、旧保存元の乗務一覧、本人UIDのFirestore乗務一覧、明示的に選択した乗務ID。
   - 出力：選択件数、除外件数、すでに存在する同ID、内容不一致、別IDで乗務時間の重複、時刻未確認、移行候補。
   - **いかなる候補も自動アップロードしない。** 結果の `migrationAuthorized` は常に `false`。
   - 例えば保存元5件から必要2件だけ選んだ場合は、残る3件は移行候補に含めない。
   - 同一UID以外を入力した場合や不正な日報ID・重複IDは拒否。

## 次段階で必須の作業（今回未実装）
- 管理者UIへ「残す日報を選ぶ」画面を追加。既存ローカル＋Google Sheetsの原本を読み取り専用で照合し、5件中の必要2件等を本人が選択する。
- 本番データに触れない合成データで、選択日報の1件ずつのクラウド保存・読み戻し・照合・復元を検証。
- PR #110 の未同期日報保護と同一ID競合許可制をレビューして統合方針を確定する。
- 管理者のFirestore原本から**選択した1件だけ**既存Sheets帳票へ印刷用に一方向反映する処理を実装し、紙帳票・式・既存印刷マクロを比較。
- サーバー側の本人ゴミ箱・復元・期限後の完全削除を別途実装。削除した日報の旧端末による復活を防ぐ。
- Firebase Emulatorで管理者/一般A/B、権限不足、旧編集端末、CAS競合を確認してから**個別承認後に**本番ルール公開と移行。
- 旧Google Sheets原本の整理・削除は保存・印刷切替とは**別の明示的承認**が必要。

## テスト
- `node tests/admin-firestore-binding.test.js`：管理者デフォルト旧保存維持、明示指定時の本人Firestore保存、他UID隔離等。
- `node tests/admin-firestore-cutover.test.js`：5件中2件選択、時間重複、同ID競合、時刻未確認、UID不一致等。
- 既存自動テスト全体の結果はPRのGitHub Actionsで確認する。
- これらはローカルのモック/静的テストであり、Firebase本番・Google Sheetsで実際に動作したことは示さない。

**状態：第1段階のコード追加のみ。Firestore管理者切替・選択UI・印刷専用出力・ゴミ箱は未実装。**

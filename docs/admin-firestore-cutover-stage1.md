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
- **管理者UIでの端末内日報の選択表示と、TAXIAPP_同期原本の読み取り専用照合は追加済み。** ただしFirebase本人原本と、Googleのその他の旧シート・印刷元まで網羅する照合は未実装。5件中2件を選べるだけでは安全な移行を意味しない。
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

## 2026-10-21 第2段階：端末内の日報を選ぶ画面（今回追加）
- `index.html` の管理者の「設定 → データ管理」に読み取り専用の選択パネルを追加。日報ごとにチェックでき、初期状態は**全件未選択**。
- 選択した日報・除外した日報の件数、日時、営業件数、売上、乗務IDを表示。別IDの乗務時間重複（選択した日報・しなかった日報）、未入庫、時刻異常を注意として表示。
- `admin-firestore-cutover.js` の `previewLocal()` は、**この端末で見えている日報のみ**を比較する。Google Sheetsの原本や本人UIDのFirestore記録は読み込まないので、クラウドの競合確認済みとは表示しない。`cloudVerified:false`、`migrationAuthorized:false` を必須とする。
- 選択した結果は個人端末からJSONの**選択メモ**として書き出せる。ただし、このJSONは日報原本のバックアップではない。選択状態はアプリの本体データには保存しないため、再ログインで初期化される。
- 管理者が選んでも、Firebaseアップロード、Googleへの送信、日報削除、保存先変更は一切発火しない。旧Sheets保存と印刷は現状維持。
- `tests/admin-cutover-selection-ui.test.js`、`tests/admin-firestore-cutover.test.js` で選択／他ユーザー分離／除外／重複警告／クラウド未検証／本体データ不変を合成データで確認。

## 2026-10-21 第3段階：Google同期原本との読取専用照合
- `index.html`（開発版 v0.3.115）の管理者専用「設定 → データ管理」に「Google同期原本を照合（読取専用）」を追加。**ボタンの明示操作時だけ** `googlePostRequest('syncList')` で既存 `TAXIAPP_同期原本` の乗務IDと版番号を取得、`syncGet` で各原本のデータを取得。Apps Scriptの書込・削除・印刷処理は実行しない。
- 端末とGoogle側の一覧について、同IDの一致/内容違い、端末だけ・Googleだけに存在する乗務、別IDの日報の時間重複を比較。選択済みの移行候補を含めて件数を表示。ゴミ箱や選択削除の実装ではない。
- **Googleに保存された全シートを網羅するものではない。** `syncList` が参照する `TAXIAPP_同期原本` のみ対象。旧Sheet・印刷専用データ・Firebase UID別の原本は未照合。
- 読込中のユーザー切替・端末日報変更・操作権喪失時は照合中止。同期原本に25件を超えるデータがある場合は誤った部分照合を完了扱いにせず停止。全IDの読戻しと最後の一覧/版番号再照合が成功した場合のみ比較結果を表示。
- 取得した原本は操作中のメモリにのみ保持し、UID切替で破棄。印刷用シート、Firebase、既存ローカル記録は一切変更しない。表示や選択メモの出力にも日報の乗車明細やGPS原本は載せない。
- `admin-firestore-cutover.js` の `compareLegacySheet()` は `firebaseVerified:false`、`migrationAuthorized:false`、`deleteAuthorized:false` を返す。通信は担当しない純粋比較器。
- モックテストで `syncList` / `syncGet` 以外の呼出しがないこと、5件中2件の選択、Googleにだけある日報、通信失敗、UID切替などを検証。

## 2026-10-21 第4段階：本人Firestore日報の読取専用照合
- `index.html` 開発版v0.3.116の管理者用「設定 → データ管理」に **「本人Firebase原本を照合（読取専用）」** を追加。実行は本人のボタン操作時に限る。
- 管理者ログインの正式な保存先はこれまでどおりGoogle Sheets。照合の間だけ、**別インスタンス**の `TAXIAPP_ACCOUNT_DIARY` を `{admin:true, storageBackend:'firestore', readOnly:true}` で本人のUIDに束縛する。照合用接続では `syncPut` を強制拒否。Firestoreの権限を変更しない。
- `syncList` と `syncGet` だけで **`privateDuties/{本人UID}/shifts`** を読込む。原本の本文・GPS・売上明細は書出しせず、表示はID・日時・件数・一致/相違・時間重複に限る。
- 取得の前後で日報ID・更新番号が一致するか再取得して確認。操作権・本人UID・ログイン世代・端末の日報が途中で変わる場合は結果を破棄。25件超、権限エラー、旧Firebaseルールによる許可拒否などは**空一覧や照合完了と誤認させず**エラーとして停止。
- `admin-firestore-cutover.js` の `compareOwnFirestore()` で端末・Firebase・確認済みGoogle同期原本の3系統を比較。Google側を未取得なら `sheetVerified:false` として、空シートと混同しない。`migrationAuthorized:false` と `deleteAuthorized:false` は固定。
- `tests/admin-firebase-audit-ui.test.js` / `tests/admin-firestore-binding.test.js` / `tests/admin-firestore-cutover.test.js` で、本人UID限定、読み込み失敗、更新番号変化、旧端末の読取不能、書込み拒否、重複判定、Google未照合状態を合成データで確認。
- **実際のFirebase本番を操作・読み込みした結果ではない。** 実機でのルール公開・ログイン別検証は今後必要。Firestore Rulesが本番未反映の場合、照合は許可拒否になる可能性がある。

**現状：端末・GoogleのTAXIAPP_同期原本・本人UID別Firestoreの読み取り専用比較UIまで実装。その他の旧Googleシート、管理者Firestore正式切替、Sheets印刷専用化、サーバーゴミ箱・完全削除は未実装。本番環境への書き込み・変更はゼロ。**

## 2026-10-21 第5段階：本人Firestore原本から印刷専用へ渡す前の形式検査（開発版v0.3.118）

- `admin-print-handoff-preflight.js` はネットワーク・Firebase/Google送信を行わない**純粋な読み取り専用検証器**。選択済み1件、同じ管理者UID、端末・本人Firestore・旧Google `TAXIAPP_同期原本` の読み取り済み照合結果、Firebaseの更新番号を受け取る。
- 管理者「設定 → データ管理」へ**「Firestore原本→印刷専用化の事前チェック（書込なし）」**を追加。Google/Firebaseの読み取り専用ボタンで照合してから、対象の1件だけを確認する。結果の再表示はローカル計算のみで、新たな通信・保存は発生しない。全件未選択・複数選択・UID不一致・原本欠落・未照合・版番号不明・同ID内容違い・別ID時間重複・未入庫・未精算・60件超を要確認として扱う。
- 既存 `googleShiftPacket()` で**複製原本をメモリ内で変換**し、これまでの `TAXIAPP_SHIFT_V1` 形式、送信文字数と保存分割数上限、メーター合計、現金納金+ETC=総入金、キャンセル料0円、GO/Uber内訳を確認する。検証結果には個人情報・GPS・営業明細を含めず、ID/更新番号/要確認理由/集計だけ表示。書き込み処理は一切持たない。
- **最重要：既存のGAS `syncPutV2_()` は `savePacket_()` を呼ぶ。** `savePacket_()` は `TAXIAPP_同期原本`、`TAXIAPP_乗務一覧`、`TAXIAPP_乗務保管`、`TAXIAPP_決済内訳`、`TAXIAPP_集計`、`TAXIAPP_印刷データ` を更新する。そのため**同期原本を書き換えずに印刷だけ渡すAPIとして流用してはならない**。新しい限定的な一方向転送API（別仕様・本番公開前の明示承認が必要）が完成するまで、印刷連携は送信しない。
- `printSheetLiveVerified:false`、`writeAuthorized:false`、`printAuthorized:false`、`cutoverAuthorized:false` は固定。画面に「形式一致」が出ても、ライブGoogleシートの紙帳票・現在のApps Script公開版・Firebase本番権限・移行後の復旧を検証済みとは意味しない。
- 合成データを用いた `tests/admin-print-handoff-preflight.test.js` が、通常形式、改ざん、原本不一致、UID隔離、版番号・日報選択、料金不整合、キャンセル、未入庫、時間重複、誤ったAPIの呼び出し禁止を確認。
- 管理者の旧Google原本は引き続き正式な本番原本。本段階の更新は**GitHubのドラフトPRのみ**。Google Sheetsの式・マクロ・書式、GAS公開版、Firestore本番Rules、既存データ、ログイン権限を変更していない。

### 次の工程（まだ実施していない）
1. 合成日報1件から印刷専用の**独立した書込み面**へ変換する仕様・冪等性・転送済み版管理・ロールバックを設計し、既存帳票の式や`B15/B17/C17`選択方式を保護する。旧`syncPut`を再利用しない。
2. 実際のGoogleシートとGAS公開版の読み取り確認（権限内で可能な範囲）、新APIのEmulator/モック試験、スマホ/PC画面と紙帳票の検証。本人Firestore原本と既存Google旧原本の実データ全件一致は今の照合上限25件では保証できない。
3. 運用・法定保存期間・原本のバックアップと復旧、管理者本人の移行対象選択、同期競合対応を決定し、**本番移行・ルール公開・Apps Script再デプロイ・旧原本の削除は操作ごとに事前承認**を取る。

# TAXIAPP管理者Firestore原本 → 既存Google補助簿の取込（開発版・本番未公開）

## 決定済みの最短経路
- スマホの既存 `pricing()/settledTenderAmounts()/totals()` と `googleShiftPacket()` を唯一の計算元にする。
- 管理者も一般利用者も、自分の本人UIDの `privateDuties/{uid}/shifts/{id}` に保存。Firestoreは本人UIDと編集端末の更新番号/CASで保護する。
- 管理者がFirestoreへ保存する際、`shift.records[].amounts`・`payments` と `shift.__taxiPrintSummary` を**既存アプリ計算結果として**原本に含める。GASでは売上・距離・手数料の再計算をしない。
- PCの既存Apps ScriptがGoogleアカウントのOAuthで、**固定設定した本人UID**のFirestore原本を読取る。初回は `firestorePrintLatestMenuDraft_` 等で明示選択し、既存 `TAXIAPP_乗務一覧`・`TAXIAPP_印刷データ`・`TAXIAPP_決済内訳`・`TAXIAPP_集計` のみへ計算済み値を転記。
- `補助簿印刷用` と `補助簿印刷用_2頁`、`TAXIAPP_印刷操作!B15/B17/C17` の既存数式・書式・手順は変更しない。`TAXIAPP_同期原本`、旧 `日報`、旧データ、マクロへの書込みを禁止する。

## 実装・配置
- `account-diary-store.js`：管理者の明示的な `storageBackend:'firestore'` 接続（通常の管理者は引き続きlegacy）。
- `index.html`：計算済み日報送信モード。**`ADMIN_FIRESTORE_CUTOVER_ENABLED=false` のため正式版では起動しない。**
- `google-apps-script/Code.gs`：`savePacket_(packet,{firestorePrintOnly:true})` で4印刷元だけを更新。既存 `syncPut` / `savePacket_` の旧経路は変更しない。
- `google-apps-script/FirestorePrintPullDraft.gs`：本人UID固定のFirestore REST読取、保存時刻/版番号再確認、最新乗務取得、PC専用メニュー。
- `google-apps-script/FirestorePrintSourcesDraft.gs`：4シートの列見出し・空欄と既存IDを照合、新規追記または完全一致の無変更再読込。**同じ乗務IDで内容が変わっている場合は、誤上書きを防ぐため停止する。** 既存行を変更する再印刷処理は未完成。
- GASファイルは**Apps Script本番プロジェクトにコピーも公開もしていない**。独立メニューの `setupFirestorePrintMenuDraft_` は**事前承認後にだけ**初回実行する。既存の `onOpen` 関数/マクロを置換しない。

## 本番稼働前の権限・手順（要個別承認）
1. 現在スマホに残る本物の営業2乗務と、Googleに残る7乗務を**別々にバックアップ**する。削除履歴や除外5件を勝手に移行しない。Firestoreへ移行するIDは利用者が確定する。旧Google原本・旧帳票を削除しない。
2. Firebase本番 `firestore.rules` の**実際の公開内容**、管理者 `admins/{uid}`、本人編集セッション、保存/読込権限を確認する。ルール・認証・IAMの公開変更は事前承認。
3. Google Apps ScriptのOAuthに `https://www.googleapis.com/auth/datastore` と `https://www.googleapis.com/auth/script.external_request`、既存Sheets書込用のスコープ等を設定する必要がある。Google実行アカウントのFirestoreプロジェクトIAMは最小限の**読み取り専用**。OAuthスコープとIAMアクセスは別であり、秘密のサービスアカウント鍵をGitHub/GASコードに置かない。
4. 接続先はGAS Script Propertiesの `TAXIAPP_FIRESTORE_PROJECT_ID` と `TAXIAPP_FIRESTORE_OWNER_UID` に限る。UIDを公開フォームや共通Google接続キーから自己申告させない。他人のUIDの印刷には使用しない。
5. 既存の印刷2ページ・見出し・式・マクロをバックアップし、合成データだけの独立した検証ブックでGASの実行・Firestore実取得を検証。新規取込→同版無変更→修正版拒否→旧Google原本不変を確認。
6. 印刷中の排他運用と失敗時の復旧を確認し、既存Apps Scriptの**本番再デプロイ・管理者保存先切替は個別承認後**に実施。承認までv0.3.113の現行本番運用は維持する。
7. 切替後は本人FirestoreへのCAS確定とGoogleの印刷元反映を照合。Google側から旧同期原本を日報保存元として再受信しない。障害時は**旧Google原本を保持したままFirestore送信を停止し、保存済み原本から復元する**（無条件で旧端末データを上書きしない）。

## 未完成/制約
- **同一乗務IDの金額/件数変更後の安全な再印刷は未実装**。既存の旧Google原本と同じIDの再転用も拒否する。移行対象IDの衝突や二重表示を検証してから正式対応する。
- Firestoreゴミ箱・30日整理はPR #115の別開発であり、本番未有効。Googleに残る削除テスト5件を勝手にクラウド消去しない。
- GASは実際のFirebase IAM・OAuth・Firestoreへのアクセスをまだ試していない。Firebase料金や新しい有料サービスの契約を伴う変更は未実施。
- Apps Scriptの4シート更新は非原子的なため、中断・PC同時印刷・再印刷での行更新を本番許可する前に、検証用コピーでの転送/復旧と再検査が必要。
- GitHubでのコード/合成テストの成功は本番アプリの保存先切替・実機印刷の完成とは別である。


## 開発16：既存印刷元の全明細読取確認（開発版・本番未公開）

- `applySelectedPrintShift()` のFirestore専用経路では、本人の原本を再取得した後、**既存の `savePacket_()` に読取専用の確認オプション**を渡す。既存 `googleShiftPacket()` の計算済み結果から作った **4印刷元の全行・全セル**を `firestorePrintVerifyRowsDraft_()` で実シートの値と比較する。料金・距離の別計算はしない。
- 件数・メーター売上・秒単位の更新日時が同一でも、乗車地、金種、決済内訳、営業明細、集計などの印刷元に差があれば**確認を停止**する。照合中に原本が更新された場合も、Firestoreを再読込して版・内容の一致確認に失敗したら停止する。
- 4印刷元の照合と確認ではシートへ**書き込まない**。既存 `TAXIAPP_同期原本`、`補助簿印刷用`、`補助簿印刷用_2頁`、`TAXIAPP_印刷操作`、式・書式・マクロも変更しない。旧Google印刷の動作は従来の経路を維持する。
- **未完成のまま**：同一乗務IDの原本が改版された場合の安全な4シート更新／再印刷、実Google OAuth/IAM/Firestore接続、現物補助簿2ページの出力は未実施。本修正は古い印刷元を**検出して停止する機能**であり、改版後の印刷元を自動更新する機能ではない。原本の全フィールドが印刷元4シートに含まれていると誤解しない。
- 本番GASへの導入・再デプロイ、実データ移行、本番保存先切替、Google既存帳票の変更は、従来どおり事前承認が必要。

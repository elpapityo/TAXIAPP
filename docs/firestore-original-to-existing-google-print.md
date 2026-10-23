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
 
- PC専用の `firestorePrintChosenMenuDraft_()` は既存 `resolvePrintShiftId_()` で `B15/B17` の選択を解決し、`C17` がその乗務IDと一致しなければ**Firestore取込そのものを停止**する。乗務を自動選択し直したり、入庫時に印刷したりはしない。
- 過去日報の未保存編集については `index.html` の `pagehide`／`beforeunload` 時に既存 `protectOpenHistoryEdit()` を呼び、画面終了・再読込前の端末控えを保護する。保存失敗時は終了確認を要求するが、Android／ブラウザ側が確認画面を必ず表示する保証はないため、通常入力時の随時保存も維持する。

## 開発16：同一乗務IDの改版取込（合成確認段階）

- `firestorePrintSelectedDutyDraft_()` で本人UIDの原本を読戻し、ScriptProperties内の**乗務ID・UID・Firestore更新番号・4印刷元の照合ハッシュ**と照合してから、`savePacket_()` の既存計算済み投影を再利用して更新する。初回取込・同版無変更・新しい版の更新を区別し、同一更新番号の異なる内容を受け付けない。
- 本人の4印刷元行に数式／第三者編集／途中書込み／未完了の版管理がある場合は**停止**。部分失敗時は確認済みの旧値または今回の値だけを条件付きで復旧し、元に戻せなければ版管理を「書込み中」のまま保留する。修正箇所の更新中にFirestore原本が変われば、従来どおり乗務一覧の公開直前の再取得で停止。
- 件数が増える場合は、その乗務の行ブロックが**当該印刷元シートの最後の使用ブロックであるときのみ**自動拡張する。他の乗務の行をずらさず、最終ブロックでないものは増加を保留する。件数が減れば余分な行を空白にする。既存帳票の2ページ、セレクター列、旧Google同期原本は変更しない。
- 旧GAS版で印刷元に登録済みの同一IDに、版管理がないまま**異なる内容**が存在する場合、自動更新しない。同じ計算済み4印刷元と完全一致する場合に限り、既存の状態をそのFirestore版の基準として記録できる。
- この実装は**PR #119上の開発コード**。旧Google原本を移行・削除したり、本番GASへ導入したりしていない。Google Apps Script本番の導入・OAuth/IAM変更、既存実Sheetsへの書込み・正式公開には個別承認とバックアップ／復旧手順が必要。紙への実印刷は今回の確認対象外とする。
- 合成テストで、初回取込、同版再取込、改版更新、行増減、他乗務の行保護、他者変更による停止、途中失敗時の復旧を確認する。**実Google認証／シートへの転送は未検証**。

## 2026年10月23日：本番導入の承認と実装状況

- 利用者はGAS本番へのFirestore取込導入と補助簿2ページへの転送確認を承認済み。ただし実本番データの移行・削除・保存先切替は今回実施していない。
- GitHub main: google-apps-script/Code.gs に本人認証済み取込 firestorePrintImport と読取専用 firestorePrintProbe を準備。FirestorePrintPullDraft.gs の firestorePrintProbeDraft_ は本人UID・対象乗務日・版番号・対象シート・旧Google同一IDを照合し、データを書き換えない。
- index.html v0.3.147: PC本人認証モードに読取専用事前照合ボタンを追加。既存の4印刷元への転送機能、B15/B17/C17の乗務選択、紙の補助簿2ページ、旧Google原本は保持。
- 既存スプレッドシートの TAXIAPP_印刷操作!B20 にはPC本人認証画面を開くリンクが設定済み。
- 本番GAS再デプロイは未実行。接続中のGoogle Drive/SheetsではApps Scriptのプロジェクトコード更新・デプロイを操作できず、GitHub ActionsにもGASデプロイ機能は存在しない。旧本番GASを勝手に置き換えない。
- 本番へ導入するには既存GAS・4印刷元のバックアップを取り、Code.gsの差分とFirestorePrintPullDraft.gsおよびFirestorePrintSourcesDraft.gsを既存プロジェクトへ導入し、Script PropertiesのTAXIAPP_FIRESTORE_PROJECT_IDとTAXIAPP_FIRESTORE_OWNER_UIDを本人のGoogle環境内で設定する。認証キー・UID・トークンを公開しない。
- 再デプロイ後の順序：PC本人ログイン、対象乗務取得、読取専用事前照合、実転送、4印刷元と2ページの実照合。ID衝突・版番号不一致・通信結果不明では停止。未確認のまま移行・削除・再送信しない。

## 2026年10月23日：スプレッドシートから直接押すFirestore取得操作

- 利用者は単なるTAXIAPP閲覧リンクではなく、**Googleスプレッドシート内の操作から本人Firestoreを取得**して補助簿の既存4印刷元へ反映することを希望。
- GitHubの `google-apps-script/FirestoreSheetDirectImport.gs` に独立した専用メニュー `TAXIAPP Fire取得` と `TAXIAPP_印刷操作!B20` のチェック操作を追加。`setupFirestoreSheetImportButton_()` は本番GASファイル導入後に一度だけ実行し、既存の `doPost` や `onOpen`・印刷用マクロを置換しない。
- 押した場合に本人Googleアカウントの一致を確認。Google Apps Scriptの一時OAuthアクセストークンをFirebase Auth REST `accounts:signInWithIdp` でFirebase IDトークンに交換する設計。Firebase UIDが固定本人UIDと一致しなければ処理停止。**このGoogle OAuth → Firebase交換は実本番認証未検証であり、ログイン不可時は安全停止する。** Google IAMの全Firestore読取権限は要求しない。
- 入力した乗務日の本人UID内でFirestoreの軽量一覧（本文なし）を取得し、日報IDと日時を明示選択。対象原本は既存の `firestorePrintSelectedDutyDraft_` と `savePacket_` のCAS・内容一致・旧Google同ID拒否・4シートのみ書込を利用。計算式・金額・GPS・手数料等の再計算を新設しない。
- 必要なGAS Script Propertiesは `TAXIAPP_FIRESTORE_PROJECT_ID`・`TAXIAPP_FIRESTORE_OWNER_UID`（既存）と `TAXIAPP_FIREBASE_WEB_API_KEY`・`TAXIAPP_PRINT_OWNER_EMAIL`（追加）。値はGoogle環境内だけに保存し、GitHubに書かない。明示OAuthスコープは `https://www.googleapis.com/auth/spreadsheets`、`https://www.googleapis.com/auth/script.external_request`、`https://www.googleapis.com/auth/script.scriptapp`、`https://www.googleapis.com/auth/userinfo.email`、`openid`。既存manifestの他スコープを無断で削除しない。
- Google Apps Script本番プロジェクトへの新ファイル導入・トリガー作成は**未実施**。接続済みGoogle Drive/SheetsツールはGASの更新/デプロイ権限を公開しておらず、Google Drive検索でもApps Script本体が取得できなかった。B20の既存リンクは、この未完成状態でチェックだけ置いて誤認させないため、現状維持。
- 既存GASをバックアップし、必要ファイルの導入・Script Properties確認・`setupFirestoreSheetImportButton_()` の一度だけの実行と本人Google認証許可が必要。シート上にボタンを「設置済み・稼働」と報告できるのは、B20の本番チェックで本人日報を4印刷元へ取り込み、2ページを紙またはPDFで実照合した後のみ。
- シート内にチェックボックスを作る方法はGASのインストール可能な `onEdit` トリガーであり、作成者の権限で実行されるため、操作ユーザーのGoogleメールが取得できない時は停止する。ブラウザ側で編集ユーザーを特定できずUIを開けない場合は、専用メニューから実行する。

### 2026-10-23 追補：B20チェックの安定動作と実行権

- チェックボックスの設置型onEditでは対話ダイアログの表示を要求しない。シート `TAXIAPP_印刷操作!B30` の乗務日と `B31` の乗務ID（同日複数時必須）を取得し、本人確認とCASの後に4印刷元だけへ転送する。複数原本を勝手に選ばない。
- B20はGASコードを導入して `setupFirestoreSheetImportButton_()` を実行するまではリンクのまま維持し、実動作しないチェックを先行配置しない。導入手順は `google-apps-script/README-Firestore取得ボタン.md`。
- Apps Scriptの設置型トリガーはスクリプト現行HEADで動作するため、**シート上のチェックだけなら既存Webアプリv3を再デプロイせず利用可能**。ただし実GASプロジェクト編集・初回トリガー作成・本人OAuth認証は未実施。
- 単体テストは成功しているが、Apps Scriptトリガーの `e.user` や Google OAuth→Firebaseトークン交換の実運用成功は未確認。本人メールを取得できない／固定UIDと異なる場合は書き込まず停止する。

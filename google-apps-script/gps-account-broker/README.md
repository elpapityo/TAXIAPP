# TAXIGPS 認証連携：GPS専用Apps Script

## 現在の公開状態（2026-11-01）

既存デプロイは合成履歴限定の版3。公開ソースはhistory/Code.candidate.gs。本人連携と固定1地点の保存/照合/削除/墓標確認を実確認済み。通常GPS送信・全拒否ルール・無料Sparkを維持。詳しくは末尾の版3結果を参照。

## 期限付き資格版2の公開経緯（2026-11-01）

本人承認後、既存デプロイをバージョン2へ更新済み（画面2026/11/01 8:30）。同じURL/実行者/全員アクセスを維持。保存前の旧コードが取得済み版1と一致し、保存後のコードがリポジトリ更新候補と一致することをUIのコピーで確認した。公開GETでrevision=lease-v2、既存試験ページで新しい版の実本人連携成功を確認。GASは期限も保存/読戻し一致確認後だけ成功を返す。Firestoreコンソールの独立目視、実停止/降格/端末切替は未確認。具体的な差分・更新対象・切戻しは [更新レビュー](../../docs/gps-identity-expiry-review-20261101.md)。

公開版2は日報資格の確認開始から5分のaccessExpiresAtをGPS側へ保存し、保存/読戻し後にも日報資格と操作端末を確認する。停止を確認した既存の本人資格は失効、管理者降格は次回連携で反映。古い端末の拒否で新しい端末のGPSセッションを失効させない。旧対応表は期限なしなので、将来の期限必須ルールでは再連携するまで拒否する。

日報側の変更を即時通知する処理ではない。更新要求が来ない場合や日報側が読めない場合は、期限を更新しない。期限付きの読取候補 `docs/gps-identity-access.rules.candidate` はEmulator検証済み・本番未適用で、本人の資格確認だけを対象にする。位置/履歴/対応表/操作端末/日報のアクセスはこの候補でも拒否。現在の本番は全拒否を維持し、ルールを無断で切り替えない。

## 現況と対象

Googleログインを有効にしたTAXIGPS用の、本人・利用資格・操作端末を対応付ける処理。別のGoogle管理アカウントに分けるのは**プロジェクトの管理者・保存先**であり、利用者は日報とGPSで同じGoogle本人であることを確認する。FirebaseのUIDが同じであることを前提にしない。

`Code.gs` と `appsscript.json` を、既存の日報/印刷用とは別の新しいApps Scriptへ保存した。編集画面:

https://script.google.com/home/projects/1K9U4UY-OcbjAuQg9D5iMRtl3_yTof-tXYR0qWRYFJgo4hWTX6Krk2NdQ/edit

**本人承認後、OAuth権限を付与しバージョン1を公開済み**（画面表示：2026-10-31 16:44）。Code.gsの処理内容は変更していない。公開操作が追加したwebapp設定をローカルmanifestにも同期した。

公開URL： https://script.google.com/macros/s/AKfycbyk2Hlh70tzGrU8vBw2Aqp2nrqvjEtjE-RUr3TD9JUCqs_zb2o2slAdPJ4D2JT6R6kp/exec

実GETのサービス応答、未認証POST/未対応操作/不正JSONの拒否を確認済み。**2026-11-01 JST、実Google本人連携の成功応答を公開ページで確認**。GASは対応表保存と読戻し一致後だけ成功を返す。独立したFirestoreコンソール目視は未実施。既存GPS試験画面の明示連携ボタンを実装し、本人承認後に画面公開/ドメイン許可を適用済み。GPS位置/履歴送信enabled:falseを維持する。

## 確認と書込の順序

1. 日報とGPSのFirebase ID tokenをPOST本文で受ける。GETで受けず、URLやログ・保存領域に記録しない。JSON以外の認証情報を返さない。
2. 両トークンのproject/issuer/UID/時刻/providerを照合し、Googleの`accounts:lookup`にトークンを渡して検証。レスポンスUID、メール確認、失効時刻、Google subjectの一致も照合する。JWT decodeだけで認証しない。
3. 日報側は**本人のID tokenだけ**で `users/{本人UID}` / `admins/{本人UID}` を読む。操作権を要求したときだけ `deviceSessions/{本人UID}` も読み、現在のセッション一致を確認する。営業原本・売上・料金・印刷・全利用者一覧は取得しない。
4. GPS側だけ、Apps Script実行者のOAuthトークンで4種類のコレクションへ対応表を保存する。`users/{GPS UID}`、`admins/{GPS UID}`、`gpsAccountLinks/{日報UID}`、操作端末のみ`deviceSessions/{GPS UID}`。逆引き・本人情報が既存と違えば停止。`updateTime`/新規作成の事前条件付きで一括commitし、全対象を読戻し照合してから成功を返す。
5. クライアントの`isAdmin`等は一切採用せず、日報サーバーが確認した利用資格を使う。閲覧端末では操作端末を取得・更新しない。別アカウント・ログイン切替・古い端末・保存失敗・照合不一致では成功にしない。

## 保存/通信する情報と権限

- Apps Scriptへ一時的に渡すもの：日報とGPSの短期ID token、現在の操作端末ID。トークンは保存しない。
- GPS側に保存するもの：2つのUIDの対応、Google subject、表示名、確認済み利用資格、必要時の操作端末ID。メール・日報本文・座標は保存しない。
- OAuthスコープ：`script.external_request`（Google APIへの通信）と`datastore`（実行者が権限を持つFirestoreへのアクセス）。スコープ自体はGPSだけに限定されないため、**コードで更新先をtaxigps-9f82eに固定**する。日報へGoogle所有者権限で接続する処理はない。
- 利用者のTAXIAPPデータを、新しいサービス事業者へ転送する構成にはしない。処理・保存ともGoogleのサービス内。ただし本人のID tokenを専用GASへ送ること、所有者権限付与、Web公開は個別承認を受けてから行う。

## 承認を受けて実施した配置

新しいスクリプトだけをウェブアプリとして配置し、**実行者はGPS管理アカウント、アクセスは全員**とした。呼出しURLは外部から到達できるが、`link`は両Firebase ID tokenの検証なしには動作しない。`doGet`は公開サービス名だけを返す。両token/本人IDのない匿名アクセスで利用者情報を返さない。

上記2スコープは本人の追加承認後に付与済み。Googleの未確認アプリ警告を確認し、本人所有プロジェクトと要求2スコープが一致した画面から許可した。課金プラン/請求先/有料Functions/Schedulerは変更していない。Apps Scriptも利用枠があり、同じ管理アカウントの他スクリプトと枠を共用し得る。処理できなければ連携を停止し、日報を変更しない。

切戻し：新規GASのデプロイを無効化し、クライアント連携URLを設定しない/無効にする。新規権限の取消はGoogleアカウント側で行う。日報側のルール・GAS・原本は切り替えない。保存されたGPS対応表を自動削除しない。

## 未完成・未検証

- このGASは認証/資格対応付けだけ。旧7 Callableの履歴保存・管理者監査/CSV・削除・期限処理を無料化したものではない。
- 日報UIDの端末履歴をGPS UIDのクラウドと結び付ける画面統合・操作端末の即時連動は未実装。2つのAuthと本人連携だけ、既存試験画面の明示ボタンへ実装した。日報default Authをログイン/ログアウトせず、別名TAXIAPP_GPS_DIARY_IDENTITYで同じ日報プロジェクトへ認証する。日報の別タブが認証変化で操作権を取得する副作用を避ける。GPS側も別名App。
- 権限は照合時点のスナップショット。日報側の停止/管理者資格変更の即時失効・再確認/有効期限のサーバー強制は今後実装が必要。現在のGPS側ルールは全拒否のままにし、この対応表だけで既存ルールを開放しない。
- 実OAuth付与・公開は完了。2026-11-01 JST、実Google認証とブラウザからGASの成功応答を確認。2人/複数端末は未検証。ローカルChromiumの実通信は既定プロキシ経由で証明書エラーとなり、TLS検証を解除していない。サーバー間の実拒否応答と、合成UI成功を混同しない。
- 認証試験ページと依存13ファイルだけはmain `5721c144` で公開済み。GPS側の許可ドメインも本人承認後に追加済み。本体UI/実GPSは未完了。登録資料・参照範囲はWORK_HANDOFF第7節と第12節を継承。

## ローカル確認

```sh
node --test tests/gps-account-bridge.test.js tests/gps-firebase-project.test.js tests/gps-cloud-policy.test.js
```

Apps Script APIとFirestoreを合成したVM試験。署名検証と実Google通信の成功ではない。再配置時もCode.gs/manifestを現況と照合する。

UI試験は `tests/gps-account-ui.browser.cjs`。合成時はボタン前SDK読込0・連携後もGPS停止・失敗表示・日報default Authを開始しないことを確認。`GPS_LIVE_BROKER=1` は不正な合成tokenだけで実公開窓口のCORSを調べる。現環境は証明書エラーで未成功。

[既存公開先での認証試験](../../docs/gps-identity-trial-review-20261031.md)のドメイン追加/試験公開も承認・適用済み。GAS権限付与・公開・token送信の再承認は不要。2026-11-01 JSTのGoogle再認証後、公開ページの実連携成功表示とGPS停止を確認。GASは対応表保存/読戻し一致後だけ成功。WORK_HANDOFF第16節を参照。

参考（公式）：[Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth)、[ID token検証](https://firebase.google.com/docs/auth/admin/verify-id-tokens)、[Apps Script OAuth token](https://developers.google.com/apps-script/reference/script/script-app#getoauthtoken)、[ContentService](https://developers.google.com/apps-script/guides/content)、[Apps Script利用枠](https://developers.google.com/apps-script/guides/services/quotas)。


## 現在の公開版：合成履歴API（版3）

本人承認後、[history/Code.candidate.gs](history/Code.candidate.gs)を既存GASデプロイの版3として公開済み。公開GETのrevision=history-v3/historyTrialOnly=trueと、既存試験ページから実本人による固定合成1地点の保存・内容照合・削除・墓標確認の成功を確認。公開時刻は画面2026/11/01 8:55、同じURL/実行者/全員アクセス/既存2スコープを維持。親Code.gsは版2の本人連携部を生成に使う基盤であり、現在の編集欄全文は生成した合成限定版3と一致する。

実REST Emulator8件・Node41件・実DOM合成試験の実績は[history/README.md](history/README.md)。mainには試験HTML/本人連携3JSだけを38c1a4cbで公開。[合成公開レビュー](../../docs/gps-history-gas-trial-review-20261101.md)の対象は承認/適用済みで再承認不要。実GPS停止・全拒否ルール・Sparkを維持。実履歴の送受信/他者閲覧/本体統合/03:00トリガーは未完了。

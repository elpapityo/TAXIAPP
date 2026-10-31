# TAXIGPS 認証連携：GPS専用Apps Script

## 現況と対象

Googleログインを有効にしたTAXIGPS用の、本人・利用資格・操作端末を対応付ける処理。別のGoogle管理アカウントに分けるのは**プロジェクトの管理者・保存先**であり、利用者は日報とGPSで同じGoogle本人であることを確認する。FirebaseのUIDが同じであることを前提にしない。

`Code.gs` と `appsscript.json` を、既存の日報/印刷用とは別の新しいApps Scriptへ保存した。編集画面:

https://script.google.com/home/projects/1K9U4UY-OcbjAuQg9D5iMRtl3_yTof-tXYR0qWRYFJgo4hWTX6Krk2NdQ/edit

**未実行・未公開・OAuth権限未付与**。保存済みコードとローカル合成試験がある段階で、実Google/API/Apps Script環境で成功したものではない。GPS画面へは未接続、`gps-cloud-policy.js` enabled:falseを維持する。

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

## 次に承認してもらう具体的操作

新しいスクリプトだけをウェブアプリとして配置し、**実行者はGPS管理アカウント、アクセスは全員**とする。呼出しURLは外部から到達できるが、`link`は両Firebase ID tokenの検証なしには動作しない。`doGet`は公開サービス名だけを返す。両token/本人IDのない匿名アクセスで利用者情報を返さない。

GPS管理アカウントに上記2スコープを承認してもらう。許可後に初めて実認証・実Firestore書込の受入を行う。課金プラン/請求先/有料Functions/Schedulerを有効にしない。Apps Scriptも利用枠があり、同じ管理アカウントの他スクリプトと枠を共用し得る。処理できなければ連携を停止し、日報を変更しない。

切戻し：新規GASのデプロイを無効化し、クライアント連携URLを設定しない/無効にする。新規権限の取消はGoogleアカウント側で行う。日報側のルール・GAS・原本は切り替えない。保存されたGPS対応表を自動削除しない。

## 未完成・未検証

- このGASは認証/資格対応付けだけ。旧7 Callableの履歴保存・管理者監査/CSV・削除・期限処理を無料化したものではない。
- 日報UIDの端末履歴を保持してGPS UIDのクラウドと結び付ける画面統合、2種類のAuthの起動/終了、操作端末との即時連動は未実装。
- 権限は照合時点のスナップショット。日報側の停止/管理者資格変更の即時失効・再確認/有効期限のサーバー強制は今後実装が必要。現在のGPS側ルールは全拒否のままにし、この対応表だけで既存ルールを開放しない。
- Apps Scriptの実OAuth・API有効化・ブラウザからのCORS/リダイレクト・2人/複数端末・実認証は未検証。実行できると断定しない。
- クラウド公開/本体UI/実GPSは未完了。登録資料・参照範囲はWORK_HANDOFF第7節と第12節を継承。

## ローカル確認

```sh
node --test tests/gps-account-bridge.test.js tests/gps-firebase-project.test.js tests/gps-cloud-policy.test.js
```

Apps Script APIとFirestoreを合成したVM試験。署名検証と実Google通信の成功ではない。公開前に`Code.gs`/manifestがリポジトリの内容と一致することを確認する。

参考（公式）：[Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth)、[ID token検証](https://firebase.google.com/docs/auth/admin/verify-id-tokens)、[Apps Script OAuth token](https://developers.google.com/apps-script/reference/script/script-app#getoauthtoken)、[ContentService](https://developers.google.com/apps-script/guides/content)、[Apps Script利用枠](https://developers.google.com/apps-script/guides/services/quotas)。

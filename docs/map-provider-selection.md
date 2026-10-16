# TAXIAPP 地図サービス・GPS・経路案内の採用選定（2026-10-16）

**ステータス：技術・料金・規約調査と設計選定済み／地図画面の実装・Google Cloudの課金設定は未実施。**  
GitHub対象：`elpapityo/TAXIAPP`。料金はGoogle Maps Platform公式サイトの2026-10-16確認時点。契約・課金・利用規約変更の際は再確認すること。

## 選定原則

1. 今無料で使えているGPS・住所変換・距離計算・日報保存は**機能が改善されることを確認するまで置換しない**。
2. Googleが同程度以上の使いやすさを**無料かつ当面の用途で課金発生を抑制できる**形で提供するなら採用。ただし「無料枠内」は「課金不可」と同義でない。
3. 一人・一日最大60件の乗務を前提に、無料枠や利用規約の範囲で運用を設計する。利用者増や機能追加には個別の再判定を設ける。
4. **Googleの表示地図とTAXIAPP独自のGPS位置・売上・業務記録を分離**。地図の切替で乗務の保存／GPS積算／数式計算が変わらない構造を優先する。
5. 地図を触る操作は停車中を前提にする。GPS精度悪化やバックグラウンド停止を地図で補間して売上・距離を確定しない。
6. 顧客情報・緯度経度の外部送信は目的・利用規約・個人情報保護を踏まえ最小化する。

## コードから確認した現在の実装

- `index.html` は `navigator.geolocation.getCurrentPosition()` によって乗車地・降車地・待機の座標を取得し、原則 `raw.D/H` と `meta.pickupGeo/dropGeo` などへ保存。
- `reverseAddress()` は国土地理院 `mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress` と市区町村一覧から町・丁目程度の表示文字列を生成。必要地点だけ変換。失敗してもGPS座標を保存し、住所を手入力できるようにする。
- `gps-trip.js`／`gps-trip-ui.js` はブラウザGPSの位置履歴からトリップ距離・実車／空車区分を計算し、補正・欠測検知。Google Maps APIは未使用。
- `googleShiftPacket()` は従来の乗務・RAW・集計をGoogle Sheetsへ同期する。地図選択でこの保存を変更しない。
- 現行 `index.html` には **地図描画ライブラリ・Google Maps iframe・Google Maps JS API・Google Routes APIの実装はない**。今あるのは位置取得／町丁目への住所変換／GPS距離試験計測。従って地図を「切り替える」のでなく、乗務画面へ新規追加する段階。

## 採用判定（確定）

| 機能 | 優先採用 | 理由と費用／制約 |
|---|---|---|
| 運転中の現在地取得・座標保存 | ブラウザGeolocation API（継続） | Google課金不要。画面消灯中の保証なし |
| GPSによる実車・空車・トリップ距離 | 既存`gps-trip.js`（継続） | 外部の有料距離API不要。中断は要手動補正 |
| 町丁目までの住所変換 | 既存の国土地理院逆ジオコーダ（継続） | 現状は無料・取得実績あり。地理院側動的機能の長期安定提供は保証されず、失敗時は手入力／座標保存 |
| **地図と日報入力の左右同時表示・現在地追従・乗降マーカー・クリックで地点選択** | **Leaflet＋地理院タイル**を第一選択 | 自由な独自操作・複数マーカー・GPS追従を実現。地理院タイルは通常のウェブ閲覧表示では出典明示のみで利用できる（各タイルの注意事項は個別確認） |
| Googleらしい地図の閲覧・経路概要・Street View | **Maps Embed API**を**任意表示レイヤ／切替表示**として採用候補 | Google公式：Embed SKUは利用料無料・無制限。ただし **Cloud請求先の有効化／APIキー** が必須。iframeを操作する内部APIは提供されず、アプリ独自マーカー複数制御・車両追従の主要地図には不向き。利用者承認とキー設定後に追加 |
| Googleでの経路検索・ナビ | **Google Maps URLs**でGoogleマップアプリ／Webを起動 | APIキー不要、Maps Platform請求不要。現在地・目的地はURLパラメータで渡す。経路の距離・所要時間をTAXIAPPが数値データとして取得する用途には使えない |
| 道路に沿った経路距離・所要時間をTAXIAPP内部で自動取得 | **今は採用しない**：必要が明確になった時のみRoutes APIを検討 | API請求・無料枠超過時の料金・地図利用規約・交通情報の必要性を再評価 |
| Google Maps JavaScript API | **通常運用ではまだ採用しない** | Dynamic Maps 2026-10時点：月10,000 map loads無料枠、超過後＄7／1,000 map loads（最初の有料帯）。独自地図制御は優秀だが請求先登録・利用回数監視が必要。ユーザーの「原則課金0円」に対しEmbedと地理院で多くの目的を達成できる |
| OpenStreetMapの公式無料タイル | 第一候補から外し、別途承認したタイル事業者／自前タイルを予備候補 | OSMデータはオープンでもOSMFタイル配信は善意の共有インフラ。出典、キャッシュ、使用量等のポリシーに従い、無制限／業務利用継続を保証できない |
| Google Sheetsへの乗務・日報保存 | 既存GAS／Google Sheetsを維持 | 地図の選択とデータ同期は独立させる |

**判断：主要な運用地図は地理院タイル＋Leaflet。Google製で無料かつ閲覧性の高いMaps Embed APIは任意の「Google地図」切替に採用候補。経路検索ボタンは無料のMaps URLs。** これは「Googleが無料で機能的に有利ならGoogleを選ぶ」という希望と、独自地図操作・追加課金防止を両立する実装方針。

## Googleの重要な制約・料金の区分（2026-10-16確認）

- `Maps Embed API`：公式価格表では「Embed：Unlimited／$0」。ただし有効なCloud課金先とAPIキーが必要、Maps Embed APIのみ有効化・APIキーをEmbed専用／HTTPリファラー制限して誤利用を防ぐ。無料のEmbedを有効にするだけでRoutes／Geocoding等も無料になるわけではない。
- `Google Maps URLs`：Google Mapsの経路検索・地図表示へリンクするだけならAPIキー不要。アプリに道路距離やルート線などの解析データは返らない。
- `Maps JavaScript API`：`Dynamic Maps`の無料枠は月間10,000地図読み込み（1営業＝1読み込みとは限らない）。無料枠後は料金が掛かるため「60営業／日だから絶対無料」と断定しない。地図の拡大・移動と初期ロードでは課金の扱いが異なる。Places、Directions／Routesなど別SKU利用は別途料金。
- 費用発生を絶対避ける優先度が高い間は、**無料枠依存の有料SKUを無断で有効化しない**。予算アラートは支出を機械的に停止するものではない。採用する場合はAPI単位のクォータ・キー制限・予算アラートを同時設定し、運用監視を続ける。
- EmbedはGoogle iframeであり、TAXIAPPの座標に合わせてiframe表示を更新することは可能だが、地図内部のクリック・位置マーカーを自由にプログラム操作したり、地図内部の位置イベントを受け取ってRAWに自動入力する自由度は限定的。TAXIAPP主要地図にはLeafletが向く。
- Google Geocoding APIの結果には保存・地図上の表示・帰属表示に関する規約がある。**国土地理院など非Google地図と組み合わせるため、Google Geocodingの結果を無条件に混ぜる設計にしない**。

### 使用量目安（一人、最大60件／日、30日＝1,800営業／月）

- 60営業は、Maps JavaScript APIの読み込み60回とは限らない。乗務入力の都度地図を新規作成しなければ読み込みを抑えられるが、アプリ再読み込みで増える。
- Maps Embed APIの地図表示・経路表示は公式の「使用量無料・無制限」区分。Googleの別APIは有料になり得る。
- 国土地理院のタイル配信と逆ジオコーダも、TAXIAPPが妥当な頻度で使い、取得失敗の時は情報表示を停止／手入力できる設計にする。
- ユーザーに未承認のAPI登録・カード登録・有料契約をさせない。Google表示を有効化する場合、Cloud設定は**別途ユーザーの明示承認**を取る。

## UI設計（iPadTaxiに近づける）

### タブレット・PC（幅に余裕がある場合）

左：現在の営業種別、乗車・降車ボタン、金額、現金・QR・チケット等の複合決済、確認情報、GPS計測状態。  
右：地図（Leaflet＋地理院タイルを初期表示）、現在地マーカー、乗車地／降車地マーカー、追従のオン／オフ、地図全画面ボタン、Google地図切替（設定がある場合）、Googleナビを開くボタン。  
幅は画面サイズに応じて可変。地図の全画面・折りたたみで編集中の乗務データを破棄しない。**地図を切り替えてもGPS測位監視を重複起動しない**。

### スマホ

縦向きでは「入力／地図」の切替式、または地図を低い高さのミニ地図として表示して拡大可能にする。狭い画面で常時左右分割はしない。横向きで十分な画面幅がある場合に分割。走行中の操作を促さず、主要操作は停車後。

### データの契約

- 各乗務レコードの `pickupGeo`, `dropGeo`、位置取得精度・計測時刻などの従来の保存形式を維持。地図だけがそれらの読み取り専用ビューになる。
- 地図をタップして地点選択する場合はユーザーに「乗車地点／降車地点」を明示的に選ばせ、位置座標は座標として保存、住所変換は別の無料処理を使う。地図データの入力で料金が自動計上されない。
- Google iframeとLeafletで位置レイヤは別物。**Google iframe側の地図タップから座標の回収ができると約束しない**。
- GPSトリップ距離は車両トリップでの補正可能な試験機能のまま維持し、地図を導入するだけで過去記録や実車／空車距離が変わらない。

## 段階的な導入順（未実装）

1. `Leaflet＋地理院タイル` の地図コンポーネントを**試験表示（オフ可能）**として追加。現在地、乗降地点、追従、地図全画面、横画面分割／縦画面切替。GPSや既存入力・RAW保存には副作用なし。
2. Google Maps URLs の「Googleで経路検索／ナビを開く」ボタンを実装。料金なし・キー不要。利用者が行き先を選択してから開く。
3. 実機比較後に、ユーザーが請求先登録を承認した場合のみ Google Maps Embed API の表示切替を追加する。鍵はGoogle Cloud側で**Embed API限定＋Webリファラー制限**。Google利用不可なら既存の地理院地図へ復帰。
4. 将来、Google JSの高度な独自地図操作が明らかに有利な場合、実測読み込み頻度と毎月無料枠、上限と予算監視の設定を確認して**個別に許可を取ってから**採用を再検討。
5. 「全画面GPS追従中に画面が消える」問題は地図APIの種類では解決しない。AndroidネイティブのGPS foreground serviceが必要な場合は別開発項目。

## 公式情報（2026-10-16確認）

1. [Google Maps Platform 料金表](https://developers.google.com/maps/billing-and-pricing/pricing)
2. [Maps Embed API の無料・無制限利用とキー要件](https://developers.google.com/maps/documentation/embed/usage-and-billing)
3. [Maps Embed API（表示・経路・検索・ストリートビュー）](https://developers.google.com/maps/documentation/embed/embedding-map)
4. [Google Maps URLs：キー不要](https://developers.google.com/maps/documentation/urls/get-started)
5. [Google Maps APIキーの使用制限のベストプラクティス](https://developers.google.com/maps/api-security-best-practices)
6. [Google Geocodingの利用・保存・地図表示ポリシー](https://developers.google.com/maps/documentation/geocoding/policies)
7. [地理院タイルの利用条件（表示時の出典記載など）](https://maps.gsi.go.jp/help/use.html)
8. [国土地理院の公開コードでの動的サービスの提供上の注意](https://github.com/gsi-cyberjapan/gsimaps)
9. [OpenStreetMap公式タイル利用条件](https://operations.osmfoundation.org/policies/tiles/)

以上は選定仕様であり、**現在のTAXIAPPに新しい地図画面やGoogle APIキーはまだ設定していない**。既存の日報・GPS・Google Sheets・料金精算を壊さないため、実装は画面コンポーネントから段階的に行う。

# IC位置データのテスト投入仕様

2026-11-13更新。実データは `data/ic-positions.json` に登録済み。`ic-name-test.html` は同じサーバーのJSONを自動取得する。TAXIAPP本体への統合・本番公開は行っていない。

## 現在使える範囲

国土交通省N06-25から2025年12月31日時点で設置されている接合部種別1（一般IC）・2（スマートIC）・3（JCT）を抽出し、全国2,351件を収録。対象路線だけに推測で分類して取りこぼすことを避け、全国の原典現況点を保持している。種別4（PA等を含むその他）は検索対象外。すべてIC/JCTの代表点であり、個々の入口・出口のランプ座標ではない。

阪神高速の公式案内の出入口144行・JCT35行を全件照合した。出入口131行、JCT24行で原典の代表点を特定。未照合24行は `data/ic-coverage-audit.json` に記録。代表点との照合成立を、全ランプ・全方向の位置確認とみなさない。第二神明・第二京阪の不足は残っている。詳細は `docs/ic-position-handoff-20261113.md`。

## JSON形式

UTF-8の `{"schema_version":1,"items":[...]}`。各要素の必須項目は `name`, `latitude`, `longitude`。座標は有限の数値のみ。`null`・空文字・数値文字列は拒否する。

- `id`: 原典関係IDと地物内容のSHA-256先頭12桁。関係IDだけでは海老江IC/JCT等が重複するため、原典の異なる地物を別IDで保持する。
- `source_feature_id`, `source_name`, `source_coordinates`: 原典のID・名称・[経度,緯度]。原典はJGD2011/EPSG:6668。
- `latitude`, `longitude`: pyprojでEPSG:4326へ変換。今回の変換操作はJGD2011 to WGS 84 (1)、公称精度1m。実ランプ位置の精度を保証する数値ではない。
- `road`, `road_geometry_matches`: 同じ原典の現況路線形状に対してEPSG:3857上で0.5m以内に重なる路線候補。最近傍の道路を割り当てない。交差・重複もあり、接続の公式確認とは区別して `road_verification=geometry_only`。甘楽SICの路線は特定できず空欄。
- `type`, `type_code`: N06_019の公式コード。名称末尾から推測しない。
- `position_kind=joint_representative`: 接合部代表点。
- `entrance`, `exit`, `direction`: 現段階ではすべて `null`（未収録）。`null`は「入口なし」「出口なし」を意味しない。
- `verified_at`: 取込確認日。`source_as_of`（基準日）と区別する。実機・現地照合完了日ではない。
- `hanshin_catalog_matches`: 公式一覧と名称・路線候補が対応した項目。併記名は原典がまとめた代表点のまま保持し、別ランプへ複製しない。

## 出典・利用条件

[国土交通省N06-2025](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N06-2025.html) の2025年末現況のみを使用。公式ページ上、2018年度以降の現況データ利用はCC BY 4.0、時系列履歴利用は非商用。今回の出力は履歴データを含まない。原典に最初から存在する重複した関係IDは削除・統合しない。

帰属表示：**国土交通省 国土数値情報（高速道路時系列データ・2025年）を加工して作成**。原典URL、ZIPのSHA-256、変換操作、基準日、確認日、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)をJSONと画面に記録。

阪神高速の[出入口・JCT案内図](https://www.hanshin-exp.co.jp/drivers/ryoukin/annai/route/)は照合資料として使用。[サイトポリシー](https://www.hanshin-exp.co.jp/drivers/hoshin/sitepolicy.html)には転載の制限があるため、独自CSVや案内図の原本をリポジトリに転載せず、独自座標による穴埋めも行っていない。方向一覧は原典N06には存在しない。再配布可能な根拠データの確保が残作業。

## 再生成

Python 3.12で確認。以下をリポジトリルートから実行する。原典のダウンロード先は作業用ディレクトリであり、Gitへ追加しない。

```powershell
python -m pip install -r scripts/requirements-ic-data.txt
New-Item -ItemType Directory -Force .cache/ic-sources | Out-Null
Invoke-WebRequest 'https://nlftp.mlit.go.jp/ksj/gml/data/N06/N06-25/N06-25_GML.zip' -OutFile .cache/ic-sources/N06-25_GML.zip
Invoke-WebRequest 'https://www.hanshin-exp.co.jp/drivers/ryoukin/annai/route/js/route.json' -OutFile .cache/ic-sources/hanshin-route.json
python scripts/prepare-ic-position-data.py .cache/ic-sources/N06-25_GML.zip --hanshin-list .cache/ic-sources/hanshin-route.json --checked-at 2026-11-13
python -m http.server 8765 --bind 127.0.0.1
```

確認日を実際の取得日に置き換える。N06-25のUTF-8 GeoJSON・EPSG:6668を検査し、旧年度ZIP、空出力、ID重複、必須属性欠落等では既存の位置JSONを上書きしない。

別ターミナルで `python tests/ic-position-browser.py`。PlaywrightとChromeが必要（`python -m pip install playwright`）。ブラウザで `http://127.0.0.1:8765/ic-name-test.html` を開けば手動検索できる。

## 検証地点

阪急伊丹駅のサンプル座標はN02-25鉄道データ（阪急電鉄・伊丹線・伊丹、駅コード006714）の駅形状の重心から算出した34.779915, 135.41373。駅の形状・原典SHA-256・算出方法を `tests/fixtures/ic-search-origins.json` に保存。地図の表示中心を駅の座標として流用していない。

伊丹10kmで26件を確認。ほかに三木小野・門真JCT・垂水JCT/IC・高槻JCTの原典座標で検索検証。GPS実測・Galaxy/iPhone・実走行・2026年新設変更は未検証。検索結果は直線距離であり、進入経路・利用可否・走行距離を示さない。

## 2026-11-22 補完データ・方向の取り込み

上の節は11月13日時点の記録。現在のテスト画面は同一サーバー上の以下のデータを取得する。

| ファイル | 収録内容 |
| --- | --- |
| `data/ic-positions.json` | 国土交通省N06-25の2025年末現況、代表点2,351件。CC BY 4.0 |
| `data/ic-positions-osm.json` | 2026-11-21 00:15:44 UTCの関西OSMデータで位置を補完した48点。ODbL 1.0 |
| `data/ic-coverage-audit.json` | 阪神高速公式掲載の出入口144行・JCT案内35行の照合、阪神高速と第二京阪7施設の方向情報 |

OSMの接続点は、国土交通省または道路管理者の一覧・接続案内と、OSMの名称と道路の接続を照合して選んだ。複数点がある施設では、原典にある別々の点を表示する。座標の平均・補間によるランプ位置は使用していない。各点にOSMノードURL、公式資料URL、原典名を記録。布引JCTは原典の名称付きノード、蛍池JCTは公式案内図の池田出口と本線が分かれる接続点を使う。箕谷の出入口2行とJCT1行には同じ国交省代表点を関連付け、方向は出入口ごとに表示する。

方向資料の `access.entrance` と `access.exit` は該当方向の配列。空配列は公式案内上で施設がないこと、nullは未収録を示す。方向の出典は `access.source`。分岐が複数ある場合も、方向は施設単位の案内であり、個々の座標への方向割当は未収録。照合上の出典は `source` または `matching_evidence`。出入口・JCTの掲載行数と検索用座標点数は異なる。

第二神明と北線は、国交省の施設表に掲載の須磨、名谷、高丸、大蔵谷、伊川谷、玉津、大久保、明石西、学園南、長坂を補完。第二京阪は同表掲載17出入口を補完した。久御山JCTは補完データ、八幡京田辺JCT・門真JCTはN06に収録している。中国道・名神・新名神・山陽道・神戸淡路鳴門道・近畿道等の代表点はN06を使用。その他対象路線の全施設照合と、全路線の方向別ランプ座標・通行規制・2026年の全変更の確認は未完了。

OSMは [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) および [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) を表示。加工済みOSMデータは独立したJSONで取得でき、国交省のCC BY 4.0データとは別々に配布する。阪神高速の案内図・独自データ原本は照合用に参照し、元ファイルおよび阪神高速の座標を同梱していない。

### 再生成

`osmium==4.3.2` と既存の `scripts/requirements-ic-data.txt` を使用。照合済みOSM IDをスクリプトに記録している。PBF配布先は更新されるため、同一結果にはJSON記載の基準時刻・SHA-256の原典を使う。異なるスナップショットから出力する場合はID・名称・接続を再照合する。

```sh
python scripts/prepare-ic-osm-data.py kansai.osm.pbf
python scripts/prepare-ic-position-data.py N06-25_GML.zip --hanshin-list hanshin-route.json --osm data/ic-positions-osm.json --checked-at 2026-11-22 --audit-only
python -m http.server 8765 --bind 127.0.0.1
```

別ターミナルで `python tests/ic-position-browser.py`。PlaywrightでChromiumを導入するか、`IC_TEST_CHROMIUM` に実行ファイルを指定する。阪急伊丹駅、三木小野、門真、垂水、高槻、玉津、交野南、大開を検索する。現在地ボタンの実GPS受入と公開環境の受入は別途検証する。

2026-11-22の検証では、ChromiumのローカルHTTP表示で計2,399点を取得。阪急伊丹駅10kmは27件、三木小野・門真・垂水・高槻・玉津・交野南・大開の3kmは順に1、5、7、2、3、2、17件。交野南は大阪方面の出入り、大開は西行き入口・東行き出口を表示。位置データ本体のHTTP503、不正座標、空入力、OSM補完のHTTP503時に国交省データで検索を継続することも確認した。

阪神高速は179行中179行を位置データに対応付けた。出入口のうち135行は国交省代表点、2行は箕谷の共有代表点、7行はOSMの接続点。JCT案内のうち26行は国交省代表点、1行は箕谷の共有代表点、8行はOSMの接続点。2026年差分の確認では [NEXCO西日本の開通区間](https://corp.w-nexco.co.jp/activity/open_info/opened_area.html) に示された新名神の車線増設と、[阪神高速のETC専用化](https://www.8405.jp/?mode=etc_only) を確認した。ETC専用化・工事規制は検索の方向判定に使わない。

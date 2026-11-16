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

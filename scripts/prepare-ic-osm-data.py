#!/usr/bin/env python3
"""公式の名称・所属路線と照合。 OSMの選定済み接続点をODbLのJSONに変換する。"""

import argparse
import hashlib
import json
from pathlib import Path

import osmium

HANSHIN = 'https://www.hanshin-exp.co.jp/drivers/ryoukin/annai/route/'
MLIT = 'https://www.mlit.go.jp/statistics/details/content/001868394.pdf'
NEXCO = 'https://www.w-nexco.co.jp/etc/maintenance/kinki/'
KEIHAN = 'https://www.kkr.mlit.go.jp/naniwa/dainikeihan10th/shared/pdf/backnumber/66_h22_winter.pdf'

# 各行のOSMノードIDは名称と接続する道路を個別に照合済み。
# 同じICの本線上に複数の分岐点がある場合は、それぞれ元の座標を使う。
GROUPS = (
    ('第二神明道路', MLIT, (
        ('須磨', 2580565973), ('名谷', 864336960),
        ('高丸', 954681801, 1948975913), ('大蔵谷', 954681750, 954681840),
        ('玉津', 1939291315, 9898883547), ('大久保', 1825961671, 1825961712),
        ('明石西', 1825962836),
    )),
    ('第二神明道路 ／ 阪神高速7号北神戸線',
     'https://www.w-nexco.co.jp/search/jct_map/kansai/pdfs/ikawadani.pdf', (
        ('伊川谷IC/JCT', 1111347045),
    )),
    ('第二神明道路北線', NEXCO, (
        ('学園南', 1111347145), ('長坂', 309435169),
    )),
    ('第二京阪道路', MLIT, (
        ('鴨川東', 6380141552), ('鴨川西', 1417964113), ('上鳥羽', 296119668),
        ('城南宮北', 2028071543), ('城南宮南', 2028071574), ('伏見', 2028071580),
        ('巨椋池', 1399651508), ('久御山南', 1938933738), ('八幡東', 1938931071),
        ('京田辺松井', 1938923383), ('枚方東', 611613507), ('枚方学研', 1497233696),
        ('交野北', 1930880780), ('交野南', 1735942967),
        ('寝屋川北', 1930698614), ('寝屋川南', 665880916),
        ('第二京阪門真', 1614276396),
    )),
    ('第二京阪道路 ／ 京滋バイパス', KEIHAN, (
        ('久御山JCT', 574286095),
    )),
    ('阪神高速2号淀川左岸線', HANSHIN, (
        ('大開', 2336793395), ('正蓮寺川', 2336793434), ('淀川左岸舞洲', 1445151656),
    )),
    ('阪神高速4号湾岸線', HANSHIN, (
        ('助松', 1604508765), ('天保山', 1389063768),
    )),
    ('阪神高速11号池田線', HANSHIN + 'images/jct_img22.png', (
        ('蛍池JCT', 442132170),
    )),
    ('阪神高速12号守口線', HANSHIN, (
        ('守口（R1）', 367129345),
    )),
    ('阪神高速6号大和川線', HANSHIN, (
        ('常磐', 7273728759, 7273736051),
    )),
    ('阪神高速1号環状線 ／ 阪神高速12号守口線', HANSHIN, (
        ('天神橋JCT', 241792923),
    )),
    ('阪神高速1号環状線 ／ 阪神高速14号松原線', HANSHIN, (
        ('えびすJCT', 1830616087),
    )),
    ('阪神高速15号堺線 ／ 阪神高速17号西大阪線', HANSHIN, (
        ('南開JCT', 306535200),
    )),
    ('阪神高速5号湾岸線 ／ 第二神明道路', HANSHIN, (
        ('名谷JCT', 380065929),
    )),
    ('阪神高速3号神戸線 ／ 阪神高速16号大阪港線', HANSHIN, (
        ('阿波座JCT', 982336083),
    )),
    ('阪神高速4号湾岸線 ／ 阪神高速5号湾岸線', HANSHIN, (
        ('南港JCT', 380451376),
    )),
    ('阪神高速32号新神戸トンネル', HANSHIN, (
        ('布引JCT', 1443871854),
    )),
)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path)
    parser.add_argument('--output', type=Path, default=Path('data/ic-positions-osm.json'))
    args = parser.parse_args()
    selection = {node_id: (name, road, catalog)
                 for road, catalog, rows in GROUPS for name, *ids in rows for node_id in ids}
    items = {}
    reader = osmium.io.Reader(str(args.pbf))
    as_of = reader.header().get('osmosis_replication_timestamp')
    reader.close()
    if not as_of:
        parser.error('OSMスナップショットの基準時刻がありません')

    class ReadJunctions(osmium.SimpleHandler):
        def node(self, node):
            if node.id not in selection:
                return
            if node.tags.get('highway') != 'motorway_junction' or not node.location.valid():
                raise ValueError(f'OSMノード {node.id} の種別・座標が変わりました')
            name, road, catalog = selection[node.id]
            original_name = node.tags.get('name:ja') or node.tags.get('name')
            if not original_name:
                raise ValueError(f'OSMノード {node.id} の名称がありません')
            kind = '一般IC'
            if name.endswith('IC/JCT'):
                kind = 'IC/JCT'
            elif name.endswith('JCT'):
                kind = 'JCT'
            items[node.id] = {
                'id': f'osm-node-{node.id}', 'name': name, 'road': road,
                'type': kind,
                'position_kind': 'osm_motorway_junction',
                'latitude': node.location.lat, 'longitude': node.location.lon,
                'source': f'https://www.openstreetmap.org/node/{node.id}', 'source_name': original_name,
                'catalog_source': catalog, 'road_verification': 'official_catalog_and_osm',
                'entrance': None, 'exit': None, 'direction': None,
            }

    collector = ReadJunctions()
    for node in osmium.FileProcessor(args.pbf, osmium.osm.NODE):
        collector.node(node)
    if items.keys() != selection.keys():
        parser.error(f'OSM原典で未取得のノード: {sorted(selection.keys() - items.keys())}')
    with args.pbf.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    result = {
        'schema_version': 1, 'source_as_of': as_of, 'source_sha256': digest,
        'source_download': 'https://download.openstreetmap.fr/extracts/asia/japan/kansai.osm.pbf',
        'coordinate_system': 'EPSG:4326', 'license': 'ODbL-1.0',
        'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
        'attribution': '© OpenStreetMap contributors',
        'limitations': '選定した本線側の接続点。各ICの全ランプや料金所の位置は未収録。',
        'items': [items[node_id] for node_id in selection],
    }
    temp = args.output.with_suffix('.json.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(args.output)

if __name__ == '__main__':
    main()

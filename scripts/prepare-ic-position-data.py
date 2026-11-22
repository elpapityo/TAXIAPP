#!/usr/bin/env python3
"""N06-25の2025年末現況だけを変換。ランプ座標の補間は行わない。"""
import argparse, hashlib, json, math, pathlib, re, sys, unicodedata, zipfile
from collections import Counter
from pyproj import Transformer
from shapely.geometry import shape
from shapely import transform
from shapely.strtree import STRtree

SOURCE = 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N06-2025.html'
DOWNLOAD = 'https://nlftp.mlit.go.jp/ksj/gml/data/N06/N06-25/N06-25_GML.zip'
HANSHIN = 'https://www.hanshin-exp.co.jp/drivers/ryoukin/annai/route/'
TYPES = {'1': '一般IC', '2': 'スマートIC', '3': 'JCT', '4': 'その他の接合部'}

# 原典の併記・旧称で個別確認できた代表点。公式案内に基づき関連付ける。
# 箕谷は共有点として扱い、3か所の個別ランプ座標には展開しない。
REVIEWED = {
    ('doorway', '天美'): ('EA03_826007-6e1344a896f8',
                         'https://www.hanshin-exp.co.jp/company/torikumi/useful/yamatogawa/'),
    ('doorway', '中之島西'): ('EA03_716003-dcc7c60409fd', 'https://www.openstreetmap.org/node/1019867785'),
    ('doorway', '西宮'): ('EA03_716902-53b5b11c21ac', 'https://www.openstreetmap.org/node/302504482'),
    ('doorway', '湾岸舞洲'): ('EA03_717003-52ddc3ad44ba',
                           'https://www.hanshin-exp.co.jp/drivers/douro/topics/2013-0628-1440.pdf'),
    ('doorway', '北神戸箕谷'): ('EA03_719011-85dc1e9fdcb6', HANSHIN + 'images/jct_img01.png'),
    ('doorway', '新神戸箕谷'): ('EA03_719011-85dc1e9fdcb6', HANSHIN + 'images/jct_img01.png'),
    ('jct', '箕谷JCT'): ('EA03_719011-85dc1e9fdcb6', HANSHIN + 'images/jct_img01.png'),
    ('jct', '垂水JCT'): ('EA03_646003-da161b26f0c6', HANSHIN + 'images/jct_img04.png'),
    ('jct', '豊中IC'): ('EA03_518058-fe048e077680', HANSHIN + 'images/jct_img31.png'),
}
NEXCO_KEIHAN = 'https://corp.w-nexco.co.jp/corporate/release/hq/h21/1130a/'
KEIHAN_DIRECTIONS = {
    '京田辺松井': '大阪方面', '枚方学研': '大阪方面', '交野北': '京都方面',
    '交野南': '大阪方面', '寝屋川北': '京都方面', '寝屋川南': '大阪方面',
    '第二京阪門真': '京都方面',
}

def normalize_direction(value):
    if value in {'ー', '－', '-'}:
        return []
    if value == '○':
        return ['環状線 一方通行']
    if value in {'環状線入り口', '環状線出口'}:
        return ['環状線']
    # 条件付きの案内もそのまま条件を保持する。未確認値から方角を補完しない。
    directions = [v.strip() for v in value.split('、')]
    flags = re.compile(r'(?:(?:大和川線|大阪港線)?[東西南北]行き(?:（六甲アイランド北入口から走行時）)?|六甲アイランド北方面|環状線出口)')
    return directions if all(flags.fullmatch(v) for v in directions) else None

def access_record(entrance, exit_, source):
    if entrance is None and exit_ is None:
        return None
    return {'entrance': entrance, 'exit': exit_, 'direction': 'by_entrance_or_exit', 'source': source}

def current(p, start, end):
    return int(p[start]) <= 2025 <= int(p[end])

def read_layer(z, kind):
    ns = [n for n in z.namelist() if pathlib.PurePosixPath(n).name == f'N06-25_{kind}.geojson' and '/UTF-8/' in n]
    if len(ns) != 1:
        raise ValueError(f'UTF-8/{kind}.geojsonを一意に特定できません')
    layer = json.loads(z.read(ns[0]))
    if layer.get('crs', {}).get('properties', {}).get('name') != 'urn:ogc:def:crs:EPSG::6668':
        raise ValueError('未対応の座標系です。既存JSONは変更しません')
    return layer['features']

def normal(s):
    return unicodedata.normalize('NFKC', s).strip()

def names(s):
    # 原典に明記された併記名だけ展開。同じ代表点から別ランプを生成しない。
    s = normal(s)
    result = {s}
    if s.endswith('IC/JCT') or s.endswith('JCT/IC'):
        base = re.sub(r'(?:IC/JCT|JCT/IC)$', '', s)
        result.update((base, base + 'IC', base + 'JCT'))
    else:
        result.update(s.split('/'))
    return result

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('zipfile', type=pathlib.Path)
    p.add_argument('--output', type=pathlib.Path, default=pathlib.Path('data/ic-positions.json'))
    p.add_argument('--hanshin-list', type=pathlib.Path, required=True, help='公式route.json（照合専用・原本は配布しない）')
    p.add_argument('--audit', type=pathlib.Path, default=pathlib.Path('data/ic-coverage-audit.json'))
    p.add_argument('--checked-at', required=True, help='取得・確認日 YYYY-MM-DD')
    p.add_argument('--osm', type=pathlib.Path, help='照合に使う、独立したODbL補完JSON')
    p.add_argument('--audit-only', action='store_true', help='国交省の位置JSONを保持し、照合結果だけ更新')
    a = p.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', a.checked_at):
        p.error('checked-atはYYYY-MM-DDで指定してください')
    with zipfile.ZipFile(a.zipfile) as z:
        joints, roads = read_layer(z, 'Joint'), read_layer(z, 'HighwaySection')
    roads = [f for f in roads if current(f['properties'], 'N06_002', 'N06_003')]
    # 同一原典の点と路線形状が重なる場合だけ関連候補を記録。最近傍割当は禁止。
    project = Transformer.from_crs(6668, 3857, always_xy=True).transform
    wgs84 = Transformer.from_crs(6668, 4326, always_xy=True)
    tree = STRtree([transform(shape(f['geometry']), project, interleaved=False) for f in roads])
    items = []
    for f in joints:
        props = f['properties']
        if not current(props, 'N06_013', 'N06_014'):
            continue
        if str(props['N06_019']) == '4':
            continue  # PA等をICとして検索結果へ混ぜない。
        if f['geometry']['type'] != 'Point':
            raise ValueError('接合部がPointではありません')
        lon, lat = f['geometry']['coordinates']
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (lat, lon)) or not (20 < lat < 46 and 122 < lon < 154):
            raise ValueError('原典の座標範囲が不正です')
        indices = tree.query(transform(shape(f['geometry']), project, interleaved=False), predicate='dwithin', distance=0.5)
        matches = sorted({roads[int(i)]['properties']['N06_007'] for i in indices})
        lon, lat = wgs84.transform(lon, lat)
        items.append({
            'id': props['N06_015'] + '-' + hashlib.sha256(json.dumps(f, sort_keys=True).encode()).hexdigest()[:12],
            'name': props['N06_018'], 'latitude': lat, 'longitude': lon,
            'road': ' ／ '.join(matches), 'road_geometry_matches': matches,
            'road_verification': 'geometry_only' if matches else 'unresolved',
            'type': TYPES[str(props['N06_019'])], 'type_code': str(props['N06_019']),
            'position_kind': 'joint_representative', 'entrance': None, 'exit': None, 'direction': None,
            'source': SOURCE, 'source_feature_id': props['N06_015'], 'source_name': props['N06_018'],
            'source_coordinates': f['geometry']['coordinates'],
            'source_start_year': props['N06_013'], 'source_end_year': props['N06_014'],
            'verified_at': a.checked_at, 'verification': 'official_dataset_imported',
        })
    items.sort(key=lambda x: x['id'])
    if not items or len({x['id'] for x in items}) != len(items):
        raise ValueError('出力が空、または現況IDが重複。既存JSONは変更しません')
    official = json.loads(a.hanshin_list.read_text(encoding='utf-8-sig'))
    by_id = {item['id']: item for item in items}
    osm_items = json.loads(a.osm.read_text(encoding='utf-8'))['items'] if a.osm else []
    audit = []
    for kind in ('doorway', 'jct'):
        for row in official[kind]:
            title = normal(row['title'])
            route = '阪神高速' + row['route'] if kind == 'doorway' else None
            route_names = {route}
            if route == '阪神高速32号新神戸トンネル':
                route_names.add('阪神高速32号線')
            candidates = [x for x in items if title in names(x['source_name'])
                          and (bool(route_names.intersection(x['road_geometry_matches'])) if route else any(r.startswith('阪神高速') for r in x['road_geometry_matches']))]
            global_candidates = [x for x in items if title in names(x['source_name'])]
            reason = ('ambiguous_name' if len(candidates) > 1 else
                      'road_mismatch' if global_candidates else 'no_matching_name')
            evidence = None
            resolution = 'matched_representative' if len(candidates) == 1 else 'unresolved'
            if (kind, title) in REVIEWED:
                selected_id, evidence = REVIEWED[kind, title]
                candidates = [by_id[selected_id]]
                resolution = 'matched_shared_representative' if '箕谷' in title else 'matched_representative'
            elif resolution == 'unresolved':
                supplement = [x for x in osm_items if normal(x['name']) == title
                              and (x['road'] == route if route else
                                   x['type'] == 'JCT' and x['road'].startswith('阪神高速'))]
                if supplement:
                    candidates = supplement
                    resolution = 'matched_osm_position'
            entry = {'name': row['title'], 'kind': kind, 'road': route,
                     'status': resolution, 'reason': reason if resolution == 'unresolved' else None,
                     'matched_ids': [x['id'] for x in candidates], 'source': HANSHIN}
            if evidence:
                entry['matching_evidence'] = evidence
            if kind == 'doorway':
                access = access_record(normalize_direction(row['entrance']),
                                       normalize_direction(row['exit']), HANSHIN)
                if access is not None:
                    entry['access'] = access
            audit.append(entry)
            if resolution in {'matched_representative', 'matched_shared_representative'}:
                candidates[0].setdefault('hanshin_catalog_matches', []).append(
                    {'name': row['title'], 'kind': kind, 'road': route})
    other_access = []
    for x in osm_items:
        if x['road'] == '第二京阪道路' and x['name'] in KEIHAN_DIRECTIONS:
            directions = [KEIHAN_DIRECTIONS[x['name']]]
            other_access.append({'name': x['name'], 'road': x['road'], 'matched_ids': [x['id']],
                                 'access': access_record(directions, directions, NEXCO_KEIHAN)})
    summary = {k: dict(Counter(x['status'] for x in audit if x['kind'] == k)) for k in ('doorway', 'jct')}
    result = {
        'schema_version': 1, 'source': SOURCE, 'source_download': DOWNLOAD,
        'source_sha256': hashlib.sha256(a.zipfile.read_bytes()).hexdigest(),
        'source_as_of': '2025-12-31', 'checked_at': a.checked_at,
        'license': 'CC BY 4.0（2025年末現況のみ。時系列履歴利用は含まない）',
        'license_url': 'https://creativecommons.org/licenses/by/4.0/',
        'attribution': '国土交通省 国土数値情報（高速道路時系列データ・2025年）を加工して作成',
        'coordinate_system': 'EPSG:4326', 'source_coordinate_system': 'EPSG:6668',
        'coordinate_operation': wgs84.description, 'coordinate_operation_accuracy_m': wgs84.accuracy,
        'coverage': '全国の原典現況接合部。ランプ別・方向別の全件収録ではない。',
        'limitations': '路線は原典形状と0.5m以内で重なる候補。交差だけの場合もあり接続保証ではない。入口・出口・方向は未収録。2026年の新設・変更は未反映。',
        'hanshin_catalog_summary': summary, 'items': items,
    }
    write_json(a.audit, {'checked_at': a.checked_at, 'source': HANSHIN, 'summary': summary,
                         'items': audit, 'other_access': other_access})
    if not a.audit_only:
        write_json(a.output, result)
    print(json.dumps({'items': len(items), 'road_unresolved': sum(not x['road'] for x in items), 'hanshin': summary}, ensure_ascii=True))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as e:
        sys.exit(str(e))

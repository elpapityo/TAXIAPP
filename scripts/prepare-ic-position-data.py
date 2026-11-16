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
    audit = []
    for kind in ('doorway', 'jct'):
        for row in official[kind]:
            route = '阪神高速' + row['route'] if kind == 'doorway' else None
            route_names = {route}
            if route == '阪神高速32号新神戸トンネル':
                route_names.add('阪神高速32号線')  # 同じ32号の原典表記。名称を上書きしない。
            candidates = [x for x in items if normal(row['title']) in names(x['source_name'])
                          and (bool(route_names.intersection(x['road_geometry_matches'])) if route else any(r.startswith('阪神高速') for r in x['road_geometry_matches']))]
            global_candidates = [x for x in items if normal(row['title']) in names(x['source_name'])]
            reason = None if len(candidates) == 1 else ('ambiguous_name' if len(candidates) > 1 else 'road_mismatch' if global_candidates else 'no_matching_name')
            audit.append({'name': row['title'], 'kind': kind, 'road': route,
                          'status': 'matched_representative' if len(candidates) == 1 else 'unresolved',
                          'reason': reason, 'matched_ids': [x['id'] for x in candidates], 'source': HANSHIN})
            if len(candidates) == 1:
                candidates[0].setdefault('hanshin_catalog_matches', []).append({'name': row['title'], 'kind': kind, 'road': route})
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
    write_json(a.audit, {'checked_at': a.checked_at, 'source': HANSHIN, 'summary': summary, 'items': audit})
    write_json(a.output, result)
    print(json.dumps({'items': len(items), 'road_unresolved': sum(not x['road'] for x in items), 'hanshin': summary}, ensure_ascii=True))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as e:
        sys.exit(str(e))

#!/usr/bin/env python3
"""国土数値情報 N06-25_GML.zip から現況の接合部(IC/JCT)をJSONに変換。
実際のZIPと属性名を確認してから利用する。元データが無い場合は出力しない。
"""
import argparse, json, pathlib, zipfile, io, sys
try:
    import geopandas as gpd
except ImportError:
    sys.exit("geopandas が必要です: pip install geopandas pyogrio")
def main():
    p=argparse.ArgumentParser()
    p.add_argument("zipfile",type=pathlib.Path)
    p.add_argument("--output",type=pathlib.Path,default=pathlib.Path("data/ic-positions.json"))
    a=p.parse_args()
    if not a.zipfile.is_file(): sys.exit("ZIPファイルがありません。既存のデータは変更しません。")
    with zipfile.ZipFile(a.zipfile) as z:
        joints=[n for n in z.namelist() if n.lower().endswith("joint.shp")]
        if len(joints)!=1: sys.exit("Joint.shp が一つに特定できません。ZIP内容を確認してください。")
        name=joints[0]; parent=pathlib.PurePosixPath(name).parent
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            for n in z.namelist():
                if pathlib.PurePosixPath(n).parent==parent and pathlib.PurePosixPath(n).stem==pathlib.PurePosixPath(name).stem:
                    z.extract(n,tmp)
            frame=gpd.read_file(pathlib.Path(tmp)/name).to_crs(epsg=4326)
    print("属性一覧:",list(frame.columns))
    # 仕様書に基づく接合部名と路線名の属性を確認するまでは推測しない。
    # 列名が想定と違う場合は停止し、空のデータで上書きしない。
    required={"N06_018","N06_019","N06_014"}
    if not required.issubset(frame.columns):
        sys.exit("接合部名・路線名・現況判定の属性が未確認です。実際の属性一覧と仕様書を照合してください。出力は変更しません。")
    sys.exit("属性の意味と方向別出入口の収録状況を照合後、正式変換を有効にしてください。")
if __name__=="__main__":main()

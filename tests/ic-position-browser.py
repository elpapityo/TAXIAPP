"""ローカルHTTPサーバーでIC検索ページを実Chrome検証。実GPS・実走行は対象外。"""
import json, math, pathlib, sys
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8765'
data = json.loads((ROOT/'data/ic-positions.json').read_text(encoding='utf8'))
origins = json.loads((ROOT/'tests/fixtures/ic-search-origins.json').read_text(encoding='utf8'))
report = {'dataset_count':len(data['items']), 'origins':[], 'failures':[]}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe', headless=True)
    page = browser.new_page(viewport={'width':412,'height':915})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE+'/ic-name-test.html')
    page.wait_for_function("document.getElementById('data-status').textContent.includes('2351件')")
    assert '国土交通省' in page.locator('#source-info').inner_text()
    for origin in origins:
        if origin['name']=='阪急伊丹駅周辺':
            page.locator('#sample').click()
            assert float(page.locator('#lat').input_value())==origin['latitude']
            assert float(page.locator('#lon').input_value())==origin['longitude']
            assert page.locator('#radius').input_value()=='10000'
        else:
            page.locator('#lat').fill(str(origin['latitude']))
            page.locator('#lon').fill(str(origin['longitude']))
            page.locator('#radius').select_option(str(origin['radius_m']))
        page.locator('#search').click()
        results=page.locator('#results li').all_text_contents()
        for name in origin['expected_names']:
            assert any(x.startswith(name+'　') for x in results), (origin['name'],name)
        if 'expected_count' in origin:
            assert len(results)==origin['expected_count']
            pathlib.Path(ROOT/'.cache/ic-sources').mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(ROOT/'.cache/ic-sources/itami-search.png'),full_page=True)
        distances=[float(x.split('約')[1].split('km')[0]) for x in results]
        assert distances==sorted(distances)
        assert all(x<=origin['radius_m']/1000 for x in distances)
        report['origins'].append({'name':origin['name'],'count':len(results),'nearest':results[:3]})
    # 入力エラー時とデータ再取得失敗時に古い結果が残らないこと。
    page.locator('#lat').fill('')
    page.locator('#search').click()
    assert page.locator('#results li').count()==0
    page.route('**/data/ic-positions.json',lambda route: route.fulfill(status=503,body='unavailable'))
    page.locator('#reload').click()
    page.wait_for_function("document.getElementById('data-status').textContent.includes('HTTP 503')")
    assert page.locator('#results li').count()==0
    page.unroute('**/data/ic-positions.json')
    page.route('**/data/ic-positions.json',lambda route: route.fulfill(json={'items':[{'name':'invalid','latitude':None,'longitude':135}]}))
    page.locator('#reload').click()
    page.wait_for_function("document.getElementById('data-status').textContent.includes('不正な座標')")
    assert not errors, errors
    browser.close()
report['checks']=['実HTTP JSON自動取得','出典表示','距離順・半径','空入力','HTTP503','null座標拒否','ブラウザ例外なし']
(ROOT/'.cache/ic-sources/browser-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'passed','dataset_count':report['dataset_count'],'origins':[(x['name'],x['count']) for x in report['origins']]},ensure_ascii=True))

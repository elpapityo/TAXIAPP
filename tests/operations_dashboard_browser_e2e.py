#!/usr/bin/env python3
"""Actual Chrome rendering: seven exclusive operations details and the 2x2 overview."""
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By

opts=Options()
for arg in ('--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=980,900'):
    opts.add_argument(arg)
opts.add_argument('--user-data-dir='+tempfile.mkdtemp(prefix='taxiapp-operations-'))
browser=webdriver.Chrome(options=opts)
try:
    # Node created this fixture by invoking the real renderOperations()
    # using temporary sample records and the production CSS from index.html.
    browser.get('http://127.0.0.1:8765/tests/operations_dashboard_fixture.html')
    WebDriverWait(browser,20).until(lambda d: 'TAXIAPP v0.3.103' in d.title)
    init=browser.execute_script("""
      const host=document.getElementById('ops-e2e-host');
      return {
        overview:host.querySelectorAll('.operations-kpi').length,
        panels:host.querySelectorAll('details[name="operations-dashboard"]').length,
        breakRows:host.querySelectorAll('[data-operation-panel="break"] .operations-history-item').length,
        hasBreak:host.querySelector('[data-ops-break-total]')?.textContent,
        finance:host.textContent.includes('支払方法別（精算内訳）')
      };
    """)
    assert init['overview']==4 and init['panels']==7,init
    assert init['breakRows']==3,init
    assert init['hasBreak'] and init['finance'],init
    for width,theme in [(360,'day'),(360,'night'),(390,'day'),(780,'night')]:
        browser.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',
            {'width':width,'height':900,'deviceScaleFactor':1,'mobile':True})
        data=browser.execute_script("""
          document.documentElement.dataset.uiTheme=arguments[0];
          const host=document.getElementById('ops-e2e-host');
          const tiles=[...host.querySelectorAll('.operations-kpi')];
          const rectangles=tiles.map(e=>e.getBoundingClientRect());
          const style=getComputedStyle(tiles[0]);
          const txt=getComputedStyle(tiles[0].querySelector('strong'));
          const rgb=x=>(x.match(/[0-9.]+/g)||[]).slice(0,3).map(Number);
          const lum=x=>rgb(x).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;})
            .reduce((z,v,i)=>z+v*[.2126,.7152,.0722][i],0);
          const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
          return {rectangles:rectangles.map(r=>[r.left,r.top,r.width,r.height]),
            contrast:ratio(style.backgroundColor,txt.color),overflows:host.scrollWidth>host.clientWidth+1,
            headings:[...host.querySelectorAll('.operations-fold>summary')].map(e=>e.textContent.trim())};
        """,theme)
        a,b,c,d=data['rectangles']
        assert abs(a[1]-b[1])<=2 and abs(c[1]-d[1])<=2,(width,theme,data)
        assert b[0]>a[0]+15 and d[0]>c[0]+15,(width,theme,data)
        assert c[1]>a[1]+15,(width,theme,data)
        assert data['contrast']>=7,(width,theme,'KPI contrast',data)
        assert not data['overflows'],(width,theme,'horizontal overflow',data)
        assert data['headings']==[
          '勤務時間・営業状況','休憩時間・休憩履歴','売上・営業実績',
          '日報集計・精算','GPS・走行距離','営業時系列・待機履歴','高速道路利用明細'
        ],data
        print('PASS operations 2x2, contrast, no overflow:',width,theme)
    single=browser.execute_script("""
      const host=document.getElementById('ops-e2e-host');
      const panels=[...host.querySelectorAll('details[name="operations-dashboard"]')];
      panels[1].open=true;
      const first=panels.map(p=>p.open);
      panels[3].open=true;
      const second=panels.map(p=>p.open);
      panels[3].open=false;
      const last=panels.map(p=>p.open);
      return {first,second,last,breakList:host.querySelector('[data-ops-break-active-list]')!==null,
        breakTotal:host.querySelector('[data-ops-break-detail-total]')!==null};
    """)
    assert single['first']==[False,True,False,False,False,False,False],single
    assert single['second']==[False,False,False,True,False,False,False],single
    assert not any(single['last']),single
    assert single['breakList'] and single['breakTotal'],single
    print('PASS operations: native single-open behavior and active break detail in real Chrome')
finally:
    browser.quit()

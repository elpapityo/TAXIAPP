#!/usr/bin/env python3
import tempfile
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
options=Options()
for opt in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1000,1200']:
    options.add_argument(opt)
options.add_argument('--user-data-dir='+tempfile.mkdtemp(prefix='taxiapp-production-'))
driver=webdriver.Chrome(options=options)
wait=WebDriverWait(driver,35)
def js(code,*args):return driver.execute_script(code,*args)
def stored():
    return driver.execute_async_script("""
      const done=arguments[arguments.length-1],req=indexedDB.open('taxiapp-store-v1',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('state'))req.result.createObjectStore('state')};
      req.onerror=()=>done(null);
      req.onsuccess=()=>{const db=req.result,tx=db.transaction('state'),read=tx.objectStore('state').get('taxiapp');
        read.onsuccess=()=>{const d=read.result;db.close();done(d??null)};
      };
    """)
try:
    driver.get('http://127.0.0.1:8765/')
    wait.until(lambda _: 'TAXIAPP v0.3.' in driver.title)
    wait.until(lambda _: bool(driver.find_elements(By.CSS_SELECTOR,"#app [data-tab='settings']")))
    assert driver.find_elements(By.ID,'accountSignIn')
    assert not driver.find_elements(By.ID,'accountViewSignIn'), 'viewer-only login must remain removed'
    assert driver.find_elements(By.ID,'accountTakeOver')
    assert not driver.find_elements(By.CSS_SELECTOR,'.gps-preview-ribbon')
    sentinel={'version':1,'activeId':None,'prefs':{'driver':'元からのデータ','vehicle':'登録済み'},
      'shifts':[{'id':'EXISTING_SHIFT','date':'2026-10-19','startedAt':'10:00',
                 'startedIso':'2026-10-19T10:00:00+09:00','endedAt':'10:30',
                 'endedIso':'2026-10-19T10:30:00+09:00','records':[],'settings':{}}]}
    assert driver.execute_async_script("""
      const state=arguments[0],done=arguments[arguments.length-1],r=indexedDB.open('taxiapp-store-v1',1);
      r.onerror=()=>done(false);
      r.onsuccess=()=>{
       const db=r.result,tx=db.transaction('state','readwrite');
       tx.objectStore('state').put(state,'taxiapp');
       tx.oncomplete=()=>{db.close();done(true)};
      };
    """,sentinel)
    js("localStorage.setItem('taxiapp-v1','PREEXISTING_FALLBACK')")
    js("localStorage.setItem('taxiapp-preview-v0359-simulator-optin','on')")
    driver.refresh()
    wait.until(lambda _: 'TAXIAPP v0.3.' in driver.title)
    wait.until(lambda _: bool(driver.find_elements(By.CSS_SELECTOR,"#app [data-tab='settings']")))
    assert stored()==sentinel, 'existing production data changed during app startup'
    assert js("return localStorage.getItem('taxiapp-v1')")=='PREEXISTING_FALLBACK'
    js("document.querySelector('[data-tab=settings]').click()")
    wait.until(lambda _: bool(driver.find_elements(By.CSS_SELECTOR,'[data-settings-category-choice="gps"]')))
    js("document.querySelector('[data-settings-category-choice=gps]').click()")
    wait.until(lambda _: js(
      "return document.querySelector('[data-settings-category-choice=gps]')?.getAttribute('aria-pressed')==='true'"))
    wait.until(lambda _: bool(driver.find_elements(By.CSS_SELECTOR,'details[data-distance-address-settings]')))
    js("document.querySelector('details[data-distance-address-settings]').open=true")
    wait.until(lambda _: bool(driver.find_elements(By.CSS_SELECTOR,'details[data-gps-settings]')))
    js("document.querySelector('details[data-gps-settings]').open=true")
    # Read both controls in one DOM snapshot. Account/sync status can redraw
    # settings between separate Selenium WebElement calls.
    options=wait.until(lambda _: driver.execute_script("""
      const auto=document.querySelector('[data-native-auto-distance]');
      if(!auto)return null;
      return {on:auto.value==='on',native:!!document.querySelector('[data-native-diary-gps]')};
    """))
    assert options is not None, 'auto-distance preference should remain configurable'
    # The native-source selector is intentionally hidden when auto fill is OFF.
    assert options['native']==options['on']
    assert not driver.find_elements(By.CSS_SELECTOR,'[data-preview-simulator]')
    # Functions are private inside the app closure. Verify the actual production
    # fetch URL from the same browser origin, without mutating user records.
    municipalities=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      fetch('./municipalities.json',{cache:'no-store'})
        .then(async response=>({status:response.status,data:await response.json()}))
        .then(({status,data})=>done({
          status,city:data['28207'],path:new URL('./municipalities.json',location.href).pathname
        })).catch(e=>done({error:String(e)}));
    """)
    assert municipalities.get('status')==200,municipalities
    assert municipalities.get('city')=='兵庫県伊丹市',municipalities
    assert municipalities['path']=='/municipalities.json',municipalities
    # The original 3-column UI must fit a phone without horizontal clipping.
    # This DOM-only synthetic fixture never edits, sends, or replaces a duty.
    js("""const main=document.querySelector('#main-content');
      const box=document.createElement('details');box.open=true;
      box.id='monthly-width-fixture';box.className='details monthly-sales-panel';
      box.innerHTML='<summary>月間売上表</summary><div class="inner">'+
       '<h2 class="h2" style="position:absolute;visibility:hidden">クラウド日報管理</h2>'+
       '<div class="monthly-sales-scroll"><table class="monthly-sales-table">'+
       '<colgroup><col class="monthly-date-col"><col class="monthly-money-col">'+
       '<col class="monthly-money-col"></colgroup><thead><tr>'+
       '<th>日付・曜日・祝日</th><th>税込売上</th><th>税別売上</th></tr></thead>'+
       '<tbody><tr class="monthly-day-holiday"><th>10/12（月・祝）</th>'+
       '<td>123,456</td><td>112,232</td></tr></tbody></table></div></div>';
      main.appendChild(box);""")
    for width in (320,360,420,580):
        driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{
          'width':width,'height':900,'deviceScaleFactor':1,'mobile':True})
        width_state=js("""const fixture=document.querySelector('#monthly-width-fixture');
          const wrap=fixture.querySelector('.monthly-sales-scroll');
          const table=wrap.querySelector('table');
          const last=table.querySelector('tbody tr td:last-child');
          const h1=document.querySelector('#main-content .section-heading .h1');
          const h2=fixture.querySelector('.h2');
          return {viewport:innerWidth, wrap:wrap.clientWidth,scroll:wrap.scrollWidth,
            tableRight:table.getBoundingClientRect().right,
            wrapRight:wrap.getBoundingClientRect().right,
            pageRight:document.documentElement.getBoundingClientRect().right,
            lastRight:last.getBoundingClientRect().right,
            lastText:last.textContent,
            titleSize:parseFloat(getComputedStyle(h1).fontSize),
            itemSize:parseFloat(getComputedStyle(h2).fontSize)};""")
        assert width_state['scroll']<=width_state['wrap']+1,(width,width_state)
        assert width_state['tableRight']<=width_state['wrapRight']+1,(width,width_state)
        assert width_state['lastRight']<=width_state['viewport']+1,(width,width_state)
        assert width_state['titleSize']<=width_state['itemSize']+1,(width,width_state)
    print('PASS Chrome: 月間売上3列が320-580pxで切れず、画面タイトルは項目見出し以下')
    assert stored()==sentinel
    print('PASS Chrome: production municipality JSON route resolves; original IDB/localStorage unaffected')

    # Exercise the production scroll code against the actual sticky CSS with
    # the detail form collapsed and the visible meter controls partly covered.
    source=Path('index.html').read_text()
    start=source.index(" if(tab==='drive'&&typeof focusDispatchSourceAfterRender")
    end=source.index(" if(tab==='settings'&&rideSettingsJumpRequested)",start)
    for mode,orientation,width,height in (
        ('phone','portrait',490,710), ('half','portrait',320,620),
        ('phone','landscape',560,420), ('tablet','landscape',900,600),
        ('full','portrait',390,700), ('pc','landscape',1180,720),
    ):
        driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{
            'width':width,'height':height,'deviceScaleFactor':1,'mobile':True})
        result=driver.execute_async_script("""
          const [mode,orientation,scrollSource,done]=arguments;
          const settings=document.documentElement.dataset;
          settings.uiScreenMode=mode;settings.uiOrientationMode=orientation;
          settings.uiStickyDutySummary='on';settings.uiButtons='extra';
          const appEl=document.querySelector('#app');
          appEl.innerHTML=`<div class="layout"><main id="main-content">
            <div style="height:180px"></div>
            <section class="preview-duty-summary meter-status-summary" style="height:112px">迎車中</section>
            <div style="height:100px"></div>
            <section class="card hero meter-console"><div class="meter-actions">
              <button class="btn meter-action" data-action="boardDispatch">実車</button>
              <button class="btn meter-action" data-action="cancelDispatch">キャンセル</button>
            </div></section>
            <details><div data-dispatch-source>配車元</div></details>
            <div style="height:100vh"></div>
          </main></div>`;
          const summary=appEl.querySelector('.preview-duty-summary');
          const actions=appEl.querySelector('.meter-actions');
          window.scrollTo(0,scrollY+actions.getBoundingClientRect().top-52);
          const covered=actions.getBoundingClientRect().top<summary.getBoundingClientRect().bottom;
          const run=new Function('appEl','tab','getShift','displayPrefs','syncFloatingDutySummary',
            'let focusDispatchSourceAfterRender=true;'+scrollSource);
          run(appEl,'drive',()=>({draft:{kind:'dispatch'}}),()=>({stickyDutySummary:'on'}),()=>{});
          requestAnimationFrame(()=>{
            const gap=actions.getBoundingClientRect().top-summary.getBoundingClientRect().bottom;
            const visible=[...actions.querySelectorAll('button')].every(button=>{
              const r=button.getBoundingClientRect();
              return document.elementFromPoint(r.left+r.width/2,r.top+2)===button&&
                document.elementFromPoint(r.left+r.width/2,r.bottom-2)===button;
            });
            done({covered,gap,visible});
          });
        """,mode,orientation,source[start:end])
        assert result['covered'] and 10<=result['gap']<=14 and result['visible'],(mode,orientation,result)
    print('PASS Chrome: dispatch controls stay below the fixed summary across display modes')
finally:
    driver.quit()

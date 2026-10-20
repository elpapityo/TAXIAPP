#!/usr/bin/env python3
"""Chrome smoke: day/night break cards, 2x2 break actions, device modes, global density."""
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

opts=Options()
for flag in ('--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1100,900'):
    opts.add_argument(flag)
opts.add_argument('--user-data-dir='+tempfile.mkdtemp(prefix='taxiapp-break-ui-'))
browser=webdriver.Chrome(options=opts)
try:
    browser.get('http://127.0.0.1:8765/')
    WebDriverWait(browser,30).until(lambda d: 'TAXIAPP v0.3.110' in d.title)
    browser.execute_script("""
      const host=document.createElement('div');
      host.id='test-break-layout-host';
      host.innerHTML=`
       <section class="card hero break-page">
         <div class="break-dashboard">
           <div><small>休憩開始</small><strong>07:45</strong></div>
           <div><small>休憩終了</small><strong>—</strong></div>
           <div><small>今回の休憩時間</small><strong>00:01:05</strong></div>
           <div><small>過去＋現在の合計</small><strong>00:12</strong></div>
         </div>
         <div class="action-grid break-actions">
           <button class="btn" disabled>☕ 休憩開始</button>
           <button class="btn teal">✓ 休憩終了</button>
           <button class="btn primary">🚕 乗車</button>
           <button class="btn primary">📲 アプリ迎車</button>
         </div>
       </section>
       <section class="card" id="test-global-card">
         <label class="field"><span class="field-label">項目</span><input class="control" /></label>
         <div class="actions"><button class="btn">通常ボタン</button></div>
       </section>`;
      document.body.appendChild(host);
    """)
    cases=(
        ('day','phone','portrait','normal',360),
        ('night','phone','portrait','normal',360),
        ('night','half','portrait','compact',320),
        ('night','half','landscape','normal',580),
        ('day','tablet','landscape','large',920),
        ('night','phone','portrait','ultra',380),
    )
    for theme,mode,orientation,button_size,width in cases:
        browser.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',
            {'width':width,'height':850,'deviceScaleFactor':1,'mobile':True})
        data=browser.execute_script("""
          const [theme,mode,orientation,buttonSize]=arguments;
          const d=document.documentElement.dataset;
          d.uiTheme=theme;d.uiScreenMode=mode;d.uiOrientationMode=orientation;
          d.uiButtons=buttonSize;d.uiDriveLayout='compact';
          const host=document.getElementById('test-break-layout-host');
          host.style.width=mode==='half'?'min(100%,340px)':'min(100%,820px)';
          const grid=host.querySelector('.break-actions');
          const buttons=[...grid.querySelectorAll('button')];
          const rects=buttons.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}});
          const pair=host.querySelector('.break-dashboard>div');
          const rgb=value=>(value.match(/[0-9.]+/g)||[]).slice(0,3).map(Number);
          const luma=value=>rgb(value).map(n=>{let x=n/255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4})
                         .reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
          const contrast=(fg,bg)=>{let a=luma(fg),b=luma(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
          const style=getComputedStyle(pair);
          const sample=host.querySelector('#test-global-card');
          return {
            rects,display:getComputedStyle(grid).display,
            cardBackground:style.backgroundColor,
            clockContrast:contrast(getComputedStyle(pair.querySelector('strong')).color,style.backgroundColor),
            labelContrast:contrast(getComputedStyle(pair.querySelector('small')).color,style.backgroundColor),
            cardPadding:getComputedStyle(sample).paddingTop,
            buttonHeight:rects[0].height
          };
        """, theme,mode,orientation,button_size)
        a,b,c,d=data['rects']
        assert data['display']=='grid',(theme,mode,data)
        assert abs(a['top']-b['top'])<2,(theme,mode,'row1 not aligned',data)
        assert abs(c['top']-d['top'])<2,(theme,mode,'row2 not aligned',data)
        assert abs(a['left']-c['left'])<2,(theme,mode,'left column mismatch',data)
        assert b['left']>a['left']+15,(theme,mode,'two columns missing',data)
        assert c['top']>a['top']+15,(theme,mode,'two rows missing',data)
        assert data['clockContrast']>=7,(theme,mode,'clock contrast',data)
        assert data['labelContrast']>=4.5,(theme,mode,'label contrast',data)
        assert float(data['cardPadding'].removesuffix('px')) <=16,(theme,mode,'card not compact',data)
        assert data['buttonHeight']>=37,(theme,mode,'button target unexpectedly small',data)
        print('PASS',theme,mode,orientation,button_size,width,'2x2, contrast, spacing')
    print('PASS Chrome: break 2x2 across display modes, day/night clock visibility, global card density')
    # The old cruising layout setting is gone. Its actions remain 2x2 under
    # every manually selected device/orientation mode, including portrait and half.
    browser.execute_script("""
      const host=document.getElementById('test-break-layout-host');
      host.insertAdjacentHTML('beforeend',
        '<div class="action-grid cruising-action-grid cruising-action-compact" id="test-cruising-actions">'+
        '<button class="btn big">乗車</button><button class="btn big">アプリ迎車</button>'+
        '<button class="btn big">待機</button><button class="btn big">休憩</button>'+
        '<button class="btn cruising-history-btn">営業履歴</button></div>');
    """)
    for mode,orientation,width in (('phone','portrait',360),('half','portrait',320),
                                   ('half','landscape',560),('tablet','landscape',900)):
        browser.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',
            {'width':width,'height':850,'deviceScaleFactor':1,'mobile':True})
        result=browser.execute_script("""
          document.documentElement.dataset.uiScreenMode=arguments[0];
          document.documentElement.dataset.uiOrientationMode=arguments[1];
          const grid=document.getElementById('test-cruising-actions');
          const buttons=[...grid.querySelectorAll('button')].map(el=>el.getBoundingClientRect());
          return {columns:getComputedStyle(grid).gridTemplateColumns,
            positions:buttons.map(r=>[r.left,r.top,r.width])};
        """,mode,orientation)
        x=result['positions']
        assert abs(x[0][1]-x[1][1])<2,(mode,orientation,'cruising first row',result)
        assert abs(x[2][1]-x[3][1])<2,(mode,orientation,'cruising second row',result)
        assert x[1][0]>x[0][0]+15,(mode,orientation,'cruising columns',result)
        assert x[2][1]>x[0][1]+15,(mode,orientation,'cruising rows',result)
        assert x[4][2]>=x[0][2]*1.8,(mode,orientation,'history spans full row',result)
    # Separate Settings menus can be opened individually or together.
    browser.execute_script("document.querySelector('[data-tab=settings]').click()")
    topLevel=[
      'data-business-field-settings','data-appearance-settings'
    ]
    WebDriverWait(browser,12).until(
        lambda d: d.execute_script(
            "return document.querySelectorAll('details.settings-advanced[data-business-field-settings]').length===1"))
    state=browser.execute_script("""
      const keys=arguments[0];
      const panels=keys.map(k=>document.querySelector('details.settings-advanced['+k+']'));
      if(panels.some(x=>!x))return {missing:keys.filter((_,i)=>!panels[i])};
      const parent=panels[0];
      const childA=parent.querySelector('details[data-ride-field-settings]');
      const childB=parent.querySelector('details[data-cruising-summary-settings]');
      const childC=parent.querySelector('details[data-drive-status-settings]');
      const appearance=panels[1];
      const appearanceKeys=['data-text-size-settings','data-button-size-settings',
        'data-help-settings','data-theme-settings','data-ui-preview-settings'];
      const appearanceChildren=appearanceKeys.map(k=>appearance.querySelector('details['+k+']'));
      const allPresent=appearanceChildren.every(x=>!!x);
      const initiallyClosed=panels.every(x=>!x.open)&&!!childA&&!childA.open&&
        !!childB&&!childB.open&&!!childC&&!childC.open&&allPresent&&appearanceChildren.every(x=>!x.open);
      const noSeparateMenus=document.querySelectorAll(
        'details.settings-advanced[data-text-size-settings],'+
        'details.settings-advanced[data-button-size-settings],'+
        'details.settings-advanced[data-help-settings],'+
        'details.settings-advanced[data-theme-settings],'+
        'details.settings-advanced[data-ui-preview-settings],'+
        'details.settings-advanced[data-ride-field-settings],'+
        'details.settings-advanced[data-cruising-summary-settings],'+
        'details.settings-advanced[data-drive-status-settings]').length===0;
      parent.open=true;childA.open=true;
      const independentlyOpen=parent.open&&childA.open&&!childB.open&&!childC.open&&!panels[1].open;
      childB.open=true;childA.open=false;
      const secondIndependent=parent.open&&!childA.open&&childB.open&&!childC.open;
      childC.open=true;childB.open=false;
      const thirdIndependent=parent.open&&!childA.open&&!childB.open&&childC.open;
      appearance.open=true;appearanceChildren[0].open=true;
      const appearanceIndependent=appearance.open&&appearanceChildren[0].open&&
        appearanceChildren.slice(1).every(x=>!x.open);
      appearanceChildren[1].open=true;appearanceChildren[0].open=false;
      const appearanceSecond=appearance.open&&!appearanceChildren[0].open&&appearanceChildren[1].open;
      const appearanceOptions=appearanceKeys.map((k,i)=>appearanceChildren[i].querySelectorAll(
        '[data-ui-key], [data-action=resetUi]')).map(nodes=>nodes.length);
      return {initiallyClosed,noSeparateMenus,independentlyOpen,secondIndependent,thirdIndependent,
        appearanceIndependent,appearanceSecond,appearanceOptions,allPresent,
        obsolete:document.querySelectorAll('[data-ui-key=cruisingButtonsLayout]').length,
        themeChoices:appearanceChildren[3].querySelectorAll('[data-ui-key=theme]').length,
        rideChoices:childA.querySelectorAll('[data-ride-field]').length,
        cruisingChoices:childB.querySelectorAll('[data-cruising-summary-field]').length};
    """,topLevel)
    assert not state.get('missing'),state
    assert state['initiallyClosed'],state
    assert state['noSeparateMenus'],state
    assert state['allPresent'],state
    assert state['independentlyOpen'] and state['secondIndependent'] and state['thirdIndependent'],state
    assert state['appearanceIndependent'] and state['appearanceSecond'],state
    assert len(state['appearanceOptions'])==5 and all(x>0 for x in state['appearanceOptions']),state
    assert state['obsolete']==0,state
    assert state['themeChoices']==2,state
    assert state['rideChoices']>0 and state['cruisingChoices']>0,state
    print('PASS Chrome: cruising fixed 2x2; 3 independent display menus and 5 appearance menus')
    # Registration screen has one parent with independently folding driver, vehicle,
    # cancellation and duty-plan settings. Fees only appear for a selected shift.
    driver_group=browser.execute_script("""
      const parent=document.querySelector('details.settings-advanced[data-driver-registration]');
      if(!parent)return {missing:true};
      const keys=['data-driver-profile-settings','data-vehicle-profile-settings',
        'data-cancel-settings','data-fee-settings','data-duty-plan-settings'];
      const children=keys.map(k=>parent.querySelector('details['+k+']'));
      const known=children.filter(x=>!!x);
      const initiallyClosed=!parent.open&&known.every(x=>!x.open);
      const unique=keys.every(k=>document.querySelectorAll('details['+k+']').length<=1);
      const standalone=document.querySelectorAll(
        'details.settings-advanced[data-duty-plan-settings]').length;
      parent.open=true;
      children[0].open=true;
      const firstIndependent=children[0].open && !children[1].open && !children[2].open &&
        !children[4].open;
      children[1].open=true;children[0].open=false;
      const secondIndependent=!children[0].open && children[1].open && !children[2].open;
      const prefKeys=['company','driver','driverNo','vehicle'];
      const values=prefKeys.map(k=>parent.querySelectorAll('[data-pref="'+k+'"]').length);
      const dutyKeys=['type','hours','distanceKm'];
      const dutyValues=dutyKeys.map(k=>parent.querySelectorAll('[data-duty-plan="'+k+'"]').length);
      return {initiallyClosed,unique,standalone,firstIndependent,secondIndependent,
        exists:children.map(x=>!!x),values,dutyValues,
        cancelMode:parent.querySelectorAll('[data-cancel-meter-mode]').length,
        feesVisible:children[3]!==null};
    """)
    assert not driver_group.get('missing'),driver_group
    assert driver_group['initiallyClosed'],driver_group
    assert driver_group['unique'] and driver_group['standalone']==0,driver_group
    assert driver_group['exists']==[True,True,True,False,True],driver_group
    assert driver_group['firstIndependent'] and driver_group['secondIndependent'],driver_group
    assert driver_group['values']==[1,1,1,1],driver_group
    assert driver_group['dutyValues']==[1,1,1],driver_group
    assert driver_group['cancelMode']==1,driver_group
    print('PASS Chrome: driver registration, vehicle, cancel and duty plan fold independently; all original inputs kept')

finally:
    browser.quit()

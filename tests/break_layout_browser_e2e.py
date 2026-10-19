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
    WebDriverWait(browser,30).until(lambda d: 'TAXIAPP v0.3.94' in d.title)
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
finally:
    browser.quit()

#!/usr/bin/env python3
"""Real Chrome test for isolated GPS preview: no writes to production-origin local data."""
import json, os, tempfile, time, traceback
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

SITE=os.environ.get("PREVIEW_E2E_SITE","http://127.0.0.1:8765")
options=Options()
for opt in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1200,1600","--no-first-run"]:
    options.add_argument(opt)
options.add_argument("--user-data-dir="+tempfile.mkdtemp(prefix="taxi-preview-browser-"))
driver=webdriver.Chrome(options=options)
wait=WebDriverWait(driver,35,poll_frequency=0.3)
def js(script,*args):return driver.execute_script(script,*args)
def ready():
    wait.until(lambda d: "GPS統合試験専用" in d.title)
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,"#app [data-tab='shift']")))
    assert len(driver.find_elements(By.CSS_SELECTOR,"#accountSignIn"))==0

def db(dbname,key):
    return driver.execute_async_script("""
      const dbname=arguments[0],key=arguments[1],done=arguments[arguments.length-1];
      const open=indexedDB.open(dbname,1);
      open.onerror=()=>done({error:'open'});
      open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('state'))open.result.createObjectStore('state')};
      open.onsuccess=()=>{
        const conn=open.result,tx=conn.transaction('state','readonly'),get=tx.objectStore('state').get(key);
        get.onsuccess=()=>{done(get.result===undefined?null:get.result);conn.close()};
        get.onerror=()=>done({error:'read'});
      };
    """,dbname,key)
try:
    driver.get(SITE+"/")
    # Create a production-style sentinel *on the same origin* before visiting the preview.
    js("localStorage.setItem('taxiapp-v1','DO_NOT_MODIFY_PRODUCTION_LOCAL')")
    js("localStorage.setItem('taxiapp-device-native-gps-v130','off')")
    js("localStorage.setItem('taxiapp-device-native-gps-v131','off')")
    js("localStorage.setItem('taxiapp-preview-v0358-simulator-optin','OLD_PREVIEW_SENTINEL')")
    driver.execute_async_script("""
      const done=arguments[arguments.length-1],o=indexedDB.open('taxiapp-store-v1',1);
      o.onupgradeneeded=()=>o.result.createObjectStore('state');
      o.onerror=()=>done('error');
      o.onsuccess=()=>{
        const db=o.result,tx=db.transaction('state','readwrite');
        tx.objectStore('state').put({version:1,activeId:'PRODUCTION_SENTINEL',
          shifts:[{id:'PRODUCTION_SENTINEL'}],prefs:{}},'taxiapp');
        tx.oncomplete=()=>{db.close();done('ok')};
        tx.onerror=()=>done('error');
      };
    """)
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'
    driver.get(SITE+"/gps-preview/v0359/")
    ready()
    assert "試験専用ページ" in driver.find_element(By.CSS_SELECTOR,".gps-preview-ribbon").text
    assert "現在、乗務中ではありません" in driver.find_element(By.ID,"app").text
    assert js("return localStorage.getItem('taxiapp-v1')")=="DO_NOT_MODIFY_PRODUCTION_LOCAL"
    assert js("return localStorage.getItem('taxiapp-preview-v0358-simulator-optin')")=="OLD_PREVIEW_SENTINEL"
    assert db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359') is None
    assert not js("return localStorage.getItem('taxiapp-preview-v0359-native-gps-v131')")

    js("document.querySelector('[data-tab=settings]').click()")
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,"details[data-gps-settings]")))
    # The native GPS source and simulator permission are device-only preferences.
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""const el=document.querySelector('[data-native-diary-gps]');
        el.value='on';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    wait.until(lambda d: js("return localStorage.getItem('taxiapp-preview-v0359-native-gps-v131')")=="on")
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""const el=document.querySelector('[data-preview-simulator]');
        el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));""")
    assert js("return localStorage.getItem('taxiapp-preview-v0359-simulator-optin')")=="on"
    assert js("return localStorage.getItem('taxiapp-device-native-gps-v131')")=="off"
    # Switch native GPS back OFF for this browser-only persistence test.
    js("""const el=document.querySelector('[data-native-diary-gps]');
        el.value='off';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""const el=document.querySelector('[data-pref-gps-start]');
        el.value='off';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    js("document.querySelector('[data-tab=shift]').click()")
    wait.until(lambda d: bool(d.find_elements(By.ID,"shiftStartOdo")))
    js("""document.getElementById('shiftStartOdo').value='0';
         document.querySelector('[data-action=startShift]').click();""")
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,".preview-duty-summary")))
    wait.until(lambda d: (db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359') or {}).get('shifts',[])!=[])
    preview=db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')
    assert len(preview['shifts'])==1
    assert str(preview['shifts'][0]['startingOdo'])=='0'
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'

    driver.refresh()
    ready()
    assert "空車・流し" in driver.find_element(By.ID,"app").text
    assert len(db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'])==1
    assert js("return localStorage.getItem('taxiapp-v1')")=="DO_NOT_MODIFY_PRODUCTION_LOCAL"
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'
    assert js("return localStorage.getItem('taxiapp-preview-v0359-simulator-optin')")=="on"
    # Turn on native GPS AFTER departure: prior browser-only trip had no native
    # baseline. Offer a safe current-trip rebase without inventing old distance.
    js("document.querySelector('[data-tab=settings]').click()")
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""const el=document.querySelector('[data-native-diary-gps]');
          el.value='on';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    js("document.querySelector('details[data-gps-settings]').open=true")
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,"[data-native-gps-baseline-panel]")))
    assert "GPS基準は未登録" in js("return document.querySelector('[data-native-gps-baseline-status]').textContent")
    assert not driver.find_elements(By.CSS_SELECTOR,".gps-trip-panel"),"legacy GPS panel shown while Android selected"
    # Browser-only smoke: stub the Android GPS HTTP result. Actual APK/Chrome
    # integration has a separate real-emulator test.
    js("""window.TAXIAPP_EXTERNAL_GPS.read=async()=>({
          tripKm:9.654,runId:'v131-native-manual-rebase-ci-test',unresolvedGap:false,gapCount:0
         });""")
    js("""document.getElementById('gpsShiftRebaseValue').value='0';
          document.querySelector('[data-action=gpsShiftRebase]').click();""")
    duty_id=preview['shifts'][0]['id']
    wait.until(lambda d: bool(js(
       "return localStorage.getItem('taxiapp-preview-v0359-native-gps-baseline:'+arguments[0])",duty_id)))
    basis=json.loads(js(
       "return localStorage.getItem('taxiapp-preview-v0359-native-gps-baseline:'+arguments[0])",duty_id))
    assert basis['gps']==9.654 and basis['value']==0
    assert abs(js("""return window.TAXIAPP_EXTERNAL_GPS.calculated(
       10.154,window.TAXIAPP_EXTERNAL_GPS.baseline(localStorage,arguments[0]),
       'v131-native-manual-rebase-ci-test')""",duty_id)-0.5)<0.0001
    assert "GPS基準を登録しました" in js("return document.querySelector('[data-native-gps-baseline-status]').textContent")
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'
    assert js("return localStorage.getItem('taxiapp-preview-v0359-auto-distance-v131')") is None
    # OFF: existing time/location updates work, GPS distance must never be requested.
    js("""Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
       getCurrentPosition:ok=>ok({coords:{latitude:34.7001,longitude:135.2001,accuracy:9},timestamp:Date.now()})
    }});""")
    js("document.querySelector('[data-tab=drive]').click()")
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,'[data-action=beginRide]')))
    js("document.querySelector('[data-action=beginRide]').click()")
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,'[data-time-now=G]')))
    js("""window.__distanceCalls=0;
       window.TAXIAPP_EXTERNAL_GPS.read=async()=>{
          window.__distanceCalls++;
          return {tripKm:9.654,runId:'v131-native-manual-rebase-ci-test',
             capturedAt:Date.now(),unresolvedGap:false,gapCount:0};
       };""")
    js("document.querySelector('[data-time-now=G]').click()")
    assert js("return window.__distanceCalls")==0
    draft=db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']
    assert str(draft['raw']['F'])==''
    # Manual input while OFF is silent and must never invoke the GPS bridge.
    js("""const el=document.querySelector('[data-col=F]');
       el.value='4.2';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    assert js("return window.__distanceCalls")==0
    assert "GPS" not in driver.find_element(By.ID,'notice').text
    wait.until(lambda d: db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']['raw']['F']=='4.2')
    # On-screen 0.1km steppers work even when GPS auto-fill is OFF.
    js("document.querySelector('[data-col=F]').parentElement.querySelector('[data-km-step=\\\"1\\\"]').click()")
    wait.until(lambda d: db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']['raw']['F']=='4.3')
    js("document.querySelector('[data-col=F]').parentElement.querySelector('[data-km-step=\\\"-1\\\"]').click()")
    wait.until(lambda d: db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']['raw']['F']=='4.2')
    assert js("return window.__distanceCalls")==0
    # Enable auto, explicitly rebase after OFF/manual checkpoint, then advance GPS +0.5km.
    js("document.querySelector('[data-tab=settings]').click()")
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""const el=document.querySelector('[data-native-auto-distance]');
       el.value='on';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    assert js("return localStorage.getItem('taxiapp-preview-v0359-auto-distance-v131')")=='on'
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""document.getElementById('gpsShiftRebaseValue').value='4.2';
       document.querySelector('[data-action=gpsShiftRebase]').click();""")
    wait.until(lambda d: abs(json.loads(js("return localStorage.getItem('taxiapp-preview-v0359-native-gps-baseline:'+arguments[0])",duty_id))['value']-4.2)<0.001)
    js("document.querySelector('[data-tab=drive]').click()")
    js("""window.TAXIAPP_EXTERNAL_GPS.read=async()=>({
       tripKm:10.154,runId:'v131-native-manual-rebase-ci-test',
       capturedAt:Date.now(),unresolvedGap:false,gapCount:0});""")
    js("document.querySelector('[data-time-now=M]').click()")
    wait.until(lambda d: (db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359') or {}).get('shifts',[{}])[0].get('draft',{}).get('raw',{}).get('L')=='4.7')
    draft=db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']
    assert draft['raw']['F']=='4.2', 'manual F must stay intact'
    assert draft['raw']['L']=='4.7', 'native GPS +0.5 km after manual baseline'
    assert draft['raw']['M'], 'time is still recorded'
    # ON + manual: a driver-corrected value must silently become the next GPS baseline.
    js("""const el=document.querySelector('[data-col=L]');
       el.value='6.0';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    wait.until(lambda d: abs(json.loads(js("return localStorage.getItem('taxiapp-preview-v0359-native-gps-baseline:'+arguments[0])",duty_id))['value']-6.0)<0.001)
    assert "GPS受信の復帰後" not in driver.find_element(By.ID,'notice').text
    js("document.querySelector('[data-time-now=M]').click()")
    wait.until(lambda d: db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']['raw']['L']=='6.0')
    # OFF again: manual changes must never call Android GPS.
    js("document.querySelector('[data-tab=settings]').click()")
    js("document.querySelector('details[data-gps-settings]').open=true")
    js("""const el=document.querySelector('[data-native-auto-distance]');
       el.value='off';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    assert js("return localStorage.getItem('taxiapp-preview-v0359-auto-distance-v131')")=='off'
    js("document.querySelector('[data-tab=drive]').click()")
    js("""window.__distanceCalls=0;
       window.TAXIAPP_EXTERNAL_GPS.read=async()=>{window.__distanceCalls++;throw Error('MUST_NOT_BE_CALLED')};""")
    js("""const el=document.querySelector('[data-col=L]');
       el.value='6.3';el.dispatchEvent(new Event('change',{bubbles:true}));""")
    assert js("return window.__distanceCalls")==0
    wait.until(lambda d: db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']['raw']['L']=='6.3')
    assert 'MUST_NOT_BE_CALLED' not in driver.find_element(By.ID,'notice').text
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'
    # Highway can be entered in two sections within the same ride, no extra duty.
    js("document.querySelector('[data-action=highwayAdd][data-id=実]').click()")
    assert js("return document.querySelectorAll('[data-hwy-row]').length")==1
    js("document.querySelector('[data-action=highwayAdd][data-id=実]').click()")
    assert js("return document.querySelectorAll('[data-hwy-row]').length")==2
    js("""const sections=document.querySelectorAll('[data-hwy-row]');
      const data=[
       {entryIC:'吹田',entryTime:'10:00',entryKm:'20.1',exitIC:'豊中',exitTime:'10:12',exitKm:'27.4',fee:'650'},
       {entryIC:'西宮北',entryTime:'10:25',entryKm:'30.0',exitIC:'宝塚',exitTime:'10:45',exitKm:'39.6',fee:'900'}];
      sections.forEach((root,index)=>Object.entries(data[index]).forEach(([key,value])=>{
       const input=root.querySelector('[data-hwy-field="'+key+'"]');input.value=value;
       input.dispatchEvent(new Event('change',{bubbles:true}));
      }));""")
    wait.until(lambda d: (db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft'].get('meta',{}).get('highwaySections',[{},{}])[1].get('entryIC',''))=='西宮北')
    record=db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']
    assert record['meta']['highwaySections'][1]['entryIC']=='西宮北'
    projection=js("""return TAXIAPP_HIGHWAY_SECTIONS.project(arguments[0].raw,arguments[0].meta.highwaySections)""",record)
    assert projection['W']=='1550'
    assert projection['X']=='16.9'
    assert projection['Y']=='12.675'
    # Save the entire ride: primary 44 columns carry rolled-up totals while meta
    # retains both independent sections for route/75% exemption reporting.
    js("""const meter=document.querySelector('[data-col=K]');
      meter.value='1800';meter.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('[data-setcol=N][data-value=現]').click();""")
    js("document.querySelector('[data-action=saveDraft]').click()")
    wait.until(lambda d: len(db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['records'])==1)
    finished=db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['records'][0]
    assert finished['status']=='complete'
    assert finished['raw']['W']=='1550'
    assert finished['raw']['X']=='16.9'
    assert finished['raw']['Y']=='12.675'
    assert len(finished['meta']['highwaySections'])==2
    assert finished['meta']['highwaySections'][0]['entryIC']=='吹田'
    assert finished['meta']['highwaySections'][1]['entryIC']=='西宮北'
    summary=js("return TAXIAPP_HIGHWAY_REPORT.collect(arguments[0])",
      db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0])
    assert summary['real']['count']==2 and summary['real']['chargeYen']==1550
    assert summary['real']['exemptKm']==12.675
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'
    print("PASS Chrome: preview boots, source opt-in, simulated opt-in, 0km departure and reload persisted, production IDB/localStorage preserved")
except Exception:
    print("Browser URL:",driver.current_url)
    print("App text:",(driver.find_element(By.TAG_NAME,"body").text or "")[:2400])
    traceback.print_exc()
    raise
finally:
    driver.quit()

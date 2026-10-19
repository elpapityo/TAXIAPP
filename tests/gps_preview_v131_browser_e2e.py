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
    assert db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']['raw']['F']=='4.2'
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
    wait.until(lambda d: (db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359') or {}).get('shifts',[{}])[0].get('draft',{}).get('raw',{}).get('L')=='4.700')
    draft=db('taxiapp-gps-preview-v0359-store','taxiapp-gps-preview-v0359')['shifts'][0]['draft']
    assert draft['raw']['F']=='4.2', 'manual F must stay intact'
    assert draft['raw']['L']=='4.700', 'native GPS +0.5 km after manual baseline'
    assert draft['raw']['M'], 'time is still recorded'
    assert db('taxiapp-store-v1','taxiapp')['activeId']=='PRODUCTION_SENTINEL'
    print("PASS Chrome: preview boots, source opt-in, simulated opt-in, 0km departure and reload persisted, production IDB/localStorage preserved")
except Exception:
    print("Browser URL:",driver.current_url)
    print("App text:",(driver.find_element(By.TAG_NAME,"body").text or "")[:2400])
    traceback.print_exc()
    raise
finally:
    driver.quit()

#!/usr/bin/env python3
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
options=Options()
for opt in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=430,960']:
 options.add_argument(opt)
options.add_argument('--user-data-dir='+tempfile.mkdtemp(prefix='taxiapp-demo-'))
driver=webdriver.Chrome(options=options)
wait=WebDriverWait(driver,25)
def js(source,*args):return driver.execute_script(source,*args)
def app_ready():
 return js("return Boolean(window.__TAXIAPP_DEMO__ && document.querySelector('#main-content .meter-console'))")
def app_visible():
 return js("""const app=document.querySelector('#app'),panel=document.querySelector('#main-content');
  if(!app||!panel)return false;
  const rect=app.getBoundingClientRect();
  return !document.documentElement.classList.contains('taxi-auth-locked') &&
   getComputedStyle(app).display!=='none' &&
   getComputedStyle(app).visibility==='visible' &&
   rect.width>250&&rect.height>200 &&
   getComputedStyle(panel).display!=='none';""")
try:
 # Deterministic browser geolocation: no real person's position enters the test.
 driver.execute_cdp_cmd('Browser.grantPermissions', {
  'origin':'http://127.0.0.1:8765','permissions':['geolocation']})
 driver.execute_cdp_cmd('Emulation.setGeolocationOverride', {
  'latitude':34.780123,'longitude':135.400321,'accuracy':12})
 driver.get('http://127.0.0.1:8765/demo/index.html')
 wait.until(lambda _: app_ready())
 wait.until(lambda _: app_visible())
 assert '公開操作デモ' in driver.title
 # Test the observed failure: app exists but production login CSS must not blank it.
 assert app_visible(),'demo user must actually see the operation screen'
 assert js("return document.querySelector('.meter-console').getBoundingClientRect().height>100")
 driver.set_window_size(1510,850)
 assert app_visible(),'desktop Edge-like width must not blank the demo'
 driver.set_window_size(430,960)
 assert app_visible(),'phone-size viewport must still display the app'
 assert js("return window.__TAXIAPP_DEMO__.externalServicesEnabled") is False
 assert js("return window.__TAXIAPP_DEMO__.deviceGpsEnabled") is True
 assert js("return !document.querySelector('#demoGpsCheck').disabled")
 assert js("return !!navigator.geolocation && window.isSecureContext")
 js("document.getElementById('demoGpsCheck').click()")
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts.length")==1
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 assert js("return document.querySelectorAll('[data-drive-record-id]').length")==2
 assert js("return !document.querySelector('#accountSignIn')"),'real login must not appear'
 assert js("return localStorage.length")==0,'no real browser localStorage'
 assert js("return !document.querySelector('script[src]')"),'no external JS'
 # Same real meter workflow: board -> alight/payment -> fare -> settle -> saved row.
 js("document.querySelector('[data-action=beginRide]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft?.kind==='ride'"))
 # Same GPS pickup action as production. Mock coordinates prove the actual button
 # populates the current ride without any remote reverse geocoding.
 assert js("return !!document.querySelector('[data-action=gpsPickup]')")
 assert js("return !document.querySelector('[data-action=gpsPickup]').disabled")
 js("document.querySelector('[data-action=gpsPickup]').click()")
 wait.until(lambda _: js("""const r=window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft;
  return r?.meta?.pickupGeo?.lat===34.780123 && r?.raw?.AL?.includes('GPS座標');"""))
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft.raw.D.startsWith('34.780123,135.400321')")
 assert js("return document.querySelector('[data-col=AL]').value.includes('GPS座標')")

 js("document.querySelector('[data-action=meterSettle]').click()")
 wait.until(lambda _: js("return Boolean(document.querySelector('[data-col=K]'))"))
 js("""const amount=document.querySelector('[data-col=K]');amount.value='1800';
      amount.dispatchEvent(new Event('input',{bubbles:true}));
      amount.dispatchEvent(new Event('change',{bubbles:true}));
      const cash=document.querySelector('[data-setcol=N][data-value=\\"現\\"]');
      if(cash)cash.click();""")
 # Dropoff GPS is also recorded using the browser device's position.
 assert js("return !!document.querySelector('[data-action=gpsDrop]')")
 js("document.querySelector('[data-action=gpsDrop]').click()")
 wait.until(lambda _: js("""const r=window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft;
   return r?.meta?.dropGeo?.lat===34.780123 && r?.raw?.AM?.includes('GPS座標');"""))
 js("document.querySelector('[data-action=saveDraft]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length===3"))
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft===null")
 assert js("return !document.querySelector('#accountSignIn')")
 # Native device GPS is disabled; browser trip measurement must be accessible.
 js("document.querySelector('[data-tab=settings]').click()")
 wait.until(lambda _: js("return !!document.querySelector('[data-settings-category-choice=gps]')"))
 js("document.querySelector('[data-settings-category-choice=gps]').click()")
 wait.until(lambda _: js("return !!document.querySelector('[data-action=gpsTripStart]')"))
 assert js("return !document.querySelector('[data-action=gpsTripStart]').disabled")
 js("document.querySelector('[data-action=gpsTripStart]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].gpsTrip?.enabled===true"))
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].gpsTrip?.lastSeenMs>0"))
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].gpsTrip.tripKm>=0")
 js("document.querySelector('[data-action=gpsTripStop]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].gpsTrip?.enabled===false"))
 first=driver.current_window_handle
 driver.switch_to.new_window('tab')
 driver.get('http://127.0.0.1:8765/demo/index.html')
 wait.until(lambda _: app_ready())
 assert app_visible(),'concurrent tab also shows live demo'
 second=driver.current_window_handle
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 # A change in one tab cannot affect a second tab's JavaScript model.
 driver.switch_to.window(first)
 js("document.querySelector('#demoFreshStart').click()")
 wait.until(lambda _: driver.switch_to.alert is not None)
 driver.switch_to.alert.accept()
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts.length===0"))
 assert app_visible(),'app stays visible after resetting from the top banner'
 assert js("return document.querySelector('[data-action=startShift]')!==null"),'start-duty control exists'
 driver.switch_to.window(second)
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 assert js("return document.querySelector('[data-drive-record-id]')!==null")
 driver.refresh()
 wait.until(lambda _: app_ready())
 assert app_visible(),'reload must not return to blank screen'
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 assert js("return localStorage.length")==0
 print('PASS: real Chrome, device GPS pickup/drop, browser trip start/stop, no cloud sharing, concurrent tabs, reload')
finally:
 try:
  logs=driver.get_log('browser')
  serious=[l for l in logs if l.get('level')=='SEVERE']
  if serious:print('BROWSER LOG:',str(serious)[:2400])
 except Exception:pass
 driver.quit()

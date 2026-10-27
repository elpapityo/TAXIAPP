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
try:
 driver.get('http://127.0.0.1:8765/demo/index.html')
 wait.until(lambda _: app_ready())
 assert '公開操作デモ' in driver.title
 assert js("return window.__TAXIAPP_DEMO__.externalServicesEnabled") is False
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts.length")==1
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 assert js("return document.querySelectorAll('[data-drive-record-id]').length")==2
 assert js("return !document.querySelector('#accountSignIn')"),'real login must not appear'
 assert js("return localStorage.length")==0,'no real browser localStorage'
 assert js("return !document.querySelector('script[src]')"),'no external JS'
 # Same real meter workflow: board -> alight/payment -> fare -> settle -> saved row.
 js("document.querySelector('[data-action=beginRide]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft?.kind==='ride'"))
 js("""const el=document.querySelector('[data-col=AL]');if(!el)throw Error('pickup address input absent');
      el.value='デモ乗車地点';el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));""")
 js("document.querySelector('[data-action=meterSettle]').click()")
 wait.until(lambda _: js("return Boolean(document.querySelector('[data-col=K]'))"))
 js("""const amount=document.querySelector('[data-col=K]');amount.value='1800';
      amount.dispatchEvent(new Event('input',{bubbles:true}));
      amount.dispatchEvent(new Event('change',{bubbles:true}));
      const cash=document.querySelector('[data-setcol=N][data-value=\\"現\\"]');
      if(cash)cash.click();""")
 js("document.querySelector('[data-action=saveDraft]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length===3"))
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft===null")
 assert js("return !document.querySelector('#accountSignIn')")
 first=driver.current_window_handle
 driver.switch_to.new_window('tab')
 driver.get('http://127.0.0.1:8765/demo/index.html')
 wait.until(lambda _: app_ready())
 second=driver.current_window_handle
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 # A change in one tab cannot affect a second tab's JavaScript model.
 driver.switch_to.window(first)
 js("document.querySelector('#demoFreshStart').click()")
 wait.until(lambda _: driver.switch_to.alert is not None)
 driver.switch_to.alert.accept()
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts.length===0"))
 assert js("return document.querySelector('[data-action=startShift]')!==null"),'start-duty control exists'
 driver.switch_to.window(second)
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 assert js("return document.querySelector('[data-drive-record-id]')!==null")
 driver.refresh()
 wait.until(lambda _: app_ready())
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 assert js("return localStorage.length")==0
 print('PASS: real Chrome, no login, same meter UI, independent concurrent tabs, reset, no persistence')
finally:
 try:
  logs=driver.get_log('browser')
  serious=[l for l in logs if l.get('level')=='SEVERE']
  if serious:print('BROWSER LOG:',str(serious)[:2400])
 except Exception:pass
 driver.quit()

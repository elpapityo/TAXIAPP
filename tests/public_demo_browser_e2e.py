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
 # GSI's address response is simulated for stable end-to-end testing.
 # Only a single GSI host is intercepted; municipalities.json loads from this site.
 driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source': r"""
 (() => {
  const nativeFetch=window.fetch.bind(window), nativeConfirm=window.confirm.bind(window);
  window.__demoReverseRequests=[];
  window.fetch=function(resource,options){
   const url=String(resource);
   if(url.startsWith('https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?')){
    window.__demoReverseRequests.push(url);
    return Promise.resolve(new Response(JSON.stringify({results:{
     muniCd:'28207',lv01Nm:'中央一丁目'}}),{
     status:200,headers:{'Content-Type':'application/json'}}));
   }
   return nativeFetch(resource,options);
  };
  window.confirm=function(message){
   return String(message).includes('国土地理院')?true:nativeConfirm(message);
  };
 })();
 """})
 driver.get('http://127.0.0.1:8765/demo/index.html')
 wait.until(lambda _: app_ready())
 wait.until(lambda _: app_visible())
 assert '公開操作デモ' in driver.title
 # Test the observed failure: app exists but production login CSS must not blank it.
 assert app_visible(),'demo user must actually see the operation screen'
 assert js("return document.querySelector('.meter-console').getBoundingClientRect().height>100")

 # The three control buttons at the top of the drive screen use the same 36px height.
 assert js("""const a=document.querySelector('.preview-screen-head .drive-head-actions');
  if(!a)return false;
  const buttons=[...a.querySelectorAll('button')];
  const shortcut=a.querySelector('.drive-field-shortcut');
  const theme=a.querySelector('.drive-theme-toggle');
  if(!shortcut||!theme||buttons.length<3)return false;
  const heights=buttons.map(b=>Math.round(b.getBoundingClientRect().height));
  return heights.every(h=>h===36);
 """), 'drive header button heights must all be 36px'
 # Toggle with existing theme setting, and toggle back; no shift or payment data changes.
 original_theme=js("return document.documentElement.dataset.uiTheme")
 assert original_theme in ('day','night')
 initial_count=js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")
 next_theme='night' if original_theme=='day' else 'day'
 assert js("return document.querySelector('.drive-theme-toggle').dataset.uiValue")==next_theme
 js("document.querySelector('.drive-theme-toggle').click()")
 wait.until(lambda _: js("return document.documentElement.dataset.uiTheme")==next_theme)
 wait.until(lambda _: js("return document.querySelector('.drive-theme-toggle')?.dataset.uiValue")==original_theme)
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==initial_count
 js("document.querySelector('.drive-theme-toggle').click()")
 wait.until(lambda _: js("return document.documentElement.dataset.uiTheme")==original_theme)
 wait.until(lambda _: js("return document.querySelector('.drive-theme-toggle')?.dataset.uiValue")==next_theme)
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==initial_count

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
 # Independent monthly management must accept local plans and goals without editing a duty.
 js("document.querySelector('.taxi-mobile-more-panel [data-tab=monthly]').click()")
 wait.until(lambda _: js("return !!document.querySelector('.month-plan-calendar')"))
 initial_duty=js("return JSON.stringify(window.__TAXIAPP_DEMO__.snapshot().shifts)")
 js("document.querySelector('[data-action=monthlyManagementMode][data-id=targets]').click()")
 wait.until(lambda _: js("return !!document.querySelector('#monthlyGoalInput')"))
 assert js("return !document.querySelector('#monthlyGoalInput').disabled")
 selected_month=js("return document.getElementById('monthlyDashboardMonth').value")
 js("document.getElementById('monthlyGoalInput').value='950000'; document.querySelector('[data-action=monthlyGoalSave]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlySalesGoals?.[arguments[0]]===950000",selected_month))
 js("document.getElementById('monthlyWeekdayGoal1').value='33000'; document.querySelector('[data-action=monthlyWeekdayGoalSave]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyWeekdaySalesGoals?.['1']===33000"))
 js("document.querySelector('[data-action=monthlyManagementMode][data-id=calendar]').click()")
 wait.until(lambda _: js("return !!document.querySelector('.month-plan-day')"))
 js("document.querySelector('.month-plan-day').click()")
 wait.until(lambda _: js("return !!document.querySelector('#monthlyPlanStatus')"))
 chosen_date=js("return document.querySelector('.month-plan-day.selected').dataset.id")
 js("document.getElementById('monthlyDateGoalInput').value='44000'; document.querySelector('[data-action=monthlyDateGoalSave]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyDateSalesGoals?.[arguments[0]]===44000",chosen_date))
 js("""document.getElementById('monthlyPlanStatus').value='work';
     document.getElementById('monthlyPlanStart').value='17:00';
     document.getElementById('monthlyPlanEnd').value='06:00';
     document.querySelector('[data-action=monthlyPlanSave]').click()""")
 wait.until(lambda _: js("return !!document.querySelector('.month-plan-day.work')"))
 assert js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyDutyPlans[arguments[0]].start",chosen_date)=='17:00'
 assert js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyDutyPlans[arguments[0]].end",chosen_date)=='06:00'
 js("document.getElementById('monthlyActualStatus').value='public'; document.querySelector('[data-action=monthlyActualSave]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyDutyActuals?.[arguments[0]]?.status==='public'",chosen_date))
 js("document.querySelector('[data-action=monthlyManagementMode][data-id=targets]').click()")
 wait.until(lambda _: js("return !!document.getElementById('monthlyPublicIncluded')"))
 js("document.getElementById('monthlyPublicIncluded').checked=true; document.querySelector('[data-action=monthlyPublicGoalSave]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyIncludePublicSales==='on'"))
 js("document.querySelector('[data-action=monthlyManagementMode][data-id=bulk]').click()")
 wait.until(lambda _: js("return !!document.getElementById('monthlyBulkStatus')"))
 js("""for(let d=0;d<7;d++)document.getElementById('monthlyBulkDay'+d).checked=(d===1);
     document.getElementById('monthlyBulkStatus').value='off';
     document.querySelector('[data-action=monthlyPlanBulkSave]').click()""")
 wait.until(lambda _: js("return !!document.querySelector('.month-plan-calendar')"))
 assert js("return Object.values(window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyDutyPlans).some(x=>x.status==='off')")
 assert js("return window.__TAXIAPP_DEMO__.snapshot().prefs.monthlyDutyActuals[arguments[0]].status",chosen_date)=='public'
 assert js("return JSON.stringify(window.__TAXIAPP_DEMO__.snapshot().shifts)")==initial_duty, 'monthly plan must not mutate the current duty'
 js("document.querySelector('[data-tab=live]').click()")
 wait.until(lambda _: js("return !!document.querySelector('.operations-overview')"))
 assert not js("return !!document.querySelector('[data-monthly-sales-panel]')"), 'monthly totals belong to the independent screen'

 # A visitor can inspect the selected duty summary without login or altering records.
 js("document.querySelector('[data-tab=history]').click()")
 wait.until(lambda _: js("return !!document.querySelector('[data-history-panel=summary]')"))
 assert '乗務サマリー' in js("return document.querySelector('[data-history-panel=summary] summary').textContent")
 js("document.querySelector('[data-history-panel=summary] summary').click()")
 assert js("return document.querySelector('.history-duty-summary').getBoundingClientRect().height>150")

 # Global card hierarchy: outer duty and nested summary have distinct fills,
 # heading colors and smaller nested padding in both light and night themes.
 for theme in ['day','night']:
  assert js("""const html=document.documentElement,theme=arguments[0];
   html.setAttribute('data-ui-theme',theme);
   const outer=document.querySelector('.history-duty-card');
   const inner=outer?.querySelector('details[data-history-panel="summary"]');
   const heading=outer?.querySelector('.section-heading .h2');
   const subheading=inner?.querySelector('summary');
   const content=inner?.querySelector(':scope > .inner');
   if(!outer||!inner||!heading||!subheading||!content)return false;
   const css=x=>getComputedStyle(x);
   return css(outer).backgroundColor!==css(inner).backgroundColor &&
    css(heading).color!==css(subheading).color &&
    Number.parseFloat(css(content).paddingLeft)<Number.parseFloat(css(outer).paddingLeft);
   """,theme), 'nested card hierarchy must remain visually distinct in '+theme
 js("document.documentElement.removeAttribute('data-ui-theme')")

 for key in ['営業回数','キャンセル回数','時間単価','距離単価',
  '待機時間合計','税込','税別参考','アプリ配車売上','乗込み・その他／無線売上']:
  assert key in js("return document.querySelector('.history-duty-summary').textContent"),key
 assert '¥2,300' in js("return document.querySelector('.history-duty-summary').textContent")
 assert '¥1,500' in js("return document.querySelector('.history-duty-summary').textContent")
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].records.length")==2
 js("document.querySelector('[data-tab=drive]').click()")
 wait.until(lambda _: js("return !!document.querySelector('.meter-console')"))
 # Same real meter workflow: board -> alight/payment -> fare -> settle -> saved row.
 js("document.querySelector('[data-action=beginRide]').click()")
 wait.until(lambda _: js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft?.kind==='ride'"))
 # Same GPS pickup action as production. Device GPS -> explicit GSI consent
 # -> API municipality/area conversion -> Japanese district in the field.
 assert js("return !!document.querySelector('[data-action=gpsPickup]')")
 assert js("return !document.querySelector('[data-action=gpsPickup]').disabled")
 js("document.querySelector('[data-action=gpsPickup]').click()")
 wait.until(lambda _: js("""const r=window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft;
  return r?.meta?.pickupGeo?.lat===34.780123 && r?.raw?.AL?.includes('中央');"""))
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft.raw.D.startsWith('34.780123,135.400321')")
 assert js("return document.querySelector('[data-col=AL]').value.includes('中央')")
 assert js("return window.__demoReverseRequests.length===1")
 assert js("return window.__demoReverseRequests[0].includes('lat=34.780123')")
 assert js("return window.__TAXIAPP_DEMO__.snapshot().shifts[0].draft.meta.pickupAddressProvider==='国土地理院'")

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
   return r?.meta?.dropGeo?.lat===34.780123 && r?.raw?.AM?.includes('中央');"""))
 assert js("return window.__demoReverseRequests.length===1"), 'identical GPS points should reuse GSI cache, not send twice'
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
 print('PASS: Chrome GPS to GSI district, pickup/drop populated, browser trip, tab isolation')
finally:
 try:
  logs=driver.get_log('browser')
  serious=[l for l in logs if l.get('level')=='SEVERE']
  if serious:print('BROWSER LOG:',str(serious)[:2400])
 except Exception:pass
 driver.quit()

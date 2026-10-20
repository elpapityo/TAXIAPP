#!/usr/bin/env python3
"""Real Chrome: diary optional fields and old GPS/highway distance settings are one preference."""
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By

options=Options()
for flag in ('--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1000,1000'):
    options.add_argument(flag)
options.add_argument('--user-data-dir='+tempfile.mkdtemp(prefix='taxiapp-diary-fields-'))
browser=webdriver.Chrome(options=options)
try:
    browser.get('http://127.0.0.1:8765/')
    wait=WebDriverWait(browser,30)
    wait.until(lambda d: 'TAXIAPP v0.3.102' in d.title)
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,'#app [data-open-ride-fields]')))
    shortcut=browser.execute_script("""
      const button=document.querySelector('[data-open-ride-fields]');
      return {title:document.title,text:button?.textContent,
              fromDrive:!!button?.closest('.preview-screen-head')};
    """)
    assert shortcut['fromDrive'] and '入力項目を選ぶ' in shortcut['text'],shortcut
    browser.execute_script("document.querySelector('[data-open-ride-fields]').click()")
    wait.until(lambda d: d.execute_script("""
      const parent=document.querySelector('details[data-business-field-settings]'),
        child=parent?.querySelector('details[data-ride-field-settings]');
      return !!parent?.open && !!child?.open;
    """))
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR,'[data-ride-field-settings] [data-ride-field]'))
    state=browser.execute_script("""
      const p=document.querySelector('[data-business-field-settings]');
      const menu=p.querySelector('[data-ride-field-settings]');
      p.open=true;menu.open=true;
      return {
        optional:[...menu.querySelectorAll('[data-ride-field]')].map(x=>x.dataset.rideField),
        shared:[...menu.querySelectorAll('[data-ride-distance-setting]')].map(x=>x.dataset.rideDistanceSetting),
        labels:menu.textContent,
        switches:[...document.querySelectorAll('[data-distance-setting]')].map(x=>x.dataset.distanceSetting)
      };
    """)
    assert state['optional']==[
      'received','passengers','dropAddress','highway','discount','cashCheckout',
      'dispatchNote','cancelPickupAddress','emptyHighwayRoute'
    ],state
    assert state['shared']==['pickupDropDistance','highwayDistance'],state
    assert sorted(state['switches'])==['highwayDistance','pickupDropDistance'],state
    assert '固定表示・入力必須' in state['labels'],state
    # CI runs as an unsigned viewer. The app deliberately blocks all edit events.
    # Exercise real writer change-handler logic in the Node VM dependency test instead
    # of weakening the app's one-writer/read-only security policy.
    layout=browser.execute_script("""
      const parent=document.querySelector('[data-business-field-settings]'),
        menu=document.querySelector('[data-ride-field-settings]');
      const shared=['pickupDropDistance','highwayDistance'];
      return {parentOpen:parent.open,childOpen:menu.open,
        consistency:shared.every(k=>{
          const select=document.querySelector('[data-distance-setting="'+k+'"]');
          const checkbox=document.querySelector('[data-ride-distance-setting="'+k+'"]');
          return !!select && !!checkbox && checkbox.checked===(select.value==='on');
        }),readonly:document.querySelector('.status-pill')?.textContent||'',
        existing:menu.querySelectorAll('[data-ride-field]').length};
    """)
    assert layout['parentOpen'] and layout['childOpen'],layout
    assert layout['consistency'] and layout['existing']==9,layout
    # No authenticated writing session is configured in CI.
    assert '閲覧' in layout['readonly'] or '確認中' in layout['readonly'],layout
    assert browser.execute_script("""
      const parent=document.querySelector('[data-business-field-settings]');
      const summary=parent?.querySelector('[data-drive-status-settings]');
      return !!summary && !summary.open && 
        document.querySelectorAll('details.settings-advanced[data-drive-status-settings]').length===0;
    """),'drive status must be nested as previously requested'
    print('PASS Chrome: nine optional controls, two shared distance settings,'
          ' fixed inputs and safely read-only client layout')
finally:
    browser.quit()

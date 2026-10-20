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
    wait.until(lambda d: 'TAXIAPP v0.3.100' in d.title)
    wait.until(lambda d: bool(d.find_elements(By.CSS_SELECTOR,'#app [data-tab="settings"]')))
    browser.execute_script("document.querySelector('[data-tab=settings]').click()")
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
    def set_check(key,checked):
        return browser.execute_script("""
          const el=document.querySelector('[data-ride-distance-setting="'+arguments[0]+'"]');
          if(!el)return false;
          el.checked=arguments[1];
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        """,key,checked)
    def set_old(key,value):
        return browser.execute_script("""
          const el=document.querySelector('[data-distance-setting="'+arguments[0]+'"]');
          if(!el)return false;
          el.value=arguments[1];
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        """,key,value)
    def state_for(key):
        return browser.execute_script("""
          const key=arguments[0],a=document.querySelector('[data-ride-distance-setting="'+key+'"]'),
            b=document.querySelector('[data-distance-setting="'+key+'"]');
          return {checked:a?.checked,old:b?.value,
            parentOpen:document.querySelector('[data-business-field-settings]')?.open,
            childOpen:document.querySelector('[data-ride-field-settings]')?.open};
        """,key)
    for field in ('highwayDistance','pickupDropDistance'):
        assert set_check(field,False),field
        wait.until(lambda _: state_for(field)['old']=='off')
        assert state_for(field)=={'checked':False,'old':'off','parentOpen':True,'childOpen':True},field
        assert set_old(field,'on'),field
        wait.until(lambda _: state_for(field)['checked'] is True)
        assert state_for(field)['old']=='on',field
    for key in ('discount','dispatchNote','emptyHighwayRoute','cashCheckout'):
        changed=browser.execute_script("""
          const el=document.querySelector('[data-ride-field="'+arguments[0]+'"]');
          if(!el)return false;
          el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        """,key)
        assert changed,key
        wait.until(lambda d: d.execute_script(
          'return document.querySelector(\'[data-ride-field="'+arguments[0]+'"]\')?.checked===false',key))
        assert browser.execute_script(
            "return document.querySelector('[data-ride-field-settings]').open && document.querySelector('[data-business-field-settings]').open"
        ),'setting should not collapse after checkbox update'
    print('PASS Chrome: 9 selectable diary groups, required guard, shared distance settings both directions and nested menu state')
finally:
    browser.quit()

#!/usr/bin/env python3
"""Synthetic V2 print device lab: Chrome mobile/landscape/desktop checks. No real data."""
import tempfile,base64,io
from pypdf import PdfReader
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait, Select

url="http://127.0.0.1:8765/labs/print-v2-device-preview.html"
opts=Options()
for option in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1280,850"):
    opts.add_argument(option)
opts.add_argument("--user-data-dir="+tempfile.mkdtemp(prefix="taxiapp-v2-device-"))
browser=webdriver.Chrome(options=opts)
try:
    browser.get(url)
    WebDriverWait(browser,20).until(lambda d:"模擬テスト成功" in d.find_element(By.ID,"status").text)
    assert browser.title=="TAXIAPP 印刷V2 実機テスト｜合成データ専用"
    page=browser.find_element(By.ID,"pages")
    assert len(page.find_elements(By.CLASS_NAME,"paper"))==2
    for w,h in [(390,844),(844,390),(768,1024),(1280,850)]:
        browser.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{
            "width":w,"height":h,"deviceScaleFactor":1,"mobile":w<1000
        })
        for n,a,b in [(1,1,0),(36,36,0),(37,36,1),(60,36,24)]:
            Select(browser.find_element(By.ID,"scenario")).select_by_value(str(n))
            current=browser.execute_script("""return {
                first:document.querySelector('[data-testid=pageCount1]').textContent,
                second:document.querySelector('[data-testid=pageCount2]').textContent,
                status:document.querySelector('#status').textContent,
                viewport:document.documentElement.scrollWidth
            }""")
            assert current["first"]==f"{a}件",(w,h,n,current)
            assert current["second"]==f"{b}件",(w,h,n,current)
            assert "14 / 14" in current["status"],(w,h,n,current)
            assert current["viewport"]<=w+2,("horizontal page overflow",w,h,n,current)
        latest=browser.find_element(By.ID,"latest")
        if latest.is_selected():
            latest.click()
        Select(browser.find_element(By.ID,"selectDuty")).select_by_value("shift-1792103640000")
        assert browser.find_element(By.ID,"derived").get_attribute("value")=="shift-1792103640000"
        latest.click()
        assert browser.find_element(By.ID,"derived").get_attribute("value")=="shift-1792124520000"
        assert browser.find_element(By.ID,"selectDuty").get_attribute("disabled") is not None
    # Actual Chrome print rendering: independent laboratory sheet must
    # produce exactly two A4 landscape pages even at the 60-record boundary.
    for records in (1,36,37,60):
        Select(browser.find_element(By.ID,"scenario")).select_by_value(str(records))
        pdf=browser.execute_cdp_cmd("Page.printToPDF",{
            "printBackground":True,"landscape":True,"preferCSSPageSize":True
        })
        count=len(PdfReader(io.BytesIO(base64.b64decode(pdf["data"]))).pages)
        assert count==2,("synthetic A4 pages",records,count)
    browser.execute_script("window.__printed=0;window.print=()=>{window.__printed++};")
    browser.find_element(By.ID,"print").click()
    assert browser.execute_script("return window.__printed")==1
    browser.execute_cdp_cmd("Network.enable",{})
    browser.execute_cdp_cmd("Network.emulateNetworkConditions",{
        "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    Select(browser.find_element(By.ID,"scenario")).select_by_value("37")
    assert "14 / 14" in browser.find_element(By.ID,"status").text
    assert browser.find_element(By.ID,"derived").get_attribute("value")=="shift-1792124520000"
    print("V2 device preview smoke PASS: mobile portrait/landscape, tablet, desktop, 1/36/37/60, selection, 2-page print layout, print dialog stub, offline")
finally:
    browser.quit()

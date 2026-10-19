#!/usr/bin/env python3
"""Real published v1.1 APK -> Android foreground GPS -> localhost HTTP -> desktop Chrome.
Runs on Android emulator GitHub Actions, NOT mocked browser/GPS data. The browser
opens exactly the localhost URL served by the Android APK over adb port-forward.
"""
import json
import re
import xml.etree.ElementTree as ET
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

ROOT = pathlib.Path("gps-e2e-evidence")
ROOT.mkdir(exist_ok=True)
APP = "jp.taxiapp.gpsprototype.distancelabv110"
MAIN = "jp.taxiapp.gpsprototype.MainActivity"
SERVICE = "jp.taxiapp.gpsprototype.GpsTrackingService"
PORT = 48764
BASE = f"http://127.0.0.1:{PORT}/"
STATE_KEY = "gps-distance-lab-browser-v080"
HISTORY_KEY = "gps-distance-lab-history-v110"
driver = None
steps = []

def note(label, **data):
    entry = {"step": label, "time": time.strftime("%H:%M:%S"), **data}
    print(json.dumps(entry, ensure_ascii=False), flush=True)
    steps.append(entry)
    (ROOT / "steps.json").write_text(json.dumps(steps, ensure_ascii=False, indent=2))

def adb(*args, timeout=30, check=True):
    command = ["adb", *args]
    out = subprocess.run(command, check=False, text=True, capture_output=True, timeout=timeout)
    if check and out.returncode:
        raise RuntimeError(f"{command}: {out.returncode}; stderr={out.stderr}; stdout={out.stdout}")
    return out.stdout.strip()

def tap_native_button(fragment):
    """Tap a visible button inside the APP, not an unexported Android Service.
    The app itself starts foreground GPS with its normal permission lifecycle.
    """
    for _ in range(8):
        adb("shell", "uiautomator", "dump", "/sdcard/gps-test-window.xml",
            timeout=45, check=False)
        xml = adb("shell", "cat", "/sdcard/gps-test-window.xml", timeout=15, check=False)
        try:
            root = ET.fromstring(xml)
            for item in root.iter("node"):
                text = item.attrib.get("text", "")
                if fragment in text:
                    coords = list(map(int, re.findall(r"\d+", item.attrib.get("bounds", ""))))
                    if len(coords) == 4:
                        x = (coords[0] + coords[2]) // 2
                        y = (coords[1] + coords[3]) // 2
                        adb("shell", "input", "tap", str(x), str(y), timeout=30)
                        note("Tapped real Android native button", label=text, x=x, y=y)
                        return
        except ET.ParseError:
            pass
        time.sleep(2)
    raise AssertionError(f"Could not locate native button: {fragment}")

def http(path, timeout=5):
    req = urllib.request.Request(BASE + path, headers={"Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def wait_http(path, condition, timeout=50):
    deadline = time.monotonic() + timeout
    latest = None
    while time.monotonic() < deadline:
        try:
            latest = http(path)
            if condition(latest):
                return latest
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise AssertionError(f"timed out waiting {path}, last={latest}")

def inject_gps(lat="34.700000", lon="135.200000"):
    result = adb("emu", "geo", "fix", str(lon), str(lat), timeout=15)
    note("Emulator GPS location injected", lat=lat, lon=lon, emulator=result)

def web_json(key):
    return driver.execute_script("return JSON.parse(localStorage.getItem(arguments[0]) || 'null')", key)

def wait_until(predicate, label, timeout=25):
    return WebDriverWait(driver, timeout, poll_frequency=0.25).until(
        lambda d: predicate(), message=label
    )

try:
    note("Installing exact published GPS Distance Lab v1.1 APK")
    apk = pathlib.Path("gps-lab-v110-shipped.apk")
    assert apk.is_file() and apk.stat().st_size > 50000, "v1.1 release APK was not downloaded"
    adb("install", "-r", str(apk), timeout=90)
    assert APP in adb("shell", "pm", "list", "packages", APP), "installed APK id differs"
    for perm in ("android.permission.ACCESS_FINE_LOCATION",
                 "android.permission.ACCESS_COARSE_LOCATION",
                 "android.permission.POST_NOTIFICATIONS"):
        adb("shell", "pm", "grant", APP, perm, check=False)
    adb("shell", "cmd", "location", "set-location-enabled", "true", check=False)
    adb("shell", "am", "start", "-n", f"{APP}/{MAIN}", timeout=25)
    time.sleep(1)
    tap_native_button("GPS測定を開始")
    adb("forward", "tcp:48764", "tcp:48764")

    identity = wait_http("api/identity",
        lambda x: x.get("webVersion") == "1.1.0" and
                  x.get("packageId") == APP, timeout=45)
    note("Real native localhost HTTP identity verified", identity=identity)
    assert identity.get("marker") == "GPS_DISTANCE_LAB_EXTERNAL_V1_1"

    status = wait_http("api/status", lambda x: x.get("running") is True, timeout=25)
    note("GPS foreground service running", status=status)
    assert status.get("runId"), "Android GPS runId missing"
    for _ in range(15):
        inject_gps()
        time.sleep(2)
        status = http("api/status")
        if status.get("ageMs") is not None and status["ageMs"] < 10000 and status.get("accuracyMeters") is not None:
            break
    note("GPS after emulator location fixes", status=status)
    assert status.get("ageMs") is not None and status["ageMs"] <= 15000, \
        "Android emulator has not delivered a fresh native GPS position"
    assert status.get("accuracyMeters") is not None and status["accuracyMeters"] <= 45, \
        "Android emulator's GPS fix fails published native accuracy gate"

    # Verify native API really returns a distance snapshot from GpsStore, not a JS mock.
    nonce = "a" * 32
    raw = http(f"api/capture?nonce={nonce}&target=start")
    note("Native Android HTTP capture returned", response=raw)
    assert raw.get("ready") is True
    assert raw.get("snapshot", {}).get("nonce") == nonce
    assert raw["snapshot"]["runId"] == status["runId"]
    assert raw["snapshot"]["tripKm"] == status["tripKm"]

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1050,1500")
    options.add_argument("--no-first-run")
    options.add_argument("--disable-gpu")
    options.add_argument("--user-data-dir=" + tempfile.mkdtemp(prefix="gps-e2e-chrome-"))
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(25)
    driver.get(BASE)
    wait_until(lambda: "Web v1.1" in driver.page_source, "real external Chrome received APK HTML")
    wait_until(lambda: driver.execute_script("return typeof window.DistanceNative === 'object'"), "native bridge")
    wait_until(lambda: "runId" in driver.execute_script("return window.DistanceNative.getStatus()"),
               "real browser fetched native GPS runId")
    assert driver.find_element(By.ID, "connection").text == "外部ブラウザGPS接続"
    note("Real desktop Chrome received Android-hosted Web v1.1 and GPS status",
         title=driver.title,
         native=driver.execute_script("return window.DistanceNative.getStatus()"))

    assert driver.find_element(By.ID, "start-btn").is_enabled(), "new Chrome profile should allow 0km"
    driver.find_element(By.ID, "start-btn").click()
    wait_until(lambda: (web_json(STATE_KEY) or {}).get("startNative") is not None,
               "Chrome did not persist a 0km native baseline")
    baseline = web_json(STATE_KEY)
    note("Chrome set the 0km reference using real Android capture", baseline=baseline)
    assert baseline["sessionId"] == status["runId"]
    assert "基準点を 0.000 km に設定済み" in driver.find_element(By.ID, "start-detail").text

    # Inject a sequence of GPS points while leaving a real browser tab open.
    for i in range(1, 9):
        inject_gps(lat=f"{34.700000 + i * 0.00006:.6f}")
        time.sleep(2.5)
    before = http("api/status")
    note("Android native GPS cumulative after simulated travel", status=before)

    browser_row_button = driver.find_element(By.CSS_SELECTOR, "[data-capture='0']")
    assert browser_row_button.is_enabled()
    browser_row_button.click()
    wait_until(lambda: (web_json(STATE_KEY) or {}).get("rows", [{}])[0].get("gps") is not None,
               "Chrome GPS capture did not complete", timeout=35)
    row = web_json(STATE_KEY)["rows"][0]
    current = http("api/status")
    note("Real Chrome GPS checkpoint stored from native API", row=row, native=current)
    assert abs(row["gps"] - current["tripKm"]) < 0.010, \
        "Browser GPS cumulative and native service differ by over 10m"
    assert "取得済み" in driver.find_element(By.CSS_SELECTOR, "[data-capture='0']").text

    # Exercise manual correction then a new native checkpoint in THE SAME Chrome tab.
    manual = driver.find_element(By.CSS_SELECTOR, "[data-manual='0']")
    driver.execute_script(
        "arguments[0].value='0.500'; arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",
        manual
    )
    wait_until(lambda: (web_json(STATE_KEY) or {}).get("rows", [{}])[0].get("manual") == "0.5",
               "manual car-odometer correction")
    driver.find_element(By.ID, "add-btn").click()
    inject_gps(lat="34.700600")
    time.sleep(4)
    driver.find_element(By.CSS_SELECTOR, "[data-capture='1']").click()
    wait_until(lambda: (web_json(STATE_KEY) or {}).get("rows", [{}, {}])[1].get("gps") is not None,
               "second native GPS capture", timeout=35)
    after = web_json(STATE_KEY)
    first_gps = after["rows"][0]["gps"]
    second_gps = after["rows"][1]["gps"]
    # All values in km; interval is the diff between two native app readings.
    expected = round(0.5 + second_gps - first_gps, 3)
    ui = driver.find_element(By.ID, "rows").text
    note("Browser added GPS delta to manually corrected 500m base",
         first=first_gps, second=second_gps, expected_km=expected,
         ui_excerpt=ui[-1200:])
    assert f"{expected:.3f}" in ui, \
        f"Expected corrected cumulative {expected:.3f}km absent from rendered Chrome UI"
    assert len(driver.window_handles) == 1, "GPS capture unexpectedly opened new Chrome tabs"

    # Android foreground-service restart must change runId and warn about prior browser 0km.
    adb("shell", "am", "start", "-n", f"{APP}/{MAIN}", timeout=35)
    tap_native_button("GPS測定を停止")
    time.sleep(2)
    tap_native_button("GPS測定を開始")
    new_status = wait_http("api/status",
        lambda x: x.get("running") and x.get("runId") != status["runId"], timeout=45)
    note("Restarting native Android GPS created a new runId", new_status=new_status)
    wait_until(lambda: not driver.find_element(By.ID, "session-warning").get_attribute("hidden"),
               "Browser did not reject previous Android runId", timeout=10)
    assert len(driver.window_handles) == 1
    note("PASS complete: shipped APK -> real Android location -> Android local HTTP -> external Chrome -> 0km, two captures, correction, restart warning, 1 tab",
         native_distance_km=before["tripKm"])
except Exception as exc:
    note("FAIL", error=str(exc), traceback=traceback.format_exc())
    if driver:
        try:
            driver.save_screenshot(str(ROOT / "failure-browser.png"))
            (ROOT / "failure-browser.html").write_text(driver.page_source)
        except Exception:
            pass
    raise
finally:
    if driver:
        try:driver.quit()
        except Exception:pass
    try:
        (ROOT / "android-logcat.txt").write_text(adb("logcat", "-d", "-t", "500", check=False, timeout=30))
    except Exception:
        pass

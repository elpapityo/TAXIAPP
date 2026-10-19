#!/usr/bin/env python3
"""Real published v1.3.1 APK -> Android foreground GPS -> localhost HTTP -> desktop Chrome.
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
APP = "jp.taxiapp.gpsprototype.distancelabv131"
MAIN = "jp.taxiapp.gpsprototype.MainActivity"
SERVICE = "jp.taxiapp.gpsprototype.GpsTrackingService"
PORT = 48768
BASE = f"http://127.0.0.1:{PORT}/"
STATE_KEY = "gps-distance-lab-browser-diary-v131"
HISTORY_KEY = "gps-distance-lab-history-diary-v131"
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
                        if y > 2240 or y < 60:
                            adb("shell", "input", "swipe", "530", "1980", "530", "1150", "350", timeout=30)
                            time.sleep(1)
                            break
                        adb("shell", "input", "tap", str(x), str(y), timeout=30)
                        note("Tapped real Android native button", button_text=text, x=x, y=y)
                        return
        except ET.ParseError:
            pass
        adb("shell", "input", "swipe", "530", "1980", "530", "1150", "350", timeout=30)
        time.sleep(1)
    note("Native button dump on failure",
         requested=fragment,
         xml=adb("shell","cat","/sdcard/gps-test-window.xml",check=False)[:14000],
         active=adb("shell","dumpsys","activity","activities",check=False)[-4500:],
         packages=adb("shell","pm","list","packages",APP,check=False))
    raise AssertionError(f"Could not locate native button after scrolling: {fragment}")

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

def inject_gps(lat="34.700000", lon="135.200000", speed_knots=0):
    # Emulator console supports velocity in KNOTS as 5th optional argument.
    # Unlike bare "geo fix", this makes Android Location.hasSpeed/getSpeed
    # represent actual driving (>5 km/h) so TripAccumulator can add distance.
    result = adb("emu", "geo", "fix", str(lon), str(lat), "0", "8",
                 str(speed_knots), timeout=15)
    note("Emulator GPS location and speed injected", lat=lat, lon=lon,
         speed_knots=speed_knots, emulator=result)

def web_json(key):
    return driver.execute_script("return JSON.parse(localStorage.getItem(arguments[0]) || 'null')", key)

def wait_until(predicate, label, timeout=25):
    return WebDriverWait(driver, timeout, poll_frequency=0.25).until(
        lambda d: predicate(), message=label
    )

try:
    note("Installing built GPS Distance Lab v1.3.1 simulator APK")
    apk = pathlib.Path("android-prototype/app/build/outputs/apk/debug/app-debug.apk")
    assert apk.is_file() and apk.stat().st_size > 50000, "simulator app APK was not built"
    adb("install", "-r", str(apk), timeout=90)
    assert APP in adb("shell", "pm", "list", "packages", APP), "installed APK id differs"
    adb("shell","pm","grant",APP,"android.permission.POST_NOTIFICATIONS",check=False)
    # Leave Android GPS location permissions explicitly revoked.
    for p in ("android.permission.ACCESS_FINE_LOCATION","android.permission.ACCESS_COARSE_LOCATION"):
        adb("shell","pm","revoke",APP,p,check=False)
    note("GPS location permissions NOT granted; simulator must still start")
    adb("shell", "cmd", "location", "set-location-enabled", "true", check=False)
    adb("shell", "am", "start", "-n", f"{APP}/{MAIN}", timeout=25)
    time.sleep(1)
    # Do not tap "▶ 模擬走行を開始"; press speed directly while stopped.
    # This was disabled on v1.2 and is the reported real-user regression.
    tap_native_button("模擬 0km/h")
    adb("forward", "tcp:48768", "tcp:48768")

    identity = wait_http("api/identity",
        lambda x: x.get("webVersion") == "1.3.0" and
                  x.get("packageId") == APP, timeout=45)
    note("Real native localhost HTTP identity verified", identity=identity)
    assert identity.get("marker") == "GPS_DISTANCE_LAB_DIARY_V1_3_1_100"

    status = wait_http("api/status", lambda x: x.get("running") is True, timeout=25)
    note("GPS foreground service running", status=status)
    assert status.get("runId"), "Android GPS runId missing"
    status = wait_http("api/status",
        lambda x: x.get("simulated") is True and
                  x.get("simSpeedKmh") == 0 and
                  x.get("ageMs") is not None and
                  x["ageMs"] <= 10000 and
                  x.get("accuracyMeters", 99) <= 45,
        timeout=30)
    note("Native internal simulator delivers stationary 0 km/h samples", status=status)
    assert status["tripKm"] == 0, "stationary simulation must not drift"
    assert status["runId"], "simulation runId missing"

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
    wait_until(lambda: "Web v1.3.1" in driver.page_source, "real external Chrome received APK HTML")
    wait_until(lambda: driver.execute_script("return typeof window.DistanceNative === 'object'"), "native bridge")
    wait_until(lambda: "runId" in driver.execute_script("return window.DistanceNative.getStatus()"),
               "real browser fetched native GPS runId")
    assert driver.find_element(By.ID, "connection").text == "外部ブラウザGPS接続"
    note("Real desktop Chrome received Android-hosted Web v1.3.1 and GPS status",
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

    # No physical phone movement and NO emulator GPS mock location.
    # Instead click the real app's speed button. It feeds synthetic fixes to
    # the same TripAccumulator and the same local HTTP server as normal GPS.
    tap_native_button("模擬 40km/h")
    before = wait_http("api/status",
        lambda x: x.get("simSpeedKmh")==40 and x.get("tripKm",0)>=0.12,
        timeout=35)
    note("Android SIMULATED native GPS cumulative increased", status=before)
    assert before["simulated"] is True
    assert before["tripKm"]>0.12, "simulator must generate nonzero distance"

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
    tap_native_button("模擬 100km/h")
    wait_http("api/status",
        lambda x: x.get("simSpeedKmh")==100 and x.get("tripKm",0)>=before["tripKm"]+0.09,
        timeout=30)
    driver.find_element(By.CSS_SELECTOR, "[data-capture='1']").click()
    wait_until(lambda: (web_json(STATE_KEY) or {}).get("rows", [{}, {}])[1].get("gps") is not None,
               "second native GPS capture", timeout=35)
    after = web_json(STATE_KEY)
    first_gps = after["rows"][0]["gps"]
    second_gps = after["rows"][1]["gps"]
    assert first_gps >= 0.10 and second_gps > first_gps + 0.075, (
        f"Web failed to capture growing native odometer: {first_gps} -> {second_gps}")
    # All values in km; interval is the diff between two native app readings.
    expected = round(0.5 + second_gps - first_gps, 3)
    ui = driver.find_element(By.ID, "rows").text
    note("Browser added GPS delta to manually corrected 500m base",
         first=first_gps, second=second_gps, expected_km=expected,
         ui_excerpt=ui[-1200:])
    assert f"{expected:.3f}" in ui, \
        f"Expected corrected cumulative {expected:.3f}km absent from rendered Chrome UI"
    assert len(driver.window_handles) == 1, "GPS capture unexpectedly opened new Chrome tabs"

    # Stationary mode is drift-free even with fake GNSS fixes every two seconds.
    tap_native_button("模擬 0km/h")
    wait_http("api/status", lambda x: x.get("simSpeedKmh")==0, timeout=10)
    time.sleep(3)
    stopped = http("api/status")
    time.sleep(6)
    still = http("api/status")
    note("Simulation parked 0km/h without drift", before=stopped, after=still)
    assert abs(still["tripKm"]-stopped["tripKm"])<0.001, \
        "stationary simulated GPS must not add distance"

    # Android foreground-service restart must change runId and warn about prior browser 0km.
    adb("shell", "am", "start", "-n", f"{APP}/{MAIN}", timeout=35)
    tap_native_button("GPS測定を停止")
    time.sleep(2)
    tap_native_button("模擬 0km/h")
    new_status = wait_http("api/status",
        lambda x: x.get("running") and x.get("runId") != status["runId"], timeout=45)
    note("Restarting native Android GPS created a new runId", new_status=new_status)
    wait_until(lambda: not driver.find_element(By.ID, "session-warning").get_attribute("hidden"),
               "Browser did not reject previous Android runId", timeout=10)
    assert len(driver.window_handles) == 1
    # Verify the HTTP server's strict origin authorization before Chrome LNA.
    request = urllib.request.Request(BASE + "api/status",
       headers={"Origin":"https://elpapityo.github.io",
                "Access-Control-Request-Private-Network":"true",
                "Access-Control-Request-Method":"GET"},method="OPTIONS")
    with urllib.request.urlopen(request,timeout=10) as preflight:
        assert preflight.status == 204, ("LNA preflight rejected",preflight.status)
        assert preflight.info().get("Access-Control-Allow-Origin") == "https://elpapityo.github.io"
        assert preflight.info().get("Access-Control-Allow-Private-Network") == "true"
        note("Native CORS/LNA preflight confirmed",headers=dict(preflight.info()))
    # Test the ACTUAL GitHub Pages HTTPS origin -> native Android loopback.
    # Chrome 145+ requires an explicit loopback-network permission. The CDP
    # grant models the user's conscious site-specific approval in this
    # AUTOMATED TEST only. The real user must approve Chrome's prompt.
    driver.get("https://elpapityo.github.io/TAXIAPP/")
    assert "elpapityo.github.io" in driver.current_url
    first = driver.execute_async_script("""
      const finish=arguments[arguments.length-1];
      fetch('http://127.0.0.1:48768/api/status',{
          cache:'no-store',targetAddressSpace:'loopback'})
        .then(async r=>finish({ok:r.ok,status:r.status,data:await r.json()}))
        .catch(e=>finish({error:String(e)}));
    """)
    note("HTTPS origin loopback request before browser permission", response=first)
    # Browser permission in automated Chrome, equivalent to accepting an
    # explicit permission prompt: do NOT disable CORS or web security.
    permission_types = ("loopbackNetwork","localNetworkAccess","localNetwork")
    granted = None
    failures = []
    for permission in permission_types:
        try:
            driver.execute_cdp_cmd("Browser.grantPermissions", {
                "origin":"https://elpapityo.github.io",
                "permissions":[permission]})
            granted = permission
            break
        except Exception as e:
            failures.append(permission + ":" + str(e)[:280])
    assert granted is not None, (
        "Chrome CDP could not grant loopback-network permission: " + repr(failures))
    note("Explicit Chrome loopback site permission granted for E2E", permission=granted)
    response = driver.execute_async_script("""
      const finish=arguments[arguments.length-1];
      fetch('http://127.0.0.1:48768/api/status',{
          cache:'no-store',targetAddressSpace:'loopback'})
        .then(async r=>finish({ok:r.ok,status:r.status,data:await r.json()}))
        .catch(e=>finish({error:String(e)}));
    """)
    if not response.get("ok"):
        # Keep policy failures fatal, but log the reason instead of masking them.
        try:
            note("Chrome LNA failure diagnostics",
                user_agent=driver.execute_script("return navigator.userAgent"),
                browser_logs=driver.get_log("browser")[-15:],
                android_status=http("api/status"))
        except Exception as diag:
            note("Chrome diagnostic unavailable",reason=str(diag))
    note("GitHub Pages HTTPS fetched native Android API with explicit browser consent",
         response=response)
    assert response.get("ok") is True, (
        "GitHub Pages HTTPS -> Android loopback blocked despite explicit "
        "Chrome site permission and CORS headers: " + repr(response))
    assert response["data"]["running"] is True
    assert response["data"]["simulated"] is True

    # Load the checked-out integration module on the real HTTPS diary origin,
    # not a local page. Allow synthetic distance ONLY inside this E2E check;
    # actual diary reads omit the option and MUST reject simulated GPS.
    native_bridge = pathlib.Path("gps-preview/v0359/gps-diary-bridge.js").read_text()
    driver.execute_script(native_bridge)
    rejected = driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      window.TAXIAPP_EXTERNAL_GPS.read(localStorage,fetch,{shiftId:'e2e-protected'})
        .then(x=>done({unexpectedResult:x}))
        .catch(e=>done({message:String(e.message||e)}));
    """)
    note("Live diary bridge rejects synthetic GPS", result=rejected)
    assert "模擬GPS" in rejected.get("message",""), (
        "Actual diary bridge failed to reject synthetic Android location")

    result = driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      window.TAXIAPP_EXTERNAL_GPS.read(localStorage,fetch,{
          shiftId:'isolated-ci-test-only',allowSimulation:true})
        .then(x=>done({ok:true,tripKm:x.tripKm,runId:x.runId,simulated:x.simulated}))
        .catch(e=>done({error:String(e.message||e)}));
    """)
    note("Live diary module reads Android GPS on GitHub Pages after explicit consent",
         result=result)
    assert result.get("ok") is True and result.get("simulated") is True
    assert abs(result["tripKm"] - http("api/status")["tripKm"]) < 0.015
    assert len(driver.window_handles) == 1, "Native read opened more browser tabs"

    note("PASS complete: v1.3 diary-enabled simulator APK -> internal fake driving -> Android local HTTP -> external Chrome nonzero distance -> manual correction -> second growing distance -> restart warning, 1 tab",
         native_distance_km=before["tripKm"], browser_first_km=first_gps,
         browser_second_km=second_gps, corrected_second_km=expected)
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

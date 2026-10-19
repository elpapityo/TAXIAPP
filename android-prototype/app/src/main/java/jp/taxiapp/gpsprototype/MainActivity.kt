package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.view.ViewGroup
import android.widget.Toast
import org.json.JSONObject
import java.util.Locale

/**
 * GPS Distance Lab: one local WebView; no navigation to Chrome per measurement.
 * All web UI content is bundled inside the APK (not a remote web site).
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private val ui = Handler(Looper.getMainLooper())
    private val permissionRequest = 734
    private val nativeOrigin = "https://appassets.androidplatform.net/distance-console.html"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                // The only page allowed is the bundled application document.
                // No external web page, app link, or Chrome tab is opened by GPS capture.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            }
            addJavascriptInterface(DistanceBridge(), "DistanceNative")
        }
        setContentView(web, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val document = assets.open("distance-console.html").bufferedReader(Charsets.UTF_8).use { it.readText() }
        web.loadDataWithBaseURL(nativeOrigin, document, "text/html", "UTF-8", null)
    }

    inner class DistanceBridge {
        @JavascriptInterface fun startTracking() {
            runOnUiThread { startLocation() }
        }
        @JavascriptInterface fun stopTracking() {
            runOnUiThread {
                startService(Intent(this@MainActivity, GpsTrackingService::class.java)
                    .setAction(GpsTrackingService.ACTION_STOP))
            }
        }
        @JavascriptInterface fun getStatus(): String {
            val state = GpsStore.load(this@MainActivity)
            val last = GpsStore.lastGpsCallbackAt(this@MainActivity)
            val elapsed = if (last <= 0L) -1L else (System.currentTimeMillis() - last).coerceAtLeast(0L)
            return JSONObject()
                .put("running", state.running)
                .put("ageMs", if (elapsed >= 0) elapsed else JSONObject.NULL)
                .put("gaps", state.gapCount)
                .put("unresolvedGap", state.unresolvedGap)
                .toString()
        }
        @JavascriptInterface fun requestCapture(nonce: String, target: String) {
            if (!Regex("^[0-9a-f]{32}$").matches(nonce) ||
                !(target == "start" || Regex("^(0|[1-9][0-9]?)$").matches(target) &&
                    target.toInt() < 60)) return
            ui.post { capture(nonce, target) }
        }
    }

    private fun startLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ), permissionRequest)
            return
        }
        try {
            startForegroundService(
                Intent(this, GpsTrackingService::class.java).setAction(GpsTrackingService.ACTION_START)
            )
        } catch (e: RuntimeException) {
            Toast.makeText(this, "GPSを開始できません：位置情報と端末の設定を確認してください", Toast.LENGTH_LONG).show()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequest) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
                startLocation()
            else Toast.makeText(this, "正確な位置情報の許可が必要です", Toast.LENGTH_LONG).show()
        }
    }

    private fun dispatch(js: String) {
        if (::web.isInitialized) web.evaluateJavascript(js, null)
    }

    private fun reportError(nonce: String, message: String) {
        dispatch("window.DistanceLab&&window.DistanceLab.onNativeError(" +
            JSONObject.quote(nonce) + "," + JSONObject.quote(message) + ");")
    }

    private fun capture(nonce: String, target: String) {
        val state = GpsStore.load(this)
        val last = GpsStore.lastGpsCallbackAt(this)
        val now = System.currentTimeMillis()
        val age = if (last <= 0L) Long.MAX_VALUE else (now - last).coerceAtLeast(0L)
        if (!state.running) { reportError(nonce, "GPS計測が停止しています"); return }
        if (last <= 0L || age > 30000L) { reportError(nonce, "GPS受信が古い、または未測位です"); return }
        if (state.unresolvedGap) { reportError(nonce, "未解決のGPS欠測があります。車両トリップを確認してください"); return }
        if (state.lastAccuracyMeters == null || state.lastAccuracyMeters > 45.0) {
            reportError(nonce, "GPSの測位精度が不足しています")
            return
        }
        val snapshot = JSONObject()
            .put("format", "GPS_DISTANCE_LAB_V1")
            .put("nonce", nonce)
            .put("target", target)
            .put("tripKm", state.tripKm)
            .put("capturedAt", now)
            .put("gpsAgeMs", age)
            .put("running", true)
            .put("unresolvedGap", false)
        dispatch("window.DistanceLab&&window.DistanceLab.onNativeSnapshot(" +
            JSONObject.quote(snapshot.toString()) + ");")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        AlertDialog.Builder(this).setTitle("距離管理テストを閉じますか？")
            .setMessage("画面を閉じてもGPSを計測中なら通知から継続状態を確認できます。測定停止は画面の停止ボタンを使用してください。")
            .setNegativeButton("戻る", null)
            .setPositiveButton("閉じる") { _, _ -> finish() }
            .show()
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            web.removeJavascriptInterface("DistanceNative")
            web.destroy()
        }
        super.onDestroy()
    }
}

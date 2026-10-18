package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * GPS measurement Web test runs in one persistent Android WebView.
 * Clicking each Web GPS button is intercepted locally and invokes no browser app,
 * so the number of Chrome tabs cannot increase.
 *
 * Deliberately NO addJavascriptInterface: the remote Web content never receives
 * access to Android native capabilities other than the narrowly verified GPS URI
 * created by the user's own press of the Web page GPS button.
 */
class GpsTestWebActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var web: WebView
    private var alive = true
    private val trustedHost = "elpapityo.github.io"
    private val testPath = "/TAXIAPP/gps-import-test.html"
    private val scheme = "taxiappgpsv035"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(Button(this).apply {
            text = "← GPS計測画面へ戻る"
            isAllCaps = false
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val url = request.url
                    if (url.scheme == scheme && url.host == "measure") {
                        receiveGpsRequest(url)
                        return true
                    }
                    if (isTestPage(url)) return false
                    // Keep the embedded browser confined to our test page only.
                    if (url.scheme == "https") {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    }
                    return true
                }
            }
        }
        root.addView(web, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        if (savedInstanceState == null) {
            web.loadUrl("https://elpapityo.github.io/TAXIAPP/gps-import-test.html?v=035")
        } else {
            web.restoreState(savedInstanceState)
        }
    }

    private fun isTestPage(uri: Uri?): Boolean = uri?.scheme == "https" &&
        uri.host == trustedHost && uri.path == testPath

    private fun receiveGpsRequest(uri: Uri) {
        val nonce = uri.getQueryParameter("nonce") ?: ""
        val metric = uri.getQueryParameter("metric") ?: ""
        if (!Regex("^[a-f0-9]{32}$").matches(nonce) ||
            metric !in setOf("tripKm", "realKm", "emptyKm", "lastRideKm")) {
            error("GPS取得番号が不正です。再度GPSボタンを押してください")
            return
        }
        if (!isTestPage(Uri.parse(web.url ?: ""))) {
            error("GPSテストWebの表示先を確認できません")
            return
        }
        val state = GpsStore.load(this)
        if (GpsStore.updatedAt(this) <= 0L) {
            error("GPS測定を開始してから取得してください")
            return
        }
        if (metric == "lastRideKm" && state.lastRideKm == null) {
            error("直前の実車GPS値はありません")
            return
        }
        val pressedAt = System.currentTimeMillis()
        val gpsAge = GpsStore.lastGpsCallbackAt(this).let {
            if (it <= 0L) null else (pressedAt - it).coerceAtLeast(0L)
        }
        val sent = AtomicBoolean(false)
        fun complete(address: String, at: Long?) {
            if (!sent.compareAndSet(false, true) || !alive ||
                !isTestPage(Uri.parse(web.url ?: ""))) return
            val data = JSONObject()
                .put("format", "TAXIAPP_GPS_NATIVE_BRIDGE_V1")
                .put("nonce", nonce)
                .put("metric", metric)
                .put("capturedAt", pressedAt)
                .put("address", address.take(120))
                .put("locationAt", at ?: JSONObject.NULL)
                .put("tripKm", state.tripKm)
                .put("realKm", state.realKm)
                .put("emptyKm", state.emptyKm)
                .put("lastRideKm", state.lastRideKm ?: JSONObject.NULL)
                .put("gapCount", state.gapCount)
                .put("unresolvedGap", state.unresolvedGap)
                .put("running", state.running)
                .put("gpsAgeMs", gpsAge ?: JSONObject.NULL)
                .put("accuracyMeters", state.lastAccuracyMeters ?: JSONObject.NULL)
                .put("rideCount", state.completedRides)
                .put("mode", state.mode.name)
            // Updates the CURRENT WebView tab; the Web page listens to hashchange.
            val hash = "#gps-bridge=" + Uri.encode(data.toString())
            web.evaluateJavascript("window.location.hash=" + JSONObject.quote(hash) + ";", null)
        }
        // Address conversion must not freeze distance readings.
        main.postDelayed({ complete("住所未取得（取得に時間がかかりました）", null) }, 5000L)
        Thread {
            val loc = lastPosition()
            val place = loc?.let { address(it) } ?: "住所未取得（新しいGPS位置がありません）"
            main.post { complete(place, loc?.time) }
        }.start()
    }

    private fun lastPosition(): Location? {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .filter { it.time > 0L && System.currentTimeMillis() - it.time in 0L..60000L }
            .maxByOrNull { it.time }
    }

    private fun address(location: Location): String = runCatching {
        if (!Geocoder.isPresent()) return@runCatching "住所未取得（住所変換に非対応）"
        @Suppress("DEPRECATION")
        val result = Geocoder(this, Locale.JAPAN)
            .getFromLocation(location.latitude, location.longitude, 1)
        result?.firstOrNull()?.getAddressLine(0)?.trim()?.take(120)
            ?: "住所未取得（住所変換結果なし）"
    }.getOrDefault("住所未取得（住所変換に失敗）")

    private fun error(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        alive = false
        web.stopLoading()
        web.destroy()
        super.onDestroy()
    }
}

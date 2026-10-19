package jp.taxiapp.gpsprototype

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.Button
import android.widget.Toast
import android.net.Uri
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * Integrated TAXIAPP entry point. The existing HTTPS diary runs in one WebView.
 * GPS snapshots are served inside this app, without a second Android application,
 * loopback socket, Chrome tabs or pairing token.
 *
 * WebView storage is separate from Chrome. Never migrate/overwrite Chrome records.
 */
class TaxiDiaryActivity : Activity() {
    private lateinit var web: WebView
    private val origin = "https://elpapityo.github.io"
    private val home = "$origin/TAXIAPP/"
    private val bridgePath = "/TAXIAPP/native-gps"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        bar.addView(Button(this).apply {
            text = "GPS開始"
            isAllCaps = false
            setOnClickListener {
                startActivity(Intent(this@TaxiDiaryActivity, MainActivity::class.java))
                Toast.makeText(this@TaxiDiaryActivity, "GPS距離計で測定開始を押してください。測定中は日報に戻れます。", Toast.LENGTH_LONG).show()
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(Button(this).apply {
            text = "再読込"
            isAllCaps = false
            setOnClickListener { web.reload() }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(bar)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = settings.userAgentString + " TAXIAPPIntegrated/1"
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val u = request.url
                    if (u.scheme == "https" && u.host == "elpapityo.github.io" &&
                        u.path == bridgePath && request.method == "GET") {
                        val state = GpsStore.load(this@TaxiDiaryActivity)
                        val last = GpsStore.lastGpsCallbackAt(this@TaxiDiaryActivity)
                        val now = System.currentTimeMillis()
                        val data = JSONObject()
                            .put("format", "TAXIAPP_GPS_LOOPBACK_V1")
                            .put("tripKm", state.tripKm)
                            .put("running", state.running)
                            .put("gapCount", state.gapCount)
                            .put("unresolvedGap", state.unresolvedGap)
                            .put("gpsAgeMs", if (last > 0L) (now-last).coerceAtLeast(0L) else JSONObject.NULL)
                            .put("capturedAt", now)
                            .toString()
                        return WebResourceResponse("application/json", "UTF-8",
                            ByteArrayInputStream(data.toByteArray(Charsets.UTF_8))).apply {
                            responseHeaders = mapOf("Cache-Control" to "no-store")
                        }
                    }
                    return null
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url
                    if (u.scheme == "https" && u.host == "elpapityo.github.io" &&
                        u.path.orEmpty().startsWith("/TAXIAPP/")) return false
                    // Keep the diary WebView on its known HTTPS origin.
                    if (u.scheme == "https") runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, u))
                    }
                    return true
                }
            }
        }
        root.addView(web, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        if (savedInstanceState == null) web.loadUrl(home)
        else web.restoreState(savedInstanceState)
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}

package jp.taxiapp.gpsprototype

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebSettings
import android.widget.Toast

/**
 * Diary web container. WebView storage is isolated from Chrome; importing existing
 * records requires explicit export/restore and verification, never implicit migration.
 */
class DiaryActivity : Activity() {
    private lateinit var web: WebView
    private val diaryUrl = "https://elpapityo.github.io/TAXIAPP/"
    private fun trusted(uri: Uri?): Boolean = uri?.scheme == "https" &&
        uri.host == "elpapityo.github.io" &&
        (uri.path == "/TAXIAPP/" || uri.path == "/TAXIAPP/index.html")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val gpsButton = Button(this).apply {
            text = "GPS計測画面を開く"
            setOnClickListener { startActivity(Intent(this@DiaryActivity, MainActivity::class.java)) }
        }
        layout.addView(gpsButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return true
                    if (trusted(uri)) return false
                    if (uri.scheme == "https" || uri.scheme == "mailto" || uri.scheme == "tel") {
                        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        catch (_: Exception) { Toast.makeText(this@DiaryActivity, "リンクを開けません", Toast.LENGTH_SHORT).show() }
                    }
                    return true
                }
            }
        }
        layout.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(layout)
        if (savedInstanceState == null) web.loadUrl(diaryUrl) else web.restoreState(savedInstanceState)
    }
    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        super.onSaveInstanceState(outState)
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}

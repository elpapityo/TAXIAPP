package jp.taxiapp.dailyapp

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.ContentValues
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import jp.taxiapp.gpsprototype.GpsStore
import jp.taxiapp.gpsprototype.GpsTrackingService
import jp.taxiapp.gps.TripMode
import org.json.JSONObject
import java.util.concurrent.Executors

/** Offline HTTPS-origin daily UI with a native background GPS engine. */
class HomeActivity : Activity() {
    private lateinit var browser: WebView
    private var picker: ValueCallback<Array<Uri>>? = null
    private var gpsCallback: GeolocationPermissions.Callback? = null
    private var gpsOrigin: String? = null
    private var startAfterPermission = false
    private val worker = Executors.newSingleThreadExecutor()
    private val origin = "https://appassets.androidplatform.net"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        browser = WebView(this)
        setContentView(browser)
        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true // Needed only for user-selected encrypted JSON import URIs
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        browser.addJavascriptInterface(GpsJavascript(), "TAXIAPP_NATIVE_GPS")
        browser.addJavascriptInterface(FileJavascript(), "TAXIAPP_NATIVE_FILES")
        browser.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val url=request.url
                if (url.scheme == "https" && url.host == "appassets.androidplatform.net" &&
                    url.path?.startsWith("/assets/") == true) return false
                if(url.scheme == "https" && url.host != "appassets.androidplatform.net") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                }
                return true
            }
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(site: String, cb: GeolocationPermissions.Callback) {
                if (site != origin) { cb.invoke(site, false, false); return }
                if (hasGpsPermission()) cb.invoke(site, true, false)
                else {
                    gpsCallback=cb;gpsOrigin=site
                    requestGpsPermission()
                }
            }
            override fun onShowFileChooser(web: WebView, cb: ValueCallback<Array<Uri>>,
                options: FileChooserParams): Boolean {
                picker?.onReceiveValue(null)
                picker=cb
                return try {
                    val intent=Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type="*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json","text/plain","text/csv"))
                    }
                    startActivityForResult(intent,102)
                    true
                } catch (_: Exception) { picker=null; false }
            }
        }
        browser.loadUrl("$origin/assets/index.html")
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),103)
    }

    private fun hasGpsPermission()=
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED

    private fun requestGpsPermission(){
        requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION),101)
    }
    private fun beginGps() {
        if (!hasGpsPermission()) {
            startAfterPermission=true
            requestGpsPermission()
            return
        }
        try {
            startForegroundService(Intent(this, GpsTrackingService::class.java)
                .setAction(GpsTrackingService.ACTION_START))
        } catch (_: RuntimeException) {
            Toast.makeText(this,"GPSを開始できません。権限を確認してください",Toast.LENGTH_LONG).show()
        }
    }
    private fun command(action:String, distance:Double?=null) {
        try {
            if (!GpsStore.load(this).running) return
            val intent=Intent(this,GpsTrackingService::class.java).setAction(action)
            if(distance!=null) intent.putExtra("vehicleTripKm",distance)
            startService(intent)
        } catch (_: RuntimeException) {
            Toast.makeText(this,"GPSの操作に失敗しました",Toast.LENGTH_SHORT).show()
        }
    }
    inner class GpsJavascript {
        @JavascriptInterface fun snapshot():String {
            val s=GpsStore.load(this@HomeActivity)
            return JSONObject().apply {
                put("running",s.running)
                put("tripKm",s.tripKm)
                put("realKm",s.realKm)
                put("emptyKm",s.emptyKm)
                put("correctionKm",s.correctionKm)
                put("gapCount",s.gapCount)
                put("unresolvedGap",s.unresolvedGap)
                put("mode",if(s.mode==TripMode.REAL)"real" else "empty")
                put("accuracy",s.lastAccuracyMeters?:JSONObject.NULL)
                put("lastGpsAt",GpsStore.lastGpsCallbackAt(this@HomeActivity))
                put("lastRideKm",s.lastRideKm?:JSONObject.NULL)
                put("completedRides",s.completedRides)
                put("status",s.status)
            }.toString()
        }
        @JavascriptInterface fun start() { runOnUiThread { beginGps() } }
        @JavascriptInterface fun stop() {
            runOnUiThread { command(GpsTrackingService.ACTION_STOP) }
        }
        @JavascriptInterface fun mode(value:String) {
            runOnUiThread {
                when(value){
                    "real"->command(GpsTrackingService.ACTION_REAL)
                    "empty"->command(GpsTrackingService.ACTION_EMPTY)
                }
            }
        }
        @JavascriptInterface fun correct(km:Double) {
            if(km.isFinite() && km in 0.0..100000.0)
                runOnUiThread { command(GpsTrackingService.ACTION_CORRECT,km) }
        }
    }
    inner class FileJavascript {
        @JavascriptInterface fun saveText(name:String,data:String,mime:String) {
            val safe=name.replace(Regex("[/\\\\\\r\\n]"),"_").take(150)
            if(safe.isBlank()||data.length>20_000_000)return
            worker.execute {
                if(Build.VERSION.SDK_INT<29) {
                    runOnUiThread { Toast.makeText(this@HomeActivity,
                        "Android 9以前では書き出し未対応です",Toast.LENGTH_LONG).show() }
                    return@execute
                }
                try {
                    val fields=ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME,safe)
                        put(MediaStore.Downloads.MIME_TYPE,mime.substringBefore(';'))
                        put(MediaStore.Downloads.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/TAXIAPP/")
                        put(MediaStore.Downloads.IS_PENDING,1)
                    }
                    val uri=contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,fields)
                        ?: error("Downloads insert error")
                    try {
                        contentResolver.openOutputStream(uri)?.use {
                            it.write(data.toByteArray(Charsets.UTF_8))
                        } ?: error("Downloads output error")
                        contentResolver.update(uri,ContentValues().apply {
                            put(MediaStore.Downloads.IS_PENDING,0)
                        },null,null)
                    } catch(e:Exception){
                        contentResolver.delete(uri,null,null)
                        throw e
                    }
                    runOnUiThread{Toast.makeText(this@HomeActivity,
                        "Downloads/TAXIAPP に保存しました",Toast.LENGTH_LONG).show()}
                } catch (_:Exception){
                    runOnUiThread{Toast.makeText(this@HomeActivity,
                        "書き出し失敗。データは残っています",Toast.LENGTH_LONG).show()}
                }
            }
        }
    }
    override fun onRequestPermissionsResult(code:Int, permissions:Array<out String>, results:IntArray){
        super.onRequestPermissionsResult(code,permissions,results)
        if(code==101){
            val granted=hasGpsPermission()
            gpsCallback?.invoke(gpsOrigin,granted,false)
            gpsCallback=null;gpsOrigin=null
            if(startAfterPermission){
                startAfterPermission=false
                if(granted)beginGps()
            }
        }
    }
    @Deprecated("Android file chooser compatibility")
    override fun onActivityResult(code:Int,result:Int,data:Intent?){
        super.onActivityResult(code,result,data)
        if(code==102){
            picker?.onReceiveValue(if(result==RESULT_OK&&data?.data!=null)arrayOf(data.data!!) else null)
            picker=null
        }
    }
    @Deprecated("WebView navigation compatibility")
    override fun onBackPressed(){
        if(browser.canGoBack())browser.goBack() else super.onBackPressed()
    }
    override fun onDestroy(){
        browser.removeJavascriptInterface("TAXIAPP_NATIVE_GPS")
        browser.removeJavascriptInterface("TAXIAPP_NATIVE_FILES")
        browser.destroy()
        worker.shutdown()
        super.onDestroy()
    }
}

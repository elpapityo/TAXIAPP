package jp.taxiapp.gpsprototype

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.widget.Button
import android.widget.LinearLayout
import org.json.JSONObject

/** Fixed, bundled Web screen. Capturing GPS never opens Chrome or a new browser tab. */
class GpsTestWebActivity : Activity() {
    private lateinit var web: WebView
    private val ui=Handler(Looper.getMainLooper())
    private var pendingNonce: String?=null
    private var poll: Runnable?=null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            setBackgroundColor(0xFF090F1B.toInt())
        }
        root.addView(Button(this).apply {
            text="← GPS計測画面へ戻る"
            isAllCaps=false
            setOnClickListener { finish() }
        },LinearLayout.LayoutParams(-1,-2))
        web=WebView(this).apply {
            settings.javaScriptEnabled=true
            settings.domStorageEnabled=true
            settings.allowFileAccess=false
            settings.allowContentAccess=false
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically=false
            settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient=object:WebViewClient(){
                override fun shouldOverrideUrlLoading(view:WebView, request:WebResourceRequest):Boolean=true
            }
            addJavascriptInterface(DistanceBridge(),"DistanceNative")
        }
        root.addView(web,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1f))
        setContentView(root)
        val doc=assets.open("distance-console.html").bufferedReader(Charsets.UTF_8).use{it.readText()}
        web.loadDataWithBaseURL("https://appassets.androidplatform.net/distance-console.html",
            doc,"text/html","UTF-8",null)
    }

    inner class DistanceBridge {
        @JavascriptInterface fun getStatus():String {
            val s=GpsStore.load(this@GpsTestWebActivity)
            val fixAt=GpsStore.lastValidGpsFixAt(this@GpsTestWebActivity)
            val age=if(fixAt<=0L) -1L else (System.currentTimeMillis()-fixAt).coerceAtLeast(0L)
            return JSONObject()
                .put("running",s.running)
                .put("ageMs",if(age>=0L) age else JSONObject.NULL)
                .put("accuracyMeters",s.lastAccuracyMeters?:JSONObject.NULL)
                .put("gaps",s.gapCount)
                .put("unresolvedGap",s.unresolvedGap).toString()
        }
        @JavascriptInterface fun requestCapture(nonce:String,target:String) {
            if(!Regex("^[0-9a-f]{32}$").matches(nonce) ||
                !(target=="start" || target.matches(Regex("^(0|[1-9][0-9]?)$")) &&
                target.toInt()<60)) return
            ui.post { beginCapture(nonce,target) }
        }
    }

    private fun dispatch(js:String) {
        if(::web.isInitialized && !isFinishing) web.evaluateJavascript(js,null)
    }
    private fun error(nonce:String,message:String) {
        dispatch("window.DistanceLab&&window.DistanceLab.onNativeError("+
            JSONObject.quote(nonce)+","+JSONObject.quote(message)+");")
    }

    private fun beginCapture(nonce:String,target:String) {
        if(pendingNonce!=null){ error(nonce,"別のGPS取得を処理中です");return }
        pendingNonce=nonce
        val deadline=System.currentTimeMillis()+30000L
        val check=object:Runnable {
            override fun run() {
                if(pendingNonce!=nonce || isFinishing)return
                val s=GpsStore.load(this@GpsTestWebActivity)
                val now=System.currentTimeMillis()
                val last=GpsStore.lastValidGpsFixAt(this@GpsTestWebActivity)
                val age=if(last<=0L)Long.MAX_VALUE else(now-last).coerceAtLeast(0L)
                val accuracy=s.lastAccuracyMeters
                if(s.running && last>0L && age<=15000L &&
                    accuracy!=null && accuracy.isFinite() && accuracy in 0.01..45.0) {
                    pendingNonce=null;poll=null
                    val json=JSONObject()
                        .put("format","GPS_DISTANCE_LAB_V1")
                        .put("nonce",nonce)
                        .put("target",target)
                        .put("tripKm",s.tripKm)
                        .put("capturedAt",now)
                        .put("gpsAgeMs",age)
                        .put("running",true)
                        .put("unresolvedGap",s.unresolvedGap)
                    dispatch("window.DistanceLab&&window.DistanceLab.onNativeSnapshot("+
                        JSONObject.quote(json.toString())+");")
                    return
                }
                if(now>=deadline) {
                    pendingNonce=null;poll=null
                    error(nonce,if(!s.running)
                        "GPS測定が停止しています。計測画面へ戻り、GPS測定を開始してください。"
                        else "GPSを30秒間取得できませんでした。屋外で受信し、正確な位置情報を許可してください。")
                    return
                }
                ui.postDelayed(this,750L)
            }
        }
        poll=check
        ui.post(check)
    }

    override fun onDestroy() {
        poll?.let{ui.removeCallbacks(it)}
        poll=null
        pendingNonce=null
        if(::web.isInitialized){
            web.removeJavascriptInterface("DistanceNative")
            web.destroy()
        }
        super.onDestroy()
    }
}

package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import java.net.URL
import java.net.HttpURLConnection
import org.json.JSONObject
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.Locale

/** Dedicated GPS monitor. Correction input lives only on the separate Web screen. */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val requestLocation = 734
    private lateinit var distance: TextView
    private lateinit var status: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private var refresh: Runnable? = null

    private fun rounded(fill: Int, border: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = 14f * resources.displayMetrics.density
            setStroke(resources.displayMetrics.density.toInt().coerceAtLeast(1), border)
        }
    private fun label(s: String, size: Float, c: Int = Color.WHITE): TextView =
        TextView(this).apply {
            text = s
            textSize = size
            setTextColor(c)
            setPadding(10, 11, 10, 11)
        }
    private fun button(s: String, fill: Int, fg: Int): Button =
        Button(this).apply {
            text = s
            isAllCaps = false
            textSize = 16f
            setTextColor(fg)
            setTypeface(null, Typeface.BOLD)
            background = rounded(fill, 0xFF48677A.toInt())
            minimumHeight = (56 * resources.displayMetrics.density).toInt()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF090F1B.toInt())
            setPadding((18*dp).toInt(), (17*dp).toInt(), (18*dp).toInt(), (35*dp).toInt())
        }
        fun add(v: android.view.View, topDp: Int) {
            root.addView(v, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin=(topDp*dp).toInt()
            })
        }
        add(label("GPS DISTANCE LAB · v1.0 · 外部ブラウザ", 12f, 0xFF63EAD2.toInt()), 0)
        add(label("GPS距離ラボ\n計測専用", 29f), 3)
        add(label("この画面はGPS計測と受信状態の確認だけです。0kmの記録・区間距離・手入力補正は外部ブラウザで操作します。", 13f, 0xFFAFC6D3.toInt()), 8)
        val meter = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(0xFF152A3F.toInt(), 0xFF3C6478.toInt())
            setPadding((13*dp).toInt(), (14*dp).toInt(), (13*dp).toInt(), (14*dp).toInt())
        }
        meter.addView(label("GPS内部累計（Webの0km補正前）", 12f, 0xFFC1D9E5.toInt()))
        distance = label("0.000 km", 35f, 0xFF63EAD2.toInt())
        distance.setTypeface(null, Typeface.BOLD)
        meter.addView(distance)
        status = label("GPS受信状態を確認しています", 14f)
        meter.addView(status)
        add(meter, 17)
        startButton = button("▶ GPS測定を開始", 0xFF63EAD2.toInt(), 0xFF091827.toInt())
        startButton.setOnClickListener { startGps() }
        add(startButton, 15)
        stopButton = button("■ GPS測定を停止", 0xFF1A3749.toInt(), Color.WHITE)
        stopButton.setOnClickListener {
            startService(Intent(this, GpsTrackingService::class.java).setAction(GpsTrackingService.ACTION_STOP))
            handler.postDelayed({ updateStatus() }, 500)
        }
        add(stopButton, 10)
        val openWeb = button("↗ 外部ブラウザで距離テストを開く", 0xFF88C6FF.toInt(), 0xFF0A1D2D.toInt())
        openWeb.setOnClickListener {
            if(!GpsStore.load(this).running) {
                Toast.makeText(this,"先にGPS測定を開始してください",Toast.LENGTH_LONG).show()
            } else {
                openVerifiedExternalBrowser()
            }
        }
        add(openWeb, 23)
        add(label("操作：① GPS測定開始 → ② 有効GPSの受信確認 → ③ Web画面で0km記録。\n\nGPS取得時は同じブラウザタブ内で通信します。", 13f, 0xFFAFC6D3.toInt()), 12)
        val scroll=ScrollView(this)
        scroll.addView(root)
        setContentView(scroll)
        updateStatus()
    }

    /**
     * Never silently navigate into the previous version's browser on
     * 127.0.0.1:48764. The new server must prove its owning package ID and
     * UI version; old v0.8 has no /api/identity and is rejected.
     */
    private fun openVerifiedExternalBrowser() {
        Thread({
            var verified=false
            var detail=""
            var connection: HttpURLConnection?=null
            try {
                connection=(URL(GpsLoopbackServer.URL+"api/identity").openConnection() as HttpURLConnection)
                connection.connectTimeout=1800
                connection.readTimeout=1800
                connection.instanceFollowRedirects=false
                connection.setRequestProperty("Cache-Control","no-cache")
                if(connection.responseCode==200) {
                    val reply=connection.inputStream.bufferedReader().use{it.readText()}
                    val result=JSONObject(reply)
                    verified=result.optString("marker")==GpsLoopbackServer.IDENTITY_MARKER &&
                        result.optString("packageId")==applicationContext.packageName &&
                        result.optString("webVersion")=="1.0.0"
                    if(!verified)detail="別バージョンの計測画面が接続先を使用中です。"
                }else detail="旧バージョンのアプリが接続先を使用している可能性があります。"
            }catch(e:Exception){
                detail="GPSアプリのWeb接続先に到達できません。"
            }finally{connection?.disconnect()}
            runOnUiThread{
                if(isFinishing || isDestroyed)return@runOnUiThread
                if(verified) {
                    startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(GpsLoopbackServer.URL))
                        .addCategory(Intent.CATEGORY_BROWSABLE))
                } else {
                    AlertDialog.Builder(this)
                        .setTitle("外部ブラウザ接続を確認できません")
                        .setMessage(detail+"\n\n以前の「GPS距離ラボ v0.8」「v0.9」のGPS測定を停止してください。v1.0でGPS測定を開始し直してから、このボタンを押してください。\n\nChromeの履歴・保存データは消さないでください。")
                        .setPositiveButton("確認",null).show()
                }
            }
        },"gps-external-browser-owner-check").start()
    }

    private fun startGps() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION), requestLocation)
            return
        }
        try {
            startForegroundService(Intent(this, GpsTrackingService::class.java).setAction(GpsTrackingService.ACTION_START))
            handler.postDelayed({ updateStatus() }, 500)
        } catch (e: RuntimeException) {
            Toast.makeText(this, "GPSを開始できません。正確な位置情報の許可をご確認ください。", Toast.LENGTH_LONG).show()
        }
    }

    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>,
        results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code == requestLocation) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
                startGps()
            else Toast.makeText(this, "正確な位置情報の許可が必要です", Toast.LENGTH_LONG).show()
        }
    }

    private fun updateStatus() {
        if (!::distance.isInitialized) return
        val s = GpsStore.load(this)
        val fixAt = GpsStore.lastValidGpsFixAt(this)
        val age = if (fixAt <= 0L) -1L else (System.currentTimeMillis() - fixAt).coerceAtLeast(0L)/1000L
        distance.text = String.format(Locale.JAPAN, "%.3f km", s.tripKm)
        status.text = when {
            !s.running -> "■ 停止中：GPS開始ボタンを押してください"
            age < 0 -> "● GPS測位待ち：屋外で受信してください"
            age > 15 -> "⚠ GPSの有効受信が " + age + " 秒前"
            else -> "● GPS計測中 ／ 有効GPS " + age + " 秒前"
        } + "\n欠測 " + s.gapCount + " 回" +
            (if(s.unresolvedGap) " ／ ⚠ 車両トリップとの補正推奨" else "")
        startButton.text = if(s.running) "↻ GPS測定を確認・再開" else "▶ GPS測定を開始"
        val webIssue = GpsStore.browserConnectionIssue(this)
        if(s.running && webIssue.isNotEmpty()) status.text = status.text.toString() +
            "\n⚠ 外部ブラウザ接続："+webIssue
        stopButton.isEnabled = s.running
    }

    override fun onStart() {
        super.onStart()
        refresh=object: Runnable {
            override fun run() {
                updateStatus()
                handler.postDelayed(this,1600L)
            }
        }.also { handler.post(it) }
    }
    override fun onStop() {
        refresh?.let { handler.removeCallbacks(it) }
        refresh=null
        super.onStop()
    }
}

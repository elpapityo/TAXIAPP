package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.location.Location
import android.location.LocationManager
import android.location.Geocoder
import org.json.JSONObject
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.window.OnBackInvokedCallback
import java.util.concurrent.atomic.AtomicBoolean
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale

/** Diagnostic UI, intentionally NOT the operational TAXIAPP web application. */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var stats: TextView
    private lateinit var note: TextView
    private var refresh: Runnable? = null
    private val requestLocation = 31

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 22, 24, 32)
        }
        fun text(value: String, size: Float, color: Int = Color.BLACK): TextView =
            TextView(this).apply {
                this.text = value
                textSize = size
                setTextColor(color)
                setPadding(4, 9, 4, 12)
            }
        fun button(container: LinearLayout, title: String, click: () -> Unit) {
            container.addView(Button(this).apply {
                this.text = title
                textSize = 16f
                isAllCaps = false
                setOnClickListener { click() }
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            })
        }

        root.addView(text("🚕 GPS距離テスト", 23f))
        root.addView(text("ブラウザから距離を取得するためのGPS計測アプリ", 14f))
        stats = text("GPS累計 0.000 km", 30f, Color.rgb(10, 84, 139))
        root.addView(stats)
        note = text("停止中", 17f)
        root.addView(note)
        button(root, "▶ GPS測定を開始") { startTracking() }
        button(root, "■ GPS測定を停止") { command(GpsTrackingService.ACTION_STOP) }
        button(root, "🌐 GPSテストWebを開く") {
            startActivity(Intent(Intent.ACTION_VIEW,
                Uri.parse("https://elpapityo.github.io/TAXIAPP/gps-import-test.html?v=035"))
                .addCategory(Intent.CATEGORY_BROWSABLE))
        }
        button(root, "✕ アプリを終了（GPSも停止）") { exitAppCompletely() }
        root.addView(text("ホームへ戻る・画面OFF・他アプリ利用中はGPS計測を継続。\n「アプリを終了」または最近使ったアプリから閉じるとGPSも停止します。", 13f))

        button(root, "距離をゼロに戻す") {
            if (GpsStore.load(this).running) {
                alert("先にGPS測定を停止してください")
            } else {
                AlertDialog.Builder(this)
                    .setTitle("GPS距離のリセット")
                    .setMessage("このGPS試験アプリの距離を0に戻します。以前の計測値は戻せません。乗務日報や他のGPS試験アプリは変更しません。")
                    .setNegativeButton("キャンセル", null)
                    .setPositiveButton("ゼロにする") { _, _ ->
                        GpsStore.clear(this)
                        showStats()
                    }.show()
            }
        }
        // Only cumulative GPS is needed; no passenger, payment or comparison UI.
        scroll.addView(root)
        setContentView(scroll)
        // Android 13+ back gesture: closing this visible app is an explicit exit,
        // not a home/minimize transition. Browser handoff finish() is separate.
        if (Build.VERSION.SDK_INT >= 33) {
            val callback = OnBackInvokedCallback { exitAppCompletely() }
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
            exitBackCallback = callback
        }
        showStats()
        // Avoid notification-permission prompts during the one-tap browser request.
        // Notification permission is requested only when starting tracking manually.
        if (intent?.action == Intent.ACTION_VIEW) handler.post { offerBrowserDistance(intent) }
    }

    private var exitBackCallback: OnBackInvokedCallback? = null
    private var explicitExitStarted = false

    private fun exitAppCompletely() {
        if (explicitExitStarted) return
        explicitExitStarted = true
        // Do not confuse with the automatic browser callback's finish().
        runCatching {
            startService(Intent(this, GpsTrackingService::class.java)
                .setAction(GpsTrackingService.ACTION_STOP))
        }
        finishAndRemoveTask()
    }

    @Deprecated("Legacy back button before Android 13")
    override fun onBackPressed() {
        exitAppCompletely()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) {
            exitBackCallback?.let {
                onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it)
            }
        }
        super.onDestroy()
    }


    // The browser GPS button already represents explicit user intent.
    // The bridge performs the native callback automatically, without a second tap.
    private fun offerBrowserDistance(request: Intent?) {
        val data = request?.data ?: return
        if (data.scheme != "taxiappgpsv035" || data.host != "measure") {
            note.text = "GPS連携エラー：ブラウザとアプリの識別名が一致しません"
            alert("GPS連携アプリの種類が一致しません。Webの再読み込みとv0.3.5の確認をお願いします。")
            return
        }
        val nonce = data.getQueryParameter("nonce") ?: ""
        val metric = data.getQueryParameter("metric") ?: ""
        if (!Regex("^[a-f0-9]{32}$").matches(nonce) ||
            metric !in setOf("tripKm", "realKm", "emptyKm", "lastRideKm")) {
            alert("GPS受信依頼が正しくありません。ブラウザのGPSボタンからやり直してください。")
            return
        }
        val state = GpsStore.load(this)
        if (GpsStore.updatedAt(this) <= 0L) {
            alert("GPS測定データがありません。最初に「GPS測定を開始」を押してください。")
            return
        }
        if (metric == "lastRideKm" && state.lastRideKm == null) {
            alert("直前の実車距離は未測定です。")
            return
        }
        val pressedAt = System.currentTimeMillis()
        val gpsAge = GpsStore.lastGpsCallbackAt(this).let {
            if (it <= 0L) null else (pressedAt - it).coerceAtLeast(0L)
        }
        note.text = "距離・住所・時刻をブラウザへ送っています…"
        val sent = AtomicBoolean(false)
        fun complete(address: String, locationAt: Long?) {
            if (!sent.compareAndSet(false, true)) return
            runCatching {
                val reply = JSONObject()
                    .put("format", "TAXIAPP_GPS_NATIVE_BRIDGE_V1")
                    .put("nonce", nonce)
                    .put("metric", metric)
                    .put("capturedAt", pressedAt)
                    .put("address", address.take(120))
                    .put("locationAt", locationAt ?: JSONObject.NULL)
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
                // Callback is fixed to our separate, non-business test page.
                // Never accept a caller-supplied URL. Coordinates are not sent.
                val callback = "https://elpapityo.github.io/TAXIAPP/gps-import-test.html?v=035" +
                    "#gps-bridge=" + Uri.encode(reply.toString())
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(callback))
                    .addCategory(Intent.CATEGORY_BROWSABLE))
                finish()
            }.onFailure {
                alert("GPS値をブラウザへ返せませんでした：" + (it.message ?: "不明なエラー"))
            }
        }
        // Do not block returning to the browser if reverse geocoding hangs.
        handler.postDelayed({ complete("住所未取得（取得に時間がかかりました）", null) }, 5000L)
        Thread {
            val fix = freshLastLocation()
            val addr = if (fix == null) "住所未取得（新しいGPS位置がありません）"
                       else addressFromLocation(fix)
            handler.post { complete(addr, fix?.time) }
        }.start()
    }

    private fun freshLastLocation(): Location? {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            return null
        return runCatching {
            val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val fixes = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            fixes.filter { it.time > 0L && System.currentTimeMillis() - it.time in 0L..60000L }
                .maxByOrNull { it.time }
        }.getOrNull()
    }

    private fun addressFromLocation(location: Location): String {
        return runCatching {
            if (!Geocoder.isPresent()) return@runCatching "住所未取得（端末の住所変換に非対応）"
            @Suppress("DEPRECATION")
            val addresses = Geocoder(this, Locale.JAPAN)
                .getFromLocation(location.latitude, location.longitude, 1)
            val formatted = addresses?.firstOrNull()?.getAddressLine(0)?.trim().orEmpty()
            if (formatted.isBlank()) "住所未取得（住所変換結果なし）" else formatted.take(120)
        }.getOrDefault("住所未取得（住所変換に失敗）")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_VIEW) {
            handler.post { offerBrowserDistance(intent) }
        }
    }

    private fun startTracking() {
        // A location foreground service works without prompting for optional
        // Android 13 notification permission; request only location if needed.
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
            ), requestLocation)
            return
        }
        try {
            val intent = Intent(this, GpsTrackingService::class.java)
                .setAction(GpsTrackingService.ACTION_START)
            startForegroundService(intent)
        } catch (e: RuntimeException) {
            alert("GPS計測を開始できませんでした。位置情報の許可を確認してください。")
        }
    }

    private fun command(action: String) {
        if (action != GpsTrackingService.ACTION_STOP && !GpsStore.load(this).running) {
            alert("先にGPS測定を開始してください")
            return
        }
        startService(Intent(this, GpsTrackingService::class.java).setAction(action))
        handler.postDelayed({ showStats() }, 400)
    }


    private fun fmtKm(value: Double): String =
        String.format(Locale.JAPAN, "%.3f km", value)

    private fun alert(message: String) {
        AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show()
    }

    private fun showStats() {
        if (!::stats.isInitialized) return
        val state = GpsStore.load(this)
        val receivedAt = GpsStore.lastGpsCallbackAt(this)
        val ageSeconds = if (receivedAt > 0L)
            (System.currentTimeMillis() - receivedAt).coerceAtLeast(0L) / 1000
            else null
        stats.text = "GPS累計\n" + fmtKm(state.tripKm)
        val status = when {
            !state.running -> "■ 停止中"
            ageSeconds == null -> "● 計測中 ／ GPSの受信待ち"
            ageSeconds > 30L -> "⚠ 計測中 ／ GPSの受信が " + ageSeconds + " 秒前"
            else -> "● 計測中 ／ GPS受信 " + ageSeconds + " 秒前"
        }
        val warning = if (state.unresolvedGap) "\n⚠ GPS欠測あり。車両トリップと照合" else ""
        note.text = status + warning

    }

    override fun onStart() {
        super.onStart()
        refresh = object : Runnable {
            override fun run() {
                showStats()
                handler.postDelayed(this, 1500L)
            }
        }.also { handler.post(it) }
    }

    override fun onStop() {
        refresh?.let { handler.removeCallbacks(it) }
        refresh = null
        super.onStop()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == requestLocation) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                startTracking()
            } else {
                alert("走行距離の計測には「正確な位置情報」の許可が必要です。")
            }
        }
    }
}

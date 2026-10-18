package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
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
import android.view.View
import java.util.concurrent.atomic.AtomicBoolean
import android.text.InputType
import android.widget.EditText
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import jp.taxiapp.gps.TripMode
import java.util.Locale
import kotlin.math.abs

/** Diagnostic UI, intentionally NOT the operational TAXIAPP web application. */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var stats: TextView
    private lateinit var note: TextView
    private lateinit var vehicleDistance: EditText
    private lateinit var comparison: TextView
    private val checks by lazy { getSharedPreferences("gps_comparison_only", Context.MODE_PRIVATE) }
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

        button(root, "⚙ 詳細・実車計測・比較を開く") {
            val details = detailsView
            if (details != null) {
                val opening = details.visibility != View.VISIBLE
                details.visibility = if (opening) View.VISIBLE else View.GONE
                showStats()
            }
        }
        val details = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        detailsView = details
        details.addView(text("実車・空車距離の測定", 17f))
        button(details, "🚕 お客様が乗車（実車）") { command(GpsTrackingService.ACTION_REAL) }
        button(details, "✓ お客様が降車（空車）") { command(GpsTrackingService.ACTION_EMPTY) }
        extraStats = text("", 14f)
        details.addView(extraStats)
        details.addView(text("車両の実トリップとGPS距離を比較", 16f))
        vehicleDistance = EditText(this).apply {
            hint = "車両の実車区間距離 km"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setSingleLine(true)
            setText(checks.getString("actualKm", ""))
        }
        details.addView(vehicleDistance)
        button(details, "実車距離を比較") { compareRide() }
        comparison = text(checks.getString("comparison", "まだ比較していません") ?: "", 14f)
        details.addView(comparison)
        button(details, "計測結果をコピー") {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("GPS計測結果", report()))
            alert("計測結果をコピーしました")
        }
        button(details, "試験用のGPS距離をリセット") {
            if (GpsStore.load(this).running) {
                alert("先にGPS測定を停止してください")
            } else {
                AlertDialog.Builder(this)
                    .setTitle("GPS試験データを初期化")
                    .setMessage("この新しいGPS試験アプリだけの距離をゼロにします。旧GPSアプリや乗務日報は消しません。")
                    .setNegativeButton("キャンセル", null)
                    .setPositiveButton("初期化") { _, _ ->
                        GpsStore.clear(this)
                        checks.edit().clear().apply()
                        vehicleDistance.setText("")
                        comparison.text = "まだ比較していません"
                        showStats()
                    }.show()
            }
        }
        details.addView(text("※ GPS距離は参考値です。欠測や受信間隔で車両トリップと差が出ます。", 13f))
        root.addView(details)
        scroll.addView(root)
        setContentView(scroll)
        showStats()
        // Avoid notification-permission prompts during the one-tap browser request.
        // Notification permission is requested only when starting tracking manually.
        if (intent?.action == Intent.ACTION_VIEW) handler.post { offerBrowserDistance(intent) }
    }

    private var detailsView: LinearLayout? = null
    private var extraStats: TextView? = null

    // The browser GPS button already represents explicit user intent.
    // The bridge performs the native callback automatically, without a second tap.
    private fun offerBrowserDistance(request: Intent?) {
        val data = request?.data ?: return
        if (data.scheme != "taxiappgpsauto" || data.host != "measure") return
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
                val callback = "https://elpapityo.github.io/TAXIAPP/gps-import-test.html" +
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
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 32)
            // GPS foreground service can still run without notification permission.
        }
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

    private fun compareRide() {
        val actual = vehicleDistance.text.toString().trim()
            .replace(',', '.').toDoubleOrNull()
        if (actual == null || !actual.isFinite() || actual <= 0.0 || actual > 1000.0) {
            alert("車両の今回の実車距離をkmで入力してください（例：3.4）。")
            return
        }
        val state = GpsStore.load(this)
        val gps = state.lastRideKm
        if (gps == null) {
            alert("比較するため先に『乗車』→『降車』の計測を行ってください。")
            return
        }
        val delta = gps - actual
        val direction = if (delta < 0) "不足" else "超過"
        val result = String.format(
            Locale.JAPAN,
            "車両 %.3f km / GPS %.3f km\n%s %.3f km（%+.1f%%）",
            actual, gps, direction, abs(delta), delta / actual * 100.0
        )
        comparison.text = result
        checks.edit().putString("actualKm", vehicleDistance.text.toString())
            .putString("comparison", result)
            .putInt("rideCount", state.completedRides)
            .apply()
    }

    private fun report(): String {
        val s = GpsStore.load(this)
        val gpsAt = GpsStore.lastGpsCallbackAt(this)
        val seconds = if (gpsAt > 0L) (System.currentTimeMillis() - gpsAt) / 1000 else -1
        val currentRide = if (s.mode == TripMode.REAL && s.rideStartRealKm != null)
            (s.realKm - (s.rideStartRealKm ?: s.realKm)).coerceAtLeast(0.0) else 0.0
        val matched = checks.getInt("rideCount", -1) == s.completedRides
        val lines = listOf(
            "TAXIAPP GPS距離測定試験",
            "GPS累計 " + fmtKm(s.tripKm),
            "実車GPS累計 " + fmtKm(s.realKm),
            "空車GPS累計 " + fmtKm(s.emptyKm),
            "計測中の実車 " + fmtKm(currentRide),
            "直前の実車 " + (s.lastRideKm?.let { fmtKm(it) } ?: "未計測"),
            "降車完了 " + s.completedRides + "回",
            "GPS欠測 " + s.gapCount + "回",
            "未解決欠測 " + if (s.unresolvedGap) "あり" else "なし",
            "GPS受信 " + if (seconds >= 0) seconds.toString() + "秒前" else "未受信",
            "状態 " + s.status,
            "車両との差 " + if (matched) checks.getString("comparison", "未比較") else "未比較"
        )
        return lines.joinToString("\n")
    }

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
        extraStats?.text = "実車累計：" + fmtKm(state.realKm) +
            "\n空車累計：" + fmtKm(state.emptyKm) +
            "\n直前の実車：" + (state.lastRideKm?.let { fmtKm(it) } ?: "未測定") +
            "\n完了した実車：" + state.completedRides + "回" +
            "\nGPS欠測：" + state.gapCount + "回" +
            "\n推定精度：" + (state.lastAccuracyMeters?.let { String.format(Locale.JAPAN, "%.0f m", it) } ?: "未測位") +
            "\n計測状態：" + state.status
        if (::comparison.isInitialized &&
            checks.getInt("rideCount", -1) != state.completedRides) {
            comparison.text = "今回の実車距離は未比較です"
        }
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

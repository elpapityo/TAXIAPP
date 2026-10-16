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
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
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
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 32, 24, 40)
        }
        fun label(text: String, size: Float, color: Int = Color.BLACK): TextView =
            TextView(this).apply {
                setText(text)
                textSize = size
                setTextColor(color)
                setPadding(0, 6, 0, 14)
            }
        root.addView(label("TAXIAPP GPS 計測試験", 22f))
        root.addView(label(
            "業務用TAXIAPPとは完全に別の試験アプリです。日報・Google連携・本番の乗務データには触れません。",
            15f, Color.rgb(128, 52, 15)
        ))
        stats = label("", 19f)
        note = label("", 13f)
        root.addView(stats)
        root.addView(note)
        fun button(text: String, click: () -> Unit) {
            root.addView(Button(this).apply {
                this.text = text
                setOnClickListener { click() }
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                )
            })
        }
        button("GPS測定開始（画面表示中に開始）") { startTracking() }
        button("🚕 お客様乗車・実車計測開始") { command(GpsTrackingService.ACTION_REAL) }
        button("✓ お客様降車・実車距離を確定") { command(GpsTrackingService.ACTION_EMPTY) }
        button("GPS測定停止") { command(GpsTrackingService.ACTION_STOP) }
        root.addView(label("車両トリップと実車距離を比較", 18f))
        root.addView(label("降車したら、車両の『降車時トリップ − 乗車時トリップ』をkm単位で入力してください。", 14f))
        vehicleDistance = EditText(this).apply {
            hint = "今回の実車距離（例：3.4）"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setSingleLine(true)
            setText(checks.getString("actualKm", ""))
        }
        root.addView(vehicleDistance)
        button("今回の実車距離を比較") { compareRide() }
        comparison = label(checks.getString("comparison", "まだ比較していません") ?: "", 16f)
        root.addView(comparison)
        button("計測結果をコピー") {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("GPS計測結果", report()))
            alert("計測結果をコピーしました。比較結果を送る際に貼り付けてください。")
        }
        button("試験用距離をゼロに戻す（停止後のみ）") {
            if (GpsStore.load(this).running) {
                alert("先にGPS測定を停止してください")
            } else {
                AlertDialog.Builder(this)
                    .setTitle("試験用データを消去")
                    .setMessage("この試験アプリ内の距離だけをゼロにします。業務用TAXIAPPのデータは変更しません。")
                    .setNegativeButton("やめる", null)
                    .setPositiveButton("ゼロにする") { _, _ ->
                        GpsStore.clear(this)
                        checks.edit().clear().apply()
                        vehicleDistance.setText("")
                        comparison.text = "まだ比較していません"
                        showStats()
                    }
                    .show()
            }
        }
        root.addView(label(
            "車両トリップメーターと比較してください。停止区間・地下道・電池制御による欠測は補正せず、欠測回数を表示します。位置座標は永続保存しません。",
            13f
        ))
        val scroll = ScrollView(this)
        scroll.addView(root)
        setContentView(scroll)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 32)
        }
    }

    private fun startTracking() {
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
        val currentRide = if (state.mode == TripMode.REAL && state.rideStartRealKm != null)
            (state.realKm - (state.rideStartRealKm ?: state.realKm)).coerceAtLeast(0.0) else 0.0
        stats.text = "GPS累計： " + fmtKm(state.tripKm) + "\n" +
            "実車累計： " + fmtKm(state.realKm) + "\n" +
            "空車累計： " + fmtKm(state.emptyKm) + "\n" +
            "計測中の実車： " + fmtKm(currentRide) + "\n" +
            "直前の実車： " + (state.lastRideKm?.let { fmtKm(it) } ?: "未計測") + "\n" +
            "降車完了： " + state.completedRides + "回\n" +
            "GPS欠測： " + state.gapCount + "回"
        val gpsAt = GpsStore.lastGpsCallbackAt(this)
        val age = if (gpsAt > 0L) System.currentTimeMillis() - gpsAt else Long.MAX_VALUE
        val stateText = when {
            !state.running -> "停止中"
            age == Long.MAX_VALUE -> "GPS測位待ち"
            age > 30000L -> "GPS受信が30秒以上停止（要照合）"
            else -> "GPS受信 " + (age / 1000) + "秒前"
        }
        note.text = "状態： " + (if (!state.running) "停止中" else if (state.mode == TripMode.REAL) "実車" else "空車") +
            "\n" + stateText + "／精度：" +
            (state.lastAccuracyMeters?.let { it.toInt().toString() + "m" } ?: "未測位") +
            (if (state.unresolvedGap) "\n未計測区間あり（GPS距離は参考値）" else "") +
            "\n" + state.status
        if (checks.getInt("rideCount", -1) != state.completedRides) {
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

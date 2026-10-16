package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import jp.taxiapp.gps.TripMode
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
        button("実車距離へ切り替え") { command(GpsTrackingService.ACTION_REAL) }
        button("空車距離へ切り替え") { command(GpsTrackingService.ACTION_EMPTY) }
        button("GPS測定停止") { command(GpsTrackingService.ACTION_STOP) }
        button("試験用距離をゼロに戻す（停止後のみ）") {
            if (GpsStore.load(this).running) {
                alert("先にGPS測定を停止してください")
            } else {
                AlertDialog.Builder(this)
                    .setTitle("試験用データを消去")
                    .setMessage("この試験アプリ内の距離だけをゼロにします。業務用TAXIAPPのデータは変更しません。")
                    .setNegativeButton("やめる", null)
                    .setPositiveButton("ゼロにする") { _, _ -> GpsStore.clear(this); showStats() }
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

    private fun alert(message: String) {
        AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show()
    }

    private fun showStats() {
        val s = GpsStore.load(this)
        fun km(value: Double) = String.format(Locale.JAPAN, "%.1f km", value)
        stats.text = "推定トリップ： " + km(s.tripKm) + "\n" +
            "実車（GPS分）： " + km(s.realKm) + "\n" +
            "空車（GPS分）： " + km(s.emptyKm) + "\n" +
            "補正差（現在の試験版は手入力未接続）： " + km(s.correctionKm) + "\n" +
            "欠測回数： " + s.gapCount + "\n" +
            "測位精度： " + (s.lastAccuracyMeters?.let { Math.round(it).toString() + "m" } ?: "未測位")
        val stale = GpsStore.updatedAt(this).let { it > 0L && System.currentTimeMillis() - it > 75000L }
        note.text = "状態：" + if (stale && s.running) {
            "位置情報の更新が停止している可能性があります（要照合）"
        } else {
            s.status + (if (s.unresolvedGap) " / 未計測区間あり" else "") +
                " / " + if (s.mode == TripMode.REAL) "実車" else "空車"
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

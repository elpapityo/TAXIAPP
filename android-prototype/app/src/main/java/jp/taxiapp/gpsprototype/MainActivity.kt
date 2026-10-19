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
import android.view.View
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
    private lateinit var rawTotal: TextView
    private lateinit var status: TextView
    private lateinit var modeLabel: TextView
    private lateinit var simSpeedLabel: TextView
    private lateinit var meterPanel: LinearLayout
    private lateinit var zeroButton: Button
    private lateinit var simulationToggle: Button
    private lateinit var simulationPanel: LinearLayout
    private lateinit var detailToggle: Button
    private lateinit var detailPanel: LinearLayout
    private var simulationExpanded = false
    private var detailExpanded = false
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var simButton: Button
    private val speedButtons = mutableListOf<Pair<Int,Button>>()
    private var pendingSimulationPermission = false
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
        add(label("GPS DISTANCE LAB · v1.3.1 · 実GPS／模擬テスト", 12f, 0xFF63EAD2.toInt()), 0)
        add(label("GPS距離ラボ\n日報距離連携テスト", 29f), 3)
        add(label("通常は実GPS測定を使用します。模擬走行は下の折り畳み欄から操作してください。日報の距離基準・手入力補正はHTML側で別に管理します。", 13f, 0xFFC1D9E5.toInt()), 8)
        meterPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(0xFF152A3F.toInt(), 0xFF3C6478.toInt())
            setPadding((13*dp).toInt(), (14*dp).toInt(), (13*dp).toInt(), (14*dp).toInt())
        }
        modeLabel = label("○ 実GPSモード", 17f, 0xFF63EAD2.toInt())
        modeLabel.setTypeface(null, Typeface.BOLD)
        meterPanel.addView(modeLabel)
        simSpeedLabel = label("設定速度：0 km/h（模擬）", 21f, 0xFFFFD68A.toInt())
        simSpeedLabel.setTypeface(null, Typeface.BOLD)
        meterPanel.addView(simSpeedLabel)
        meterPanel.addView(label("この乗務の走行距離（画面表示）", 12f, 0xFFC1D9E5.toInt()))
        distance = label("0.000 km", 35f, 0xFF63EAD2.toInt())
        distance.setTypeface(null, Typeface.BOLD)
        meterPanel.addView(distance)
        rawTotal = label("GPS内部累計：0.000 km（HTML連携用・変更なし）", 12f, 0xFFC1D9E5.toInt())
        meterPanel.addView(rawTotal)
        status = label("GPS受信状態を確認しています", 14f)
        meterPanel.addView(status)
        add(meterPanel, 17)
        zeroButton = button("◎ この地点を0.000 kmに設定（画面表示のみ）", 0xFF247E78.toInt(), Color.WHITE)
        zeroButton.setOnClickListener {
            val snapshot = GpsStore.load(this)
            val runId = GpsStore.currentRunId(this)
            val fixAt = GpsStore.lastValidGpsFixAt(this)
            if(!snapshot.running || runId.isBlank()) {
                Toast.makeText(this, "先にGPS測定を開始してください。", Toast.LENGTH_LONG).show()
            } else if(fixAt <= 0L || System.currentTimeMillis() - fixAt > 15000L) {
                Toast.makeText(this, "新しい有効GPS地点を取得してから0kmを登録してください。", Toast.LENGTH_LONG).show()
            } else {
                val baselineKm = snapshot.tripKm
                AlertDialog.Builder(this)
                    .setTitle("この地点を0.000 kmにしますか？")
                    .setMessage("アプリの大きな距離表示だけを0kmにします。内部累計・HTML日報の距離基準・手入力補正は変更しません。")
                    .setNegativeButton("キャンセル", null)
                    .setPositiveButton("0kmに設定") { _, _ ->
                        if(GpsStore.load(this).running &&
                           GpsStore.setDisplayZero(this, runId, baselineKm)) {
                            updateStatus()
                            Toast.makeText(this, "この地点を表示上の0kmに設定しました。", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(this, "計測が切り替わりました。もう一度確認してください。", Toast.LENGTH_LONG).show()
                        }
                    }.show()
            }
        }
        add(zeroButton, 12)
        startButton = button("▶ 実GPS測定を開始", 0xFF63EAD2.toInt(), 0xFF091827.toInt())
        startButton.setOnClickListener {
            if(GpsStore.load(this).running){
                Toast.makeText(this,"測定中です。切り替える場合は先に「GPS測定を停止」を押してください。",Toast.LENGTH_LONG).show()
            } else startGps(simulation=false)
        }
        add(startButton, 15)
        simulationToggle = button("▶ 模擬走行テスト（閉じる／開く）", 0xFF6B5126.toInt(), Color.WHITE)
        simulationToggle.setOnClickListener {
            simulationExpanded = !simulationExpanded
            simulationPanel.visibility = if(simulationExpanded) View.VISIBLE else View.GONE
            updateStatus()
        }
        add(simulationToggle, 14)
        simulationPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(0xFF322817.toInt(), 0xFF9D7939.toInt())
            setPadding((10*dp).toInt(), (10*dp).toInt(), (10*dp).toInt(), (12*dp).toInt())
            visibility = View.GONE
        }
        fun addSim(v: android.view.View, topDp: Int) {
            simulationPanel.addView(v, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = (topDp*dp).toInt()
            })
        }
        simButton = button("▶ 模擬走行を開始（または速度ボタンを押す）", 0xFFFFD68A.toInt(), 0xFF091827.toInt())
        simButton.setOnClickListener {
            if(GpsStore.load(this).running) {
                Toast.makeText(this,
                    if(GpsStore.isSimulating(this)) "模擬走行中です。下の速度ボタンを押して変更できます。"
                    else "実GPS測定中です。先にGPS測定を停止してください。",
                    Toast.LENGTH_LONG).show()
            } else startGps(simulation=true)
        }
        addSim(simButton, 10)
        addSim(label("模擬速度は画面上部にも表示します。模擬0km/hで開始して画面の0km登録後、20/40/60/100km/hへ変更できます。模擬テストに位置情報の許可は不要です。",12f,0xFFFFD68A.toInt()),9)
        for (pair in listOf(listOf(0,20),listOf(40,60),listOf(100))) {
            val line=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
            for (speed in pair) {
                val b=button("模擬 ${speed}km/h",0xFF24384E.toInt(),Color.WHITE)
                b.textSize=14f
                b.setOnClickListener {
                    val current=GpsStore.load(this)
                    if(current.running && !GpsStore.isSimulating(this)){
                        Toast.makeText(this,"実GPS測定中です。停止すると模擬走行へ切り替えられます。",Toast.LENGTH_LONG).show()
                    }else if(current.running){
                        startService(Intent(this,GpsTrackingService::class.java)
                            .setAction(GpsTrackingService.ACTION_SIM_SPEED)
                            .putExtra(GpsTrackingService.EXTRA_SIM_SPEED,speed))
                        handler.postDelayed({updateStatus()},300L)
                    }else{
                        // Starting with a speed button is supported. No extra
                        // simulator-start step or precise-location permission.
                        startGps(simulation=true,initialSpeed=speed)
                    }
                }
                speedButtons.add(speed to b)
                line.addView(b,LinearLayout.LayoutParams(0,-2,1f).apply {
                    marginEnd=(5*dp).toInt()
                })
            }
            addSim(line,7)
        }
        add(simulationPanel, 7)
        stopButton = button("■ GPS測定を停止", 0xFF1A3749.toInt(), Color.WHITE)
        stopButton.setOnClickListener {
            startService(Intent(this, GpsTrackingService::class.java).setAction(GpsTrackingService.ACTION_STOP))
            handler.postDelayed({ updateStatus() }, 500)
        }
        add(stopButton, 10)
        detailToggle = button("▶ 詳細・テスト用ツール", 0xFF24384E.toInt(), Color.WHITE)
        detailToggle.setOnClickListener {
            detailExpanded = !detailExpanded
            detailPanel.visibility = if(detailExpanded) View.VISIBLE else View.GONE
            detailToggle.text = if(detailExpanded) "▼ 詳細・テスト用ツールを閉じる"
                                else "▶ 詳細・テスト用ツール"
        }
        add(detailToggle, 19)
        detailPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        fun addDetail(v: android.view.View, topDp: Int) {
            detailPanel.addView(v, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = (topDp*dp).toInt()
            })
        }
        val openWeb = button("↗ 外部ブラウザで距離テストを開く", 0xFF88C6FF.toInt(), 0xFF0A1D2D.toInt())
        openWeb.setOnClickListener {
            if(!GpsStore.load(this).running) {
                Toast.makeText(this,"先にGPS測定を開始してください",Toast.LENGTH_LONG).show()
            } else {
                openVerifiedExternalBrowser()
            }
        }
        addDetail(openWeb, 8)
        addDetail(label("これは単体検証用です。普段の日報入力は公開済みのGPS統合試験ページから行えます。\n\n模擬GPSは本番の日報に使用しないでください。", 13f, 0xFFAFC6D3.toInt()), 10)
        add(detailPanel, 4)
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
                        result.optString("webVersion")=="1.3.1"
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
                        .setMessage(detail+"\n\n別のテストアプリが同じ接続先を使用している可能性があります。模擬走行を停止してから再度開始してください。\n\nChromeの履歴・保存データは消さないでください。")
                        .setPositiveButton("確認",null).show()
                }
            }
        },"gps-external-browser-owner-check").start()
    }

    private fun startGps(simulation: Boolean = false, initialSpeed: Int = 0) {
        // Only physical GPS requires location permission. Synthetic positions
        // never read or alter the phone's actual location.
        if (!simulation && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            pendingSimulationPermission=simulation
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION), requestLocation)
            return
        }
        try {
            startForegroundService(Intent(this, GpsTrackingService::class.java)
                .setAction(if(simulation) GpsTrackingService.ACTION_SIM_START else GpsTrackingService.ACTION_START)
                .putExtra(GpsTrackingService.EXTRA_SIM_SPEED,if(simulation)initialSpeed else 0))
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
                startGps(pendingSimulationPermission)
            else Toast.makeText(this, "実GPS測定には正確な位置情報の許可が必要です。模擬走行は許可なしでも利用できます。", Toast.LENGTH_LONG).show()
        }
    }

    private fun updateStatus() {
        if (!::distance.isInitialized) return
        val s = GpsStore.load(this)
        val fixAt = GpsStore.lastValidGpsFixAt(this)
        val age = if (fixAt <= 0L) -1L else
            (System.currentTimeMillis() - fixAt).coerceAtLeast(0L)/1000L
        val sim = s.running && GpsStore.isSimulating(this)
        val speed = GpsStore.simSpeedKmh(this)
        val displayedKm = GpsStore.displayDistanceKm(this, s.tripKm)
        distance.text = String.format(Locale.JAPAN, "%.3f km", displayedKm ?: s.tripKm)
        rawTotal.text = String.format(Locale.JAPAN,
            "GPS内部累計：%.3f km（HTML連携用・変更なし）", s.tripKm)
        modeLabel.text = when {
            sim -> "◆ 模擬走行・テスト中"
            s.running -> "● 実GPS測定中"
            else -> "○ GPS計測停止中"
        }
        modeLabel.setTextColor(if(sim) 0xFFFFC46C.toInt() else 0xFF63EAD2.toInt())
        meterPanel.background = if(sim)
            rounded(0xFF322817.toInt(), 0xFFDDAA58.toInt())
        else rounded(0xFF152A3F.toInt(), 0xFF3C6478.toInt())
        simSpeedLabel.visibility = if(sim) View.VISIBLE else View.GONE
        simSpeedLabel.text = "設定速度：$speed km/h（架空の走行）"
        distance.setTextColor(if(sim) 0xFFFFD68A.toInt() else 0xFF63EAD2.toInt())
        zeroButton.isEnabled = s.running
        status.text = when {
            !s.running -> "■ 停止中：実GPSまたは模擬走行を選んでください"
            sim -> "【模擬GPS】実際の走行距離ではありません"
            age < 0 -> "● GPS測位待ち：屋外で受信してください"
            age > 15 -> "⚠ GPSの有効受信が " + age + " 秒前"
            else -> "● GPS計測中 ／ 有効GPS " + age + " 秒前"
        } + "\n" +
            (if(displayedKm == null) "表示0km基準：未設定" else "表示0km基準：設定済み") +
            " ／ 欠測 " + s.gapCount + " 回" +
            (if(s.unresolvedGap) " ／ ⚠ 車両トリップとの補正推奨" else "")
        simulationToggle.text = (if(simulationExpanded) "▼ " else "▶ ") +
            (if(sim) "模擬走行テスト（設定 $speed km/h）"
             else "模擬走行テスト（使用時のみ開く）")
        startButton.isEnabled = true
        simButton.isEnabled = true
        for ((v,b) in speedButtons) {
            b.isEnabled=true
            b.text = if(sim && v == speed) "● 模擬 $v km/h" else "模擬 $v km/h"
            b.background = rounded(
                if(sim && v == speed) 0xFFA77828.toInt() else 0xFF24384E.toInt(),
                if(sim && v == speed) 0xFFFFD68A.toInt() else 0xFF48677A.toInt()
            )
        }
        val webIssue = GpsStore.browserConnectionIssue(this)
        if(s.running && webIssue.isNotEmpty()) status.text = status.text.toString() +
            "\n⚠ 外部ブラウザ接続：" + webIssue
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

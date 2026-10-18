package jp.taxiapp.gpsprototype

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import jp.taxiapp.gps.Fix
import jp.taxiapp.gps.TripAccumulator
import jp.taxiapp.gps.TripMode
import java.util.Locale

/**
 * GPS-only experimental native Android foreground location service.
 * Keeps running while the activity is hidden (navigation/lock screen).
 * Android may still stop the process; no distance is invented across gaps.
 */
class GpsTrackingService : Service() {
    companion object {
        const val ACTION_START = "jp.taxiapp.gpsprototype.START"
        const val ACTION_STOP = "jp.taxiapp.gpsprototype.STOP"
        const val ACTION_REAL = "jp.taxiapp.gpsprototype.REAL"
        const val ACTION_EMPTY = "jp.taxiapp.gpsprototype.EMPTY"
        private const val CHANNEL = "taxiapp_native_gps_test"
        private const val NOTIFICATION_ID = 201
    }

    private val loopback by lazy { GpsLoopbackServer(this) }
    private lateinit var manager: LocationManager
    private lateinit var engine: TripAccumulator
    private var listening = false
    // GPS can stop delivering callbacks while the foreground service remains alive.
    // Re-register the provider after a prolonged silence, without inventing distance.
    private var lastCallbackElapsedMs = 0L
    private var lastRecoveryElapsedMs = 0L
    private val gpsWatchdog = object : Runnable {
        override fun run() {
            if (!engine.snapshot().running) return
            val now = SystemClock.elapsedRealtime()
            if (listening && lastCallbackElapsedMs > 0L &&
                now - lastCallbackElapsedMs > 45000L &&
                now - lastRecoveryElapsedMs > 45000L) {
                lastRecoveryElapsedMs = now
                engine.interrupted("GPS受信が45秒以上停止したため再接続しています")
                GpsStore.save(this@GpsTrackingService, engine.snapshot())
                stopListening()
                startListening()
            } else if (!listening &&
                now - lastRecoveryElapsedMs > 45000L) {
                lastRecoveryElapsedMs = now
                startListening()
            }
            mainHandler.postDelayed(this, 15000L)
        }
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingAlight = false
    private var alightRequestedAtMs = 0L
    private var alightTimeout: Runnable? = null
    private var alightCancellation: CancellationSignal? = null
    private var alightOneShot: LocationListener? = null

    // All LocationManager callbacks and service actions are serialized on
    // the main looper; a late fix cannot switch an already-completed ride.
    private fun acceptLocation(location: Location): Boolean {
        val sample = Fix(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN,
            elapsedRealtimeMs = location.elapsedRealtimeNanos / 1000000L,
            speedMetersPerSecond = if (location.hasSpeed()) location.speed.toDouble() else null
        )
        lastCallbackElapsedMs = SystemClock.elapsedRealtime()
        GpsStore.noteGpsCallback(this)
        val result = engine.ingest(sample, SystemClock.elapsedRealtime())
        GpsStore.save(this, engine.snapshot())
        updateNotification()
        return result.status in setOf("距離加算", "基準点取得", "停止中", "小移動・保留")
    }

    private fun acceptedNewAlightFix(location: Location, valid: Boolean): Boolean =
        valid && location.elapsedRealtimeNanos / 1000000L >= alightRequestedAtMs - 1000L

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val valid = acceptLocation(location)
            if (pendingAlight && acceptedNewAlightFix(location, valid)) finishAlight(true)
        }

        override fun onProviderDisabled(provider: String) {
            if (pendingAlight) finishAlight(false)
            engine.interrupted("GPSが無効になりました")
            GpsStore.save(this@GpsTrackingService, engine.snapshot())
            updateNotification()
        }
    }

    private fun clearAlightRequests() {
        pendingAlight = false
        alightTimeout?.let { mainHandler.removeCallbacks(it) }
        alightTimeout = null
        alightCancellation?.cancel()
        alightCancellation = null
        alightOneShot?.let { single ->
            runCatching { manager.removeUpdates(single) }
        }
        alightOneShot = null
    }

    private fun finishAlight(fresh: Boolean) {
        if (!pendingAlight) return
        clearAlightRequests()
        if (!engine.snapshot().running || engine.snapshot().mode != TripMode.REAL) return
        engine.switchMode(TripMode.EMPTY)
        if (!fresh) engine.interrupted("降車時のGPS未受信：車両トリップで確認してください")
        GpsStore.save(this, engine.snapshot())
        updateNotification()
    }

    private fun beginAlight() {
        if (pendingAlight || !engine.snapshot().running ||
            engine.snapshot().mode != TripMode.REAL) return
        pendingAlight = true
        alightRequestedAtMs = SystemClock.elapsedRealtime()
        alightTimeout = Runnable { finishAlight(false) }.also {
            mainHandler.postDelayed(it, 8000L)
        }
        updateNotification()
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                alightCancellation = CancellationSignal().also { signal ->
                    manager.getCurrentLocation(
                        LocationManager.GPS_PROVIDER, signal, mainExecutor
                    ) { location ->
                        if (!pendingAlight || location == null) return@getCurrentLocation
                        val valid = acceptLocation(location)
                        if (acceptedNewAlightFix(location, valid)) finishAlight(true)
                        // An older cached fix is insufficient: the continuous GPS
                        // listener may still supply a fresh fix before the timeout.
                    }
                }
            } else {
                val oneShot = object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        if (!pendingAlight) return
                        val valid = acceptLocation(location)
                        if (acceptedNewAlightFix(location, valid)) finishAlight(true)
                    }
                }
                alightOneShot = oneShot
                @Suppress("DEPRECATION")
                manager.requestSingleUpdate(
                    LocationManager.GPS_PROVIDER, oneShot, Looper.getMainLooper()
                )
            }
        } catch (_: SecurityException) {
            // The timeout completes the alighting even if GPS permission changes.
        } catch (_: IllegalArgumentException) {
            // No valid provider: do not invent the final leg.
        }
    }

    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val previous = GpsStore.load(this)
        engine = TripAccumulator(previous)
        if (previous.running) {
            // Previous process died: do not bridge its last coordinate to a new fix.
            engine.interrupted("位置情報サービスが再起動しました")
            engine.stop() // No live provider exists in this fresh process yet.
            GpsStore.save(this, engine.snapshot())
        }
        val notifications = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL, "TAXIAPP GPS試験計測", NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                clearAlightRequests()
                mainHandler.removeCallbacks(gpsWatchdog)
                stopListening()
                engine.stop()
                GpsStore.save(this, engine.snapshot())
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_REAL, ACTION_EMPTY -> {
                if (engine.snapshot().running) {
                    if (intent.action == ACTION_EMPTY) {
                        beginAlight() // Capture a current endpoint before REAL -> EMPTY.
                    } else if (!pendingAlight) {
                        engine.switchMode(TripMode.REAL)
                        GpsStore.save(this, engine.snapshot())
                        updateNotification()
                    }
                }
                return START_NOT_STICKY
            }
            ACTION_START -> {
                if (!hasPreciseLocation()) {
                    engine.interrupted("位置情報の正確な許可が必要です")
                    engine.stop()
                    GpsStore.save(this, engine.snapshot())
                    stopSelf()
                    return START_NOT_STICKY
                }
                if (!listening) {
                    engine.start()
                    // Must start while activity is visible and permissions already granted.
                    if (Build.VERSION.SDK_INT >= 29) {
                        startForeground(
                            NOTIFICATION_ID, notification(),
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification())
                    }
                    lastCallbackElapsedMs = SystemClock.elapsedRealtime()
                    lastRecoveryElapsedMs = 0L
                    startListening()
                    mainHandler.removeCallbacks(gpsWatchdog)
                    mainHandler.postDelayed(gpsWatchdog, 15000L)
                    loopback.start()
                }
            }
            else -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        return START_NOT_STICKY
    }

    private fun hasPreciseLocation(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startListening() {
        if (listening) return
        try {
            if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                engine.interrupted("端末のGPSが無効です")
            } else {
                manager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 2000L, 1f,
                    listener, Looper.getMainLooper()
                )
                listening = true
            }
        } catch (ex: SecurityException) {
            engine.interrupted("GPS権限がありません")
        } catch (ex: IllegalArgumentException) {
            engine.interrupted("GPSプロバイダーを利用できません")
        }
        GpsStore.save(this, engine.snapshot())
        updateNotification()
    }

    private fun stopListening() {
        if (listening) {
            manager.removeUpdates(listener)
            listening = false
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, GpsTrackingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val s = engine.snapshot()
        val label = if (pendingAlight) "降車GPS確認中" else if (s.mode == TripMode.REAL) "実車" else "空車"
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("TAXIAPP GPS試験版・" + label)
            .setContentText(
                String.format(Locale.JAPAN, "推定 %.1f km / 欠測 %d回", s.tripKm, s.gapCount)
            )
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(
                android.R.drawable.ic_media_pause, "計測を停止", stop
            ).build())
            .build()
    }

    private fun updateNotification() {
        if (!engine.snapshot().running) return
        val notifications = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notifications.notify(NOTIFICATION_ID, notification())
    }

    // User explicitly removes this app from Android recent tasks.
    // Unlike Home/screen-off/app switching, task removal must end GPS tracking.
    override fun onTaskRemoved(rootIntent: Intent?) {
        clearAlightRequests()
        mainHandler.removeCallbacks(gpsWatchdog)
        stopListening()
        engine.stop()
        GpsStore.save(this, engine.snapshot())
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(gpsWatchdog)
        clearAlightRequests()
        stopListening()
        // If killed without ACTION_STOP, mark an incomplete trip for inspection.
        if (engine.snapshot().running) {
            engine.interrupted("計測サービスが終了しました")
            engine.stop()
            GpsStore.save(this, engine.snapshot())
        }
        loopback.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

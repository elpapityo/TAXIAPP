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

    private lateinit var manager: LocationManager
    private lateinit var engine: TripAccumulator
    private var listening = false

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val sample = Fix(
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracy.toDouble(),
                elapsedRealtimeMs = location.elapsedRealtimeNanos / 1000000L,
                speedMetersPerSecond = if (location.hasSpeed()) location.speed.toDouble() else null
            )
            engine.ingest(sample, SystemClock.elapsedRealtime())
            GpsStore.save(this@GpsTrackingService, engine.snapshot())
            updateNotification()
        }

        override fun onProviderDisabled(provider: String) {
            engine.interrupted("GPSが無効になりました")
            GpsStore.save(this@GpsTrackingService, engine.snapshot())
            updateNotification()
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
                stopListening()
                engine.stop()
                GpsStore.save(this, engine.snapshot())
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_REAL, ACTION_EMPTY -> {
                if (engine.snapshot().running) {
                    engine.switchMode(if (intent.action == ACTION_REAL) TripMode.REAL else TripMode.EMPTY)
                    GpsStore.save(this, engine.snapshot())
                    updateNotification()
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
                    startListening()
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
        val label = if (s.mode == TripMode.REAL) "実車" else "空車"
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

    override fun onDestroy() {
        stopListening()
        // If killed without ACTION_STOP, mark an incomplete trip for inspection.
        if (engine.snapshot().running) {
            engine.interrupted("計測サービスが終了しました")
            engine.stop()
            GpsStore.save(this, engine.snapshot())
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

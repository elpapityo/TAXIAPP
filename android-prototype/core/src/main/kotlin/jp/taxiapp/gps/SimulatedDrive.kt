package jp.taxiapp.gps

import jp.taxiapp.gps.Fix

/**
 * Developer-only synthetic position feed. This never uses Android mock-location
 * settings or feeds other apps. The actual TripAccumulator is used unchanged.
 * Speed 0 means absolutely no simulated movement (no stationary GPS drift).
 */
class SimulatedDrive {
    private var lastTickMs: Long? = null
    private var meters: Double = 0.0
    var speedKmh: Int = 0
        private set

    fun setSpeed(kmh: Int) {
        require(kmh in setOf(0, 20, 40, 60)) { "模擬速度は0/20/40/60km/hのみ" }
        speedKmh = kmh
    }

    fun point(nowElapsedMs: Long): Fix {
        val previous = lastTickMs
        if (previous != null && nowElapsedMs > previous) {
            // Elapsed wall time, capped to avoid fabricating lost background time.
            val deltaMs = (nowElapsedMs - previous).coerceAtMost(5000L)
            meters += (speedKmh / 3.6) * (deltaMs / 1000.0)
        }
        lastTickMs = nowElapsedMs
        return Fix(
            latitude = 34.700000 + meters / 111195.0,
            longitude = 135.200000,
            accuracyMeters = 4.0,
            elapsedRealtimeMs = nowElapsedMs,
            speedMetersPerSecond = speedKmh / 3.6
        )
    }

    fun generatedMeters(): Double = meters
}

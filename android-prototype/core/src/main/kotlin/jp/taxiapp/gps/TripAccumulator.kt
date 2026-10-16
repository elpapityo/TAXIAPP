package jp.taxiapp.gps

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt

/** Pure calculation module: no Android dependency and no coordinates persisted. */
enum class TripMode { EMPTY, REAL }

data class Fix(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double,
    val elapsedRealtimeMs: Long,
    val speedMetersPerSecond: Double? = null
)

data class Snapshot(
    val tripKm: Double = 0.0,
    val realKm: Double = 0.0,
    val emptyKm: Double = 0.0,
    val correctionKm: Double = 0.0,
    val gapCount: Int = 0,
    val unresolvedGap: Boolean = false,
    val running: Boolean = false,
    val mode: TripMode = TripMode.EMPTY,
    val lastAccuracyMeters: Double? = null,
    val status: String = "停止中"
)

data class Measure(val deltaKm: Double, val status: String)

/**
 * GPS distance is an estimate. Interruption is recorded as a gap, not made up
 * using a straight-line shortcut or a multiplication factor.
 */
class TripAccumulator(initial: Snapshot = Snapshot()) {
    private var state = initial
    private var anchor: Fix? = null

    fun snapshot(): Snapshot = state

    fun start() {
        anchor = null
        state = state.copy(running = true, status = "GPS測位待ち")
    }

    fun stop() {
        anchor = null
        state = state.copy(running = false, status = "停止中")
    }

    fun switchMode(next: TripMode) {
        if (state.mode == next) return
        anchor = null // Avoid counting unknown motion across passenger boundaries.
        state = state.copy(mode = next, status = "乗車状態切替・再測位待ち")
    }

    fun interrupted(reason: String) {
        anchor = null
        state = state.copy(
            gapCount = state.gapCount + 1,
            unresolvedGap = true,
            status = "未計測区間：" + reason
        )
    }

    fun correctWithVehicleTrip(km: Double): Boolean {
        if (!km.isFinite() || km < 0.0 || km > 100000.0) return false
        val difference = km - state.tripKm
        anchor = null
        state = state.copy(
            tripKm = roundKm(km),
            correctionKm = roundKm(state.correctionKm + difference),
            unresolvedGap = false,
            status = "実測値で補正済み・再測位待ち"
        )
        return true
    }

    fun ingest(fix: Fix, receivedElapsedRealtimeMs: Long): Measure {
        if (!state.running) return Measure(0.0, "停止中")
        if (!fix.latitude.isFinite() || !fix.longitude.isFinite() ||
            fix.latitude !in -90.0..90.0 || fix.longitude !in -180.0..180.0 ||
            fix.accuracyMeters <= 0.0 || !fix.accuracyMeters.isFinite() ||
            fix.elapsedRealtimeMs <= 0L ||
            receivedElapsedRealtimeMs - fix.elapsedRealtimeMs !in 0L..15000L) {
            interrupted("不正または古い位置情報")
            return Measure(0.0, state.status)
        }
        if (fix.accuracyMeters > 45.0) {
            interrupted("位置精度が低い")
            return Measure(0.0, state.status)
        }
        if (fix.speedMetersPerSecond != null &&
            (!fix.speedMetersPerSecond.isFinite() || fix.speedMetersPerSecond < 0.0 ||
                fix.speedMetersPerSecond > 55.0)) {
            interrupted("位置情報の速度が異常")
            return Measure(0.0, state.status)
        }

        val previous = anchor
        if (previous == null) {
            anchor = fix
            state = state.copy(lastAccuracyMeters = fix.accuracyMeters, status = "測位中")
            return Measure(0.0, "基準点取得")
        }
        val elapsed = fix.elapsedRealtimeMs - previous.elapsedRealtimeMs
        if (elapsed <= 0L) return Measure(0.0, "重複または時刻逆行")
        if (elapsed > 60000L) {
            interrupted("60秒超のGPS欠測")
            anchor = fix
            return Measure(0.0, state.status)
        }

        val meters = metersBetween(previous, fix)
        if (meters / (elapsed / 1000.0) > 55.0) {
            interrupted("GPS位置飛び")
            anchor = fix
            return Measure(0.0, state.status)
        }
        if (fix.speedMetersPerSecond != null && fix.speedMetersPerSecond < 0.7) {
            if (meters > max(50.0, max(previous.accuracyMeters, fix.accuracyMeters) * 3.0)) {
                interrupted("停止中の大きな位置飛び")
                anchor = fix
                return Measure(0.0, state.status)
            }
            anchor = fix
            state = state.copy(lastAccuracyMeters = fix.accuracyMeters, status = "停止中の測位")
            return Measure(0.0, "停止中")
        }
        // Keep the older position anchor so a series of small valid movements
        // eventually exceeds the GPS noise floor instead of being lost.
        if (meters < max(9.0, max(previous.accuracyMeters, fix.accuracyMeters) * 0.4)) {
            state = state.copy(lastAccuracyMeters = fix.accuracyMeters, status = "測位中")
            return Measure(0.0, "小移動・保留")
        }

        val delta = roundKm(meters / 1000.0)
        anchor = fix
        state = if (state.mode == TripMode.REAL) {
            state.copy(
                tripKm = roundKm(state.tripKm + delta),
                realKm = roundKm(state.realKm + delta),
                lastAccuracyMeters = fix.accuracyMeters,
                status = "測位中"
            )
        } else {
            state.copy(
                tripKm = roundKm(state.tripKm + delta),
                emptyKm = roundKm(state.emptyKm + delta),
                lastAccuracyMeters = fix.accuracyMeters,
                status = "測位中"
            )
        }
        return Measure(delta, "距離加算")
    }

    private fun roundKm(value: Double): Double = round(value * 10000.0) / 10000.0

    private fun metersBetween(a: Fix, b: Fix): Double {
        val toRad = Math.PI / 180.0
        val p1 = a.latitude * toRad
        val p2 = b.latitude * toRad
        val dp = (b.latitude - a.latitude) * toRad
        val dl = (b.longitude - a.longitude) * toRad
        val h = sin(dp / 2.0) * sin(dp / 2.0) +
            cos(p1) * cos(p2) * sin(dl / 2.0) * sin(dl / 2.0)
        return 12742000.0 * asin(min(1.0, sqrt(max(0.0, h))))
    }
}

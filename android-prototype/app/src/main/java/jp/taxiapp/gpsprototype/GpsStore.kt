package jp.taxiapp.gpsprototype

import android.content.Context
import jp.taxiapp.gps.Snapshot
import jp.taxiapp.gps.TripMode

/** Private, device-only prototype store. No coordinates and no TAXIAPP web data. */
object GpsStore {
    private const val FILE = "gps_prototype_local_state"
    private fun prefs(context: Context) =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun load(context: Context): Snapshot {
        val p = prefs(context)
        val mode = runCatching {
            TripMode.valueOf(p.getString("mode", TripMode.EMPTY.name) ?: TripMode.EMPTY.name)
        }.getOrDefault(TripMode.EMPTY)
        fun km(key: String) = p.getString(key, "0")?.toDoubleOrNull() ?: 0.0
        return Snapshot(
            tripKm = km("trip"),
            realKm = km("real"),
            emptyKm = km("empty"),
            correctionKm = km("correction"),
            gapCount = p.getInt("gaps", 0),
            unresolvedGap = p.getBoolean("unresolvedGap", false),
            running = p.getBoolean("running", false),
            mode = mode,
            lastAccuracyMeters = p.getString("accuracy", null)?.toDoubleOrNull(),
            status = p.getString("status", "停止中") ?: "停止中",
            rideStartRealKm = p.getString("rideStartReal", null)?.toDoubleOrNull(),
            lastRideKm = p.getString("lastRide", null)?.toDoubleOrNull(),
            completedRides = p.getInt("completedRides", 0)
        )
    }

    fun save(context: Context, state: Snapshot) {
        prefs(context).edit()
            .putString("trip", state.tripKm.toString())
            .putString("real", state.realKm.toString())
            .putString("empty", state.emptyKm.toString())
            .putString("correction", state.correctionKm.toString())
            .putInt("gaps", state.gapCount)
            .putBoolean("unresolvedGap", state.unresolvedGap)
            .putBoolean("running", state.running)
            .putString("mode", state.mode.name)
            .putString("accuracy", state.lastAccuracyMeters?.toString())
            .putString("status", state.status)
            .putString("rideStartReal", state.rideStartRealKm?.toString())
            .putString("lastRide", state.lastRideKm?.toString())
            .putInt("completedRides", state.completedRides)
            .putLong("updatedAt", System.currentTimeMillis())
            .apply()
    }

    /**
     * Browser port conflicts are not GPS gaps. Keep the error separate from
     * the raw distance and make it observable on the native monitor.
     */
    fun setBrowserConnectionIssue(context: Context, detail: String) {
        prefs(context).edit().putString("browserIssue",detail).apply()
    }
    fun browserConnectionIssue(context: Context): String =
        prefs(context).getString("browserIssue","") ?: ""

    /**
     * UI-only zero point for the current measurement run.
     * It never mutates the native cumulative GPS trip or the HTTP API,
     * so the diary's independent manual corrections remain authoritative.
     */
    fun setDisplayZero(context: Context, runId: String, rawTripKm: Double): Boolean {
        if (runId.isBlank() || currentRunId(context) != runId ||
            !rawTripKm.isFinite() || rawTripKm < 0.0) return false
        return prefs(context).edit()
            .putString("displayZeroRunId", runId)
            .putString("displayZeroRawKm", rawTripKm.toString())
            .commit()
    }

    fun displayDistanceKm(context: Context, rawTripKm: Double): Double? {
        val p = prefs(context)
        val runId = currentRunId(context)
        if (runId.isBlank() || p.getString("displayZeroRunId", "") != runId) return null
        val base = p.getString("displayZeroRawKm", null)?.toDoubleOrNull() ?: return null
        if (!rawTripKm.isFinite() || !base.isFinite() ||
            rawTripKm < 0.0 || base < 0.0 || rawTripKm + 0.00001 < base) return null
        return (rawTripKm - base).coerceAtLeast(0.0)
    }

    fun clear(context: Context) { prefs(context).edit().clear().apply() }
    fun noteGpsCallback(context: Context) {
        prefs(context).edit().putLong("lastGpsCallbackAt", System.currentTimeMillis()).apply()
    }

    /** Last accepted accurate GPS fix, never an invalid jump or stale callback. */
    fun noteValidFix(context: Context) {
        prefs(context).edit().putLong("lastValidGpsFixAt", System.currentTimeMillis()).apply()
    }

    /** A new service start requires a fresh fix, never the previous journey. */
    fun clearValidFix(context: Context) {
        prefs(context).edit().remove("lastValidGpsFixAt").apply()
    }

    /** Identifies one Android GPS measurement run so a previous browser 0km
     * baseline cannot silently be used with a restarted native odometer. */
    fun startNewRun(context: Context) {
        prefs(context).edit()
            .putString("currentRunId", java.util.UUID.randomUUID().toString())
            .remove("displayZeroRunId")
            .remove("displayZeroRawKm")
            .commit()
    }
    fun currentRunId(context: Context): String =
        prefs(context).getString("currentRunId","") ?: ""

    /** Simulation settings are private to the separate v1.2 APK. */
    fun setSimulation(context: Context,enabled: Boolean,speedKmh: Int) {
        prefs(context).edit()
            .putBoolean("simulated",enabled).putInt("simSpeedKmh",speedKmh).apply()
    }
    fun isSimulating(context: Context): Boolean =
        prefs(context).getBoolean("simulated",false)
    fun simSpeedKmh(context: Context): Int =
        prefs(context).getInt("simSpeedKmh",0)

    fun lastValidGpsFixAt(context: Context) =
        prefs(context).getLong("lastValidGpsFixAt", 0L)

    fun lastGpsCallbackAt(context: Context) =
        prefs(context).getLong("lastGpsCallbackAt", 0L)

    fun updatedAt(context: Context) = prefs(context).getLong("updatedAt", 0)
}

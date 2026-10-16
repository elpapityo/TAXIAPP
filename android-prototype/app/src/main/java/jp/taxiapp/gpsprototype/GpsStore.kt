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

    fun clear(context: Context) { prefs(context).edit().clear().apply() }
    fun updatedAt(context: Context) = prefs(context).getLong("updatedAt", 0)
}

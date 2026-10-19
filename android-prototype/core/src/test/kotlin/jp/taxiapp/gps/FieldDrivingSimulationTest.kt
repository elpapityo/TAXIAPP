package jp.taxiapp.gps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Field-style replay audit against the exact TripAccumulator included in
 * public GPS Distance Lab v1.1.0. No user trip data or phone required.
 *
 * 1 degree latitude near Japan ~ 111,195 m.
 */
class FieldDrivingSimulationTest {
    private fun fix(offsetMeters: Double, atMs: Long, speed: Double? = 10.0, accuracy: Double = 4.0): Fix =
        Fix(34.70 + offsetMeters / 111195.0, 135.20, accuracy, atMs, speed)

    @Test fun stationary30secondsMustRemainZero() {
        val t = TripAccumulator()
        t.start()
        for (i in 0..15) t.ingest(fix(0.0, 100000L + i * 2000, 0.0), 100000L + i * 2000)
        assertEquals(0.0, t.snapshot().tripKm)
        assertEquals(0, t.snapshot().gapCount)
    }

    @Test fun normalDriving500MetersIn50Seconds() {
        val t = TripAccumulator()
        t.start()
        for (i in 0..10) {
            val time = 100000L + i * 5000L
            t.ingest(fix(i * 50.0, time, 10.0), time)
        }
        assertTrue(t.snapshot().tripKm in 0.49..0.51,
            "500m valid moving fixes must be about 0.5km, got ${t.snapshot().tripKm}")
    }

    @Test fun movingToStoppedLast400MetersCounted() {
        val t = TripAccumulator()
        t.start()
        t.ingest(fix(0.0, 100000L, 12.0), 100000L)
        t.ingest(fix(400.0, 135000L, 0.0), 135000L)
        assertTrue(t.snapshot().tripKm in 0.39..0.41,
            "400m last leg must not vanish, got ${t.snapshot().tripKm}")
    }

    @Test fun missingGpsFor70SecondsCannotBeInvented() {
        val t = TripAccumulator()
        t.start()
        t.ingest(fix(0.0, 100000L, 10.0), 100000L)
        t.ingest(fix(250.0, 170000L, 10.0), 170000L)
        assertEquals(0.0, t.snapshot().tripKm)
        assertTrue(t.snapshot().unresolvedGap)
    }

    @Test fun slowCreep60MetersMustNotDisappear() {
        val t = TripAccumulator()
        t.start()
        for (i in 0..6) {
            val time = 100000L + i * 20000L
            t.ingest(fix(i * 10.0, time, 0.5), time)
        }
        assertTrue(t.snapshot().tripKm in 0.047..0.074,
            "slow taxi queue movement 60m was not counted: ${t.snapshot().tripKm}km")
    }

    @Test fun stationaryGpsNoiseUnder5MetersMustNotInventTrip() {
        val t = TripAccumulator()
        t.start()
        listOf(0.0, 2.0, -3.0, 4.0, -1.0, 3.0).forEachIndexed { i, meters ->
            val time = 100000L + i * 5000L
            t.ingest(fix(meters, time, 0.0, accuracy=4.0), time)
        }
        assertEquals(0.0, t.snapshot().tripKm)
    }

    @Test fun simulatedGpsZeroSpeedButVehicleMoved80Meters() {
        val t = TripAccumulator()
        t.start()
        t.ingest(fix(0.0, 100000L, 0.0), 100000L)
        t.ingest(fix(40.0, 110000L, 0.0), 110000L)
        t.ingest(fix(80.0, 120000L, 0.0), 120000L)
        assertTrue(t.snapshot().tripKm >= 0.06,
            "consistent coordinates moved 80m but GPS speed read 0: ${t.snapshot().tripKm}km")
    }
}

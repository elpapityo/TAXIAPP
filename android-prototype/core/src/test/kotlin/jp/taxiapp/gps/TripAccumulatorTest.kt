package jp.taxiapp.gps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TripAccumulatorTest {
    private fun fix(lat: Double, time: Long, speed: Double? = 10.0, accuracy: Double = 5.0) =
        Fix(lat, 135.0, accuracy, time, speed)

    @Test fun continuousTravelMeasuresAboutTenKilometres() {
        val meter = TripAccumulator()
        meter.start()
        val origin = 100000L
        for (i in 0..100) {
            val sample = fix(35.0 + i * 0.0009, origin + i * 10000L)
            meter.ingest(sample, sample.elapsedRealtimeMs)
        }
        // 0.0009 degrees latitude = roughly 100 m, 100 intervals = roughly 10 km.
        assertTrue(meter.snapshot().tripKm in 9.85..10.2)
        assertEquals(0, meter.snapshot().gapCount)
    }

    @Test fun foregroundServiceSequenceHasNoVisibilityEventGap() {
        val meter = TripAccumulator()
        meter.start()
        meter.ingest(fix(35.0, 100000L), 100000L)
        // No visibility state is ever provided to the native accumulation engine.
        meter.ingest(fix(35.0009, 110000L), 110000L)
        meter.ingest(fix(35.0018, 120000L), 120000L)
        assertTrue(meter.snapshot().tripKm in 0.19..0.22)
    }

    @Test fun doNotInventDistanceOverMissingMinute() {
        val meter = TripAccumulator()
        meter.start()
        meter.ingest(fix(35.0, 100000L), 100000L)
        val result = meter.ingest(fix(35.015, 200000L), 200000L)
        assertEquals(0.0, result.deltaKm)
        assertEquals(1, meter.snapshot().gapCount)
        assertTrue(meter.snapshot().unresolvedGap)
    }

    @Test fun realAndEmptyAreSeparated() {
        val meter = TripAccumulator()
        meter.start()
        meter.ingest(fix(35.0, 100000L), 100000L)
        meter.ingest(fix(35.0009, 110000L), 110000L)
        meter.switchMode(TripMode.REAL)
        meter.ingest(fix(35.0009, 120000L), 120000L)
        meter.ingest(fix(35.0018, 130000L), 130000L)
        assertTrue(meter.snapshot().emptyKm in 0.09..0.11)
        assertTrue(meter.snapshot().realKm in 0.09..0.11)
    }

    @Test fun correctionResetsAnchorAndRemembersDifference() {
        val meter = TripAccumulator()
        meter.start()
        meter.ingest(fix(35.0, 100000L), 100000L)
        meter.ingest(fix(35.0009, 110000L), 110000L)
        assertTrue(meter.correctWithVehicleTrip(2.5))
        assertEquals(2.5, meter.snapshot().tripKm)
        assertEquals(0.0, meter.ingest(fix(35.0018, 120000L), 120000L).deltaKm)
        meter.ingest(fix(35.0027, 130000L), 130000L)
        assertTrue(meter.snapshot().tripKm in 2.59..2.61)
        assertTrue(meter.snapshot().correctionKm > 2.0)
    }

    @Test fun stationaryDriftAndPoorPrecisionDoNotAddDistance() {
        val meter = TripAccumulator()
        meter.start()
        meter.ingest(fix(35.0, 100000L, 0.0), 100000L)
        meter.ingest(fix(35.0002, 110000L, 0.0), 110000L)
        assertEquals(0.0, meter.snapshot().tripKm)
        meter.ingest(fix(35.0003, 120000L, accuracy = 120.0), 120000L)
        assertEquals(0.0, meter.snapshot().tripKm)
        assertTrue(meter.snapshot().unresolvedGap)
    }

    @Test fun invalidOrNegativeCorrectionsAreRejected() {
        val meter = TripAccumulator()
        assertFalse(meter.correctWithVehicleTrip(-1.0))
        assertFalse(meter.correctWithVehicleTrip(Double.NaN))
    }
}

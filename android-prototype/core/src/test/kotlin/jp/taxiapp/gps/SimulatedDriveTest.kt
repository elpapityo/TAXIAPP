package jp.taxiapp.gps

import jp.taxiapp.gps.TripAccumulator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SimulatedDriveTest {
    @Test fun parkingDoesNotDrift() {
        val source=SimulatedDrive()
        val trip=TripAccumulator()
        trip.start()
        for(i in 0..30) {
            val t=100000L+i*2000L
            trip.ingest(source.point(t),t)
        }
        assertEquals(0,source.speedKmh)
        assertEquals(0.0,source.generatedMeters())
        assertEquals(0.0,trip.snapshot().tripKm)
    }
    @Test fun speed40GeneratesRealDistanceUsingTripAccumulator() {
        val source=SimulatedDrive()
        val trip=TripAccumulator()
        trip.start()
        trip.ingest(source.point(100000L),100000L)
        source.setSpeed(40)
        for(i in 1..18){
            val t=100000L+i*2000L
            trip.ingest(source.point(t),t)
        }
        assertTrue(source.generatedMeters() in 395.0..405.0)
        assertTrue(trip.snapshot().tripKm in 0.39..0.41)
        assertEquals(0,trip.snapshot().gapCount)
    }
    @Test fun speed100GeneratesOneKmIn36SecondsThenStops() {
        val source = SimulatedDrive()
        val trip = TripAccumulator()
        trip.start()
        trip.ingest(source.point(100000L),100000L)
        source.setSpeed(100)
        for (i in 1..18) {
            val t = 100000L + i * 2000L
            trip.ingest(source.point(t),t)
        }
        assertTrue(source.generatedMeters() in 999.0..1001.0)
        assertTrue(trip.snapshot().tripKm in 0.98..1.02)
        assertEquals(0,trip.snapshot().gapCount)
        source.setSpeed(0)
        val stopDistance = trip.snapshot().tripKm
        for (i in 19..25) {
            val t = 100000L + i * 2000L
            trip.ingest(source.point(t),t)
        }
        assertEquals(stopDistance,trip.snapshot().tripKm)
    }
    @Test fun speed0StopsImmediatelyWithoutCountingGpsNoise() {
        val source=SimulatedDrive()
        val trip=TripAccumulator()
        trip.start()
        trip.ingest(source.point(100000L),100000L)
        source.setSpeed(20)
        for(i in 1..20) {
            val t=100000L+i*2000L
            trip.ingest(source.point(t),t)
        }
        source.setSpeed(0)
        val stopped=trip.snapshot().tripKm
        for(i in 21..50) {
            val t=100000L+i*2000L
            trip.ingest(source.point(t),t)
        }
        assertEquals(stopped,trip.snapshot().tripKm)
    }
    @Test fun largeGapsDoNotInventTravel() {
        val source=SimulatedDrive()
        val trip=TripAccumulator()
        trip.start()
        trip.ingest(source.point(100000L),100000L)
        source.setSpeed(60)
        val next=source.point(170000L)
        // generator caps time at 5s; accumulator rejects 60s+ gaps
        trip.ingest(next,170000L)
        assertTrue(source.generatedMeters() < 100.0)
        assertEquals(0.0,trip.snapshot().tripKm)
        assertTrue(trip.snapshot().unresolvedGap)
    }
    @Test fun invalidSpeedRejected() {
        val source=SimulatedDrive()
        var thrown=false
        try{ source.setSpeed(5) }catch(_:IllegalArgumentException){ thrown=true }
        assertTrue(thrown)
    }
}

package fr.bmbed.equilibre.connect

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class SessionMotionTest {
    private val start=Instant.parse("2026-01-12T10:00:00Z")
    private val end=start.plusSeconds(1500)
    private fun distance(id: String="d",source: String="urevo",a: Instant=start,b: Instant=end,meters: Double=1666.6666666667,modified: Instant=end)=DistanceInterval(id,source,a,b,meters,modified)
    private fun point(id: String="s",source: String="urevo",time: Instant=start,kmh: Double=4.0,modified: Instant=end)=SpeedPoint(id,source,time,kmh,modified)
    private fun result(distances: List<DistanceInterval> = emptyList(),speeds: List<SpeedPoint> = emptyList())=SessionMotion.summarize("urevo",start,end,distances,speeds)

    @Test fun distanceUsesOnlyTheSameSourceAndFullSession() {
        assertEquals(1666.6666666667,result(listOf(distance(),distance(source="fit",meters=9000.0))).distanceMeters!!,0.001)
        assertNull(result(listOf(distance(b=start.plusSeconds(600)))).distanceMeters)
        assertNull(result(listOf(distance(a=start.minusSeconds(3600),b=end.plusSeconds(3600)))).distanceMeters)
    }
    @Test fun distanceCorrectionsAndAdjacentSegmentsAreCountedOnce() {
        val mid=start.plusSeconds(750)
        val rows=listOf(distance("old",b=mid,meters=1000.0),distance("new",b=mid,meters=800.0,modified=end.plusSeconds(1)),distance("last",a=mid,meters=900.0))
        assertEquals(1700.0,result(rows).distanceMeters!!,0.001)
        assertEquals(result(rows),result(rows.reversed()))
    }
    @Test fun gapsAreNotAssumedToBeStationary() {
        assertNull(result(listOf(distance(b=start.plusSeconds(700)),distance("last",a=start.plusSeconds(750)))).distanceMeters)
    }
    @Test fun zeroIsDistinctFromMissingAndInvalid() {
        assertEquals(0.0,result(listOf(distance(meters=0.0))).distanceMeters!!,0.0)
        assertNull(result().distanceMeters)
        assertNull(result(listOf(distance(meters=Double.NaN))).distanceMeters)
        assertNull(result(listOf(distance(meters=-1.0))).distanceMeters)
    }
    @Test fun speedUsesOnlySamplesInTheSessionAndSameSource() {
        val r=result(speeds=listOf(point(kmh=3.0),point(time=start.plusSeconds(600),kmh=5.0),point(source="fit",kmh=100.0),point(time=start.minusSeconds(1),kmh=100.0),point(time=end,kmh=100.0)))
        assertEquals(4.0,r.speedKmh!!,0.0);assertEquals(2,r.speedSamples)
    }
    @Test fun duplicateSpeedTimestampsUseLatestCorrectionWithoutDroppingZero() {
        val rows=listOf(point("old",kmh=9.0),point("new",kmh=0.0,modified=end.plusSeconds(1)),point("last",time=start.plusSeconds(600),kmh=4.0))
        assertEquals(2.0,result(speeds=rows).speedKmh!!,0.0);assertEquals(2,result(speeds=rows).speedSamples)
        assertEquals(result(speeds=rows),result(speeds=rows.reversed()))
    }
    @Test fun absentOrInvalidSpeedStaysUnknown() {
        val r=result(speeds=listOf(point(kmh=Double.NaN),point(kmh=-1.0),point(kmh=1001.0)))
        assertNull(r.speedKmh);assertEquals(0,r.speedSamples)
    }
}

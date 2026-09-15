package fr.bmbed.equilibre.connect

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class EnergyIntervalsTest {
    private val start=Instant.parse("2026-01-01T00:00:00Z")
    @Test fun sessionTotalRequiresCoverageAndRejectsDailyProrating() {
        val end=start.plusSeconds(1800)
        assertEquals(150.0,EnergyIntervals.sessionTotal(start,end,listOf(EnergyInterval(start,end,150.0,start)))!!,0.01)
        assertNull(EnergyIntervals.sessionTotal(start,end,listOf(EnergyInterval(start,end.minusSeconds(60),150.0,start))))
        assertNull(EnergyIntervals.sessionTotal(start,end,listOf(EnergyInterval(start,start.plusSeconds(86400),2400.0,start))))
    }
    @Test fun missingIsUnknown() { val b=EnergyIntervals.bin(start,start.plusSeconds(3600),emptyList());assertNull(b.total);assertEquals(0.0,b.covered,0.01) }
    @Test fun correctionsDoNotDoubleCount() {
        val first=EnergyInterval(start,start.plusSeconds(3600),100.0,start)
        val correction=first.copy(kcal=120.0,modified=start.plusSeconds(10))
        val b=EnergyIntervals.bin(start,start.plusSeconds(3600),listOf(first,correction))
        assertEquals(120.0,b.total!!,0.01);assertEquals(3600.0,b.covered,0.01)
    }
    @Test fun gapsRemainVisible() {
        val b=EnergyIntervals.bin(start,start.plusSeconds(3600),listOf(EnergyInterval(start,start.plusSeconds(1800),50.0,start)))
        assertEquals(50.0,b.total!!,0.01);assertEquals(1800.0,b.covered,0.01)
    }
    @Test fun longTotalsRetainTheirGranularity() {
        val b=EnergyIntervals.bin(start,start.plusSeconds(3600),listOf(EnergyInterval(start,start.plusSeconds(86400),2400.0,start)))
        assertEquals(100.0,b.total!!,0.01);assertEquals(86400.0,b.maxRecordSeconds,0.01)
    }
    @Test fun newerFineRecordCannotHideCoarseContributor() {
        val coarse=EnergyInterval(start,start.plusSeconds(86400),2400.0,start)
        val fine=EnergyInterval(start,start.plusSeconds(3600),120.0,start.plusSeconds(60))
        val b=EnergyIntervals.coverage(start,start.plusSeconds(3600),listOf(coarse,fine))
        assertEquals(86400.0,b.maxRecordSeconds,0.01);assertEquals(3600.0,b.covered,0.01)
    }
}

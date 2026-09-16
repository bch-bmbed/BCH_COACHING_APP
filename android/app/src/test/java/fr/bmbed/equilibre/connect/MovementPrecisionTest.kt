package fr.bmbed.equilibre.connect

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class MovementPrecisionTest {
    private val start=Instant.parse("2026-01-01T00:00:00Z")
    @Test fun dailyTotalsCannotLookLikeMinuteMeasurements() {
        val fine=StepInterval(start,start.plusSeconds(60),"watch",80)
        val daily=StepInterval(start,start.plusSeconds(86400),"phone",6000)
        assertEquals(86400.0,MovementPrecision.seconds(start,start.plusSeconds(60),setOf("watch","phone"),listOf(fine,daily)),0.01)
        assertEquals(60.0,MovementPrecision.seconds(start,start.plusSeconds(60),setOf("watch"),listOf(fine,daily)),0.01)
    }
    @Test fun absentAndZeroStepRecordsCannotProvidePrecision() {
        val zero=StepInterval(start,start.plusSeconds(60),"watch",0)
        assertEquals(604800.0,MovementPrecision.seconds(start,start.plusSeconds(60),setOf("watch"),listOf(zero)),0.01)
    }
    @Test fun wholeWorkoutEnergyCannotBeAssignedToEveryMinute() {
        val record=EnergyInterval(start,start.plusSeconds(1800),150.0,start,"watch")
        assertNull(EnergyIntervals.sessionTotalForSource("watch",start,start.plusSeconds(60),listOf(record)))
        val fine=record.copy(end=start.plusSeconds(60),kcal=5.0)
        assertEquals(5.0,EnergyIntervals.sessionTotalForSource("watch",start,start.plusSeconds(60),listOf(fine))!!,0.01)
    }
}

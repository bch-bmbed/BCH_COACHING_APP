package fr.bmbed.equilibre.connect

import java.time.Instant
import java.time.Duration

data class StepInterval(val start: Instant,val end: Instant,val source: String,val count: Long)
object MovementPrecision {
    // A coarse contributor must never be made precise by dividing its total into minutes.
    fun seconds(start: Instant,end: Instant,sources: Set<String>,records: List<StepInterval>): Double =
        records.filter { it.count>0&&it.source in sources&&it.start<end&&it.end>start }
            .maxOfOrNull { Duration.between(it.start,it.end).toMillis()/1000.0 }?.coerceAtMost(604800.0) ?: 604800.0
}

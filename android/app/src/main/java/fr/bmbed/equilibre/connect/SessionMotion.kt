package fr.bmbed.equilibre.connect

import java.time.Instant

data class DistanceInterval(val id: String,val source: String,val start: Instant,val end: Instant,val meters: Double,val modified: Instant)
data class SpeedPoint(val id: String,val source: String,val time: Instant,val kmh: Double,val modified: Instant)
data class MotionSummary(val distanceMeters: Double?,val speedKmh: Double?,val speedSamples: Int)

object SessionMotion {
    fun summarize(source: String,start: Instant,end: Instant,distances: List<DistanceInterval>,speeds: List<SpeedPoint>): MotionSummary {
        val duration=(end.toEpochMilli()-start.toEpochMilli()).toDouble()
        if(duration<=0)return MotionSummary(null,null,0)
        // Never spread a daily distance across a workout or mix another app's records.
        val rows=distances.filter { it.source==source&&it.end>it.start&&it.start>=start.minusMillis(1000)&&it.end<=end.plusMillis(1000)&&it.meters.isFinite()&&it.meters>=0 }
        val boundaries=(listOf(start,end)+rows.flatMap { listOf(maxOf(start,it.start),minOf(end,it.end)) }).filter { it>=start&&it<=end }.distinct().sorted()
        var meters=0.0;var covered=0.0
        for((a,b) in boundaries.zipWithNext()) {
            val record=rows.filter { it.start<=a&&it.end>=b }.maxWithOrNull(compareBy<DistanceInterval> { it.modified }.thenBy { it.id }) ?: continue
            val span=(b.toEpochMilli()-a.toEpochMilli()).toDouble()
            meters+=record.meters*span/(record.end.toEpochMilli()-record.start.toEpochMilli());covered+=span
        }
        // A mean of available samples is not a time-weighted mean over the whole workout.
        val points=speeds.filter { it.source==source&&it.time>=start&&it.time<end&&it.kmh.isFinite()&&it.kmh>=0&&it.kmh<=1000 }
            .groupBy { it.time }.values.map { it.maxWith(compareBy<SpeedPoint> { p->p.modified }.thenBy { p->p.id }) }
        return MotionSummary(if(covered>0&&covered>=duration-1000&&meters<=1000000)meters else null,if(points.isEmpty())null else points.map { it.kmh }.average(),points.size)
    }
}

package fr.bmbed.equilibre.connect

import java.time.Instant

data class EnergyInterval(val start: Instant, val end: Instant, val kcal: Double, val modified: Instant,val source: String="")
data class EnergyBin(val start: Instant, val end: Instant, val total: Double?, val covered: Double, val maxRecordSeconds: Double)
object EnergyIntervals {
    fun sessionTotalForSource(source: String,start: Instant,end: Instant,records: List<EnergyInterval>): Double? = sessionTotal(start,end,records.filter { it.source==source })
    fun sessionTotal(start: Instant,end: Instant,records: List<EnergyInterval>): Double? {
        val seconds=(end.toEpochMilli()-start.toEpochMilli())/1000.0
        if(seconds<=0)return null
        // A daily total spread across hours cannot substitute for a session total.
        val candidates=records.filter { (it.end.toEpochMilli()-it.start.toEpochMilli())/1000.0<=seconds*1.2 }
        val result=bin(start,end,candidates)
        return if(result.covered>=seconds-1)result.total else null
    }
    fun coverage(start: Instant,end: Instant,records: List<EnergyInterval>): EnergyBin {
        val relevant=records.filter { it.start<end&&it.end>start&&it.end>it.start }
        // Aggregation may use a different source priority from lastModifiedTime.
        // Never report finer precision than a contributing raw record supports.
        val maxSeconds=relevant.maxOfOrNull { (it.end.toEpochMilli()-it.start.toEpochMilli())/1000.0 } ?: 0.0
        return bin(start,end,relevant).copy(maxRecordSeconds=maxSeconds)
    }
    fun bin(start: Instant, end: Instant, records: List<EnergyInterval>): EnergyBin {
        val relevant = records.filter { it.start < end && it.end > start && it.end > it.start }
        val boundaries = (listOf(start,end) + relevant.flatMap { listOf(maxOf(start,it.start),minOf(end,it.end)) }).distinct().sorted()
        var total = 0.0; var covered = 0.0; var maxDuration = 0.0
        boundaries.zipWithNext().forEach { (a,b) ->
            // One selected source; overlapping corrections replace older records.
            val record = relevant.filter { it.start <= a && it.end >= b }.maxByOrNull { it.modified }
            if (record != null) {
                val seconds = (b.toEpochMilli()-a.toEpochMilli())/1000.0
                val duration = (record.end.toEpochMilli()-record.start.toEpochMilli())/1000.0
                total += record.kcal * seconds / duration; covered += seconds
                maxDuration = maxOf(maxDuration,duration)
            }
        }
        return EnergyBin(start,end,if(covered>0)total else null,covered,maxDuration)
    }
}

package fr.bmbed.equilibre.connect

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.Duration

class HealthReader(context: Context) {
    val client = HealthConnectClient.getOrCreate(context)
    private val bridgeVersion=context.packageManager.getPackageInfo(context.packageName,0).longVersionCode.toInt()
    companion object {
        val totalPermission=HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class)
        val sessionPermission=HealthPermission.getReadPermission(ExerciseSessionRecord::class)
        val activePermission=HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
        val stepsPermission=HealthPermission.getReadPermission(StepsRecord::class)
        val distancePermission=HealthPermission.getReadPermission(DistanceRecord::class)
        val speedPermission=HealthPermission.getReadPermission(SpeedRecord::class)
        val required=setOf(totalPermission,sessionPermission,activePermission,stepsPermission,distancePermission,speedPermission)
        const val background="android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    }
    private suspend inline fun <reified T: Record> records(start: Instant,end: Instant): List<T> {
        val rows=mutableListOf<T>();var page: String?=null
        do {
            val response=client.readRecords(ReadRecordsRequest(T::class,TimeRangeFilter.between(start,end),pageSize=1000,pageToken=page))
            rows.addAll(response.records);page=response.pageToken
            require(rows.size<=100000) { "Trop de données pour un seul transfert." }
        }while(!page.isNullOrEmpty())
        return rows
    }
    private fun kind(type: Int): String = when(type) {
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING,ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL,ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "strength"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING,ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "pilates"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "hiking"
        else -> "other"
    }
    suspend fun snapshots(days: Int): JSONArray {
        val granted=client.permissionController.getGrantedPermissions()
        require(required.any { granted.contains(it) }) { "Autorise la lecture dans Santé Connect." }
        val zone=ZoneId.systemDefault();val today=LocalDate.now(zone);val now=Instant.now();val result=JSONArray()
        val first=today.minusDays(days.toLong()-1).atStartOfDay(zone).toInstant()
        // No origin filter: collect every app, including future devices.
        val totals=if(totalPermission in granted)records<TotalCaloriesBurnedRecord>(first,now) else emptyList()
        val sessions=if(sessionPermission in granted)records<ExerciseSessionRecord>(first,now) else emptyList()
        val distances=if(distancePermission in granted)records<DistanceRecord>(first,now).map { DistanceInterval(it.metadata.id,it.metadata.dataOrigin.packageName,it.startTime,it.endTime,it.distance.inMeters,it.metadata.lastModifiedTime) } else emptyList()
        val speeds=if(speedPermission in granted)records<SpeedRecord>(first,now).flatMap { record->record.samples.map { SpeedPoint(record.metadata.id,record.metadata.dataOrigin.packageName,it.time,it.speed.inMetersPerSecond*3.6,record.metadata.lastModifiedTime) } } else emptyList()
        require(speeds.size<=1000000) { "Trop de mesures de vitesse pour un seul transfert." }
        val energy=totals.map { EnergyInterval(it.startTime,it.endTime,it.energy.inKilocalories,it.metadata.lastModifiedTime) }
        val caloriesCache=mutableMapOf<Pair<Instant,Instant>,Double?>()
        for(index in (days-1) downTo 0) {
            val day=today.minusDays(index.toLong());val start=day.atStartOfDay(zone).toInstant();val end=day.plusDays(1).atStartOfDay(zone).toInstant();val until=minOf(now,end)
            val energyUntil=energy.filter { it.start<until&&it.end>start }.maxOfOrNull { minOf(it.end,until) } ?: start
            val bins=JSONArray();var cursor=start
            // Aggregate removes overlapping Activity data using Health Connect priorities.
            val hourly=if(energyUntil>start)client.aggregateGroupByDuration(AggregateGroupByDurationRequest(setOf(TotalCaloriesBurnedRecord.ENERGY_TOTAL),TimeRangeFilter.between(start,energyUntil),Duration.ofHours(1))).associateBy { it.startTime } else emptyMap()
            while(cursor<energyUntil) {
                val next=minOf(cursor.plusSeconds(3600),energyUntil);val aggregation=hourly[cursor]?.result
                val contributors=aggregation?.dataOrigins?.map { it.packageName }?.toSet() ?: emptySet()
                val contributingRecords=totals.filter { contributors.isEmpty()||it.metadata.dataOrigin.packageName in contributors }.map { EnergyInterval(it.startTime,it.endTime,it.energy.inKilocalories,it.metadata.lastModifiedTime) }
                val coverage=EnergyIntervals.coverage(cursor,next,contributingRecords)
                val value=if(coverage.covered>0)aggregation?.get(TotalCaloriesBurnedRecord.ENERGY_TOTAL)?.inKilocalories else null
                bins.put(JSONObject().put("start",cursor.toString()).put("end",next.toString()).put("total",value ?: JSONObject.NULL).put("covered",if(value==null)0 else coverage.covered).put("maxRecordSeconds",coverage.maxRecordSeconds));cursor=next
            }
            val stepsResult=if(stepsPermission in granted)client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL),TimeRangeFilter.between(start,until))) else null
            val daySessions=sessions.filter { it.startTime>=start&&it.startTime<end&&it.endTime<=now }
            require(daySessions.size<=500) { "Plus de 500 séances sur une journée : transfert arrêté sans supprimer les imports." }
            val sessionJson=JSONArray()
            for(s in daySessions) {
                val window=s.startTime to s.endTime
                val motion=SessionMotion.summarize(s.metadata.dataOrigin.packageName,s.startTime,s.endTime,distances,speeds)
                val ownTotals=totals.filter { it.metadata.dataOrigin.packageName==s.metadata.dataOrigin.packageName }.map { EnergyInterval(it.startTime,it.endTime,it.energy.inKilocalories,it.metadata.lastModifiedTime) }
                val sessionTotal=EnergyIntervals.sessionTotal(s.startTime,s.endTime,ownTotals)
                if(activePermission in granted&&!caloriesCache.containsKey(window))caloriesCache[window]=client.aggregate(AggregateRequest(setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL),TimeRangeFilter.between(s.startTime,s.endTime)))[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories
                sessionJson.put(JSONObject().put("id",s.metadata.id).put("clientId",s.metadata.clientRecordId?.takeIf { it.isNotBlank()&&it.length<=200 } ?: JSONObject.NULL).put("source",s.metadata.dataOrigin.packageName).put("modifiedAt",s.metadata.lastModifiedTime.toString()).put("start",s.startTime.toString()).put("end",s.endTime.toString()).put("type",s.exerciseType).put("kind",kind(s.exerciseType)).put("title",s.title?.take(160) ?: "").put("activeKcal",caloriesCache[window] ?: JSONObject.NULL).put("totalKcal",sessionTotal ?: JSONObject.NULL).put("distanceMeters",motion.distanceMeters ?: JSONObject.NULL).put("speedKmh",motion.speedKmh ?: JSONObject.NULL).put("speedSamples",motion.speedSamples))
            }
            val origins=(totals.filter { it.startTime<until&&it.endTime>start }.map { it.metadata.dataOrigin.packageName }+daySessions.map { it.metadata.dataOrigin.packageName }+(stepsResult?.dataOrigins?.map { it.packageName } ?: emptyList())).distinct().sorted()
            val permissions=JSONObject().put("total",totalPermission in granted).put("steps",stepsPermission in granted).put("sessions",sessionPermission in granted).put("activeCalories",activePermission in granted).put("distance",distancePermission in granted).put("speed",speedPermission in granted)
            result.put(JSONObject().put("version",2).put("bridgeVersion",bridgeVersion).put("day",day.toString()).put("source","health-connect").put("sources",JSONArray(origins)).put("permissions",permissions).put("sessions",sessionJson).put("zone",zone.id).put("capturedAt",now.toString()).put("start",start.toString()).put("end",end.toString()).put("bins",bins).put("steps",stepsResult?.get(StepsRecord.COUNT_TOTAL) ?: JSONObject.NULL))
        }
        return result
    }
}

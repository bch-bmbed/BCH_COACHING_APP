package fr.bmbed.equilibre.connect

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class HealthReader(context: Context) {
    val client = HealthConnectClient.getOrCreate(context)
    companion object {
        val required = setOf(HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),HealthPermission.getReadPermission(StepsRecord::class))
        const val background = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    }
    private suspend fun records(start: Instant,end: Instant,source: String? = null): List<TotalCaloriesBurnedRecord> {
        val rows=mutableListOf<TotalCaloriesBurnedRecord>();var page: String?=null
        do {
            val response=client.readRecords(ReadRecordsRequest(TotalCaloriesBurnedRecord::class,TimeRangeFilter.between(start,end),dataOriginFilter=if(source==null)emptySet() else setOf(DataOrigin(source)),pageSize=1000,pageToken=page))
            rows.addAll(response.records);page=response.pageToken
            require(rows.size<=100000) { "Trop de données. Réduis la période importée." }
        }while(!page.isNullOrEmpty())
        return rows
    }
    suspend fun sources(): List<String> {
        val now=Instant.now()
        return records(now.minusSeconds(7*86400),now).map { it.metadata.dataOrigin.packageName }.distinct().sorted()
    }
    suspend fun snapshots(source: String,days: Int): JSONArray {
        val granted=client.permissionController.getGrantedPermissions()
        require(granted.contains(HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class))) { "Autorise la lecture des calories totales dans Santé Connect." }
        val zone=ZoneId.systemDefault();val today=LocalDate.now(zone);val now=Instant.now();val result=JSONArray()
        val first=today.minusDays(days.toLong()-1).atStartOfDay(zone).toInstant()
        val records=records(first,now,source).map { EnergyInterval(it.startTime,it.endTime,it.energy.inKilocalories,it.metadata.lastModifiedTime) }
        for(index in (days-1) downTo 0) {
            val day=today.minusDays(index.toLong());val start=day.atStartOfDay(zone).toInstant();val end=day.plusDays(1).atStartOfDay(zone).toInstant();val until=minOf(now,end)
            val energyUntil=records.filter { it.start<until&&it.end>start }.maxOfOrNull { minOf(it.end,until) } ?: start
            val bins=JSONArray();var cursor=start
            while(cursor<energyUntil) {
                val next=minOf(cursor.plusSeconds(3600),energyUntil);val bin=EnergyIntervals.bin(cursor,next,records)
                bins.put(JSONObject().put("start",cursor.toString()).put("end",next.toString()).put("total",bin.total ?: JSONObject.NULL).put("covered",bin.covered).put("maxRecordSeconds",bin.maxRecordSeconds));cursor=next
            }
            val steps=if(granted.contains(HealthPermission.getReadPermission(StepsRecord::class)))client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL),TimeRangeFilter.between(start,until)))[StepsRecord.COUNT_TOTAL] else null
            result.put(JSONObject().put("version",1).put("day",day.toString()).put("source",source).put("zone",zone.id).put("capturedAt",now.toString()).put("start",start.toString()).put("end",end.toString()).put("bins",bins).put("steps",steps ?: JSONObject.NULL))
        }
        return result
    }
}

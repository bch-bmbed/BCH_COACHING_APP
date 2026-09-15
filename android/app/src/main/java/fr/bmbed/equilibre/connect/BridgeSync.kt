package fr.bmbed.equilibre.connect

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object BridgeSync {
    private val mutex=Mutex()
    suspend fun send(context: Context,days: Int): String = mutex.withLock { withContext(Dispatchers.IO) {
        val vault=Vault(context);val parts=(vault.code() ?: error("Associe ce téléphone depuis le dashboard.")).split('.')
        vault.syncStarted()
        val snapshots=HealthReader(context).snapshots(days)
        var sessionCount=0
        for(index in 0 until snapshots.length()) {
        val snapshot=snapshots.getJSONObject(index);sessionCount+=snapshot.getJSONArray("sessions").length()
        val body=JSONObject().put("action","sync").put("deviceId",parts[1]).put("token",parts[2]).put("snapshots",JSONArray().put(snapshot)).toString()
        val connection=URL("https://yuzvnyecrtcvzmxnlhfd.supabase.co/functions/v1/health-bridge").openConnection() as HttpURLConnection
        try {
            connection.requestMethod="POST";connection.connectTimeout=20000;connection.readTimeout=30000;connection.doOutput=true;connection.instanceFollowRedirects=false
            connection.setRequestProperty("Content-Type","application/json")
            connection.setRequestProperty("apikey","sb_publishable_e7Yaf39-gmRsAdYMfmJVsA_1Z9Lmtjf")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val success=connection.responseCode in 200..299
            val response=(if(success)connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            if(!success)error(runCatching { JSONObject(response).optString("error","Synchronisation impossible.") }.getOrDefault("Synchronisation impossible."))
        }finally { connection.disconnect() }
        }
        val permission=snapshots.getJSONObject(snapshots.length()-1).getJSONObject("permissions").getBoolean("sessions")
        val today=snapshots.getJSONObject(snapshots.length()-1).getJSONArray("sessions")
        val known=(0 until today.length()).count { val s=today.getJSONObject(it);!s.isNull("activeKcal")||!s.isNull("totalKcal") }
        val moving=(0 until today.length()).count { val s=today.getJSONObject(it);!s.isNull("speedKmh")||!s.isNull("distanceMeters") }
        "Synchronisé le ${ZonedDateTime.now().format(DateTimeFormatter.ofPattern("dd/MM à HH:mm"))} · $days journées · $sessionCount enregistrements de séances, avant regroupement. Aujourd’hui : ${today.length()} séance(s), $known avec des calories, $moving avec vitesse ou distance.${if(!permission) " Autorisation Séances absente : actualise les autorisations." else " Toutes les sources disponibles ont été lues."}".also { vault.syncSucceeded(it) }
    } }
}
class SyncWorker(context: Context,parameters: WorkerParameters): CoroutineWorker(context,parameters) {
    override suspend fun doWork(): Result {
        val vault=Vault(applicationContext);val manual=inputData.getBoolean("manual",false)
        if(!manual&&!vault.automatic)return Result.success()
        return try {
            if(!manual&&!HealthReader(applicationContext).client.permissionController.getGrantedPermissions().contains(HealthReader.background)) {
                vault.syncFailed("Automatisation suspendue : autorisation en arrière-plan absente.");return Result.failure()
            }
            BridgeSync.send(applicationContext,if(manual)14 else 3);Result.success()
        }catch(e: kotlinx.coroutines.CancellationException){throw e}
        catch(e: Exception){vault.syncFailed(e.message ?: "Synchronisation impossible.");if(!manual&&runAttemptCount<3)Result.retry() else Result.failure()}
    }
}

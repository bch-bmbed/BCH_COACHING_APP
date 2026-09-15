package fr.bmbed.equilibre.connect

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object BridgeSync {
    suspend fun send(context: Context,days: Int) = withContext(Dispatchers.IO) {
        val vault=Vault(context);val parts=(vault.code() ?: error("Associe ce téléphone depuis le dashboard.")).split('.')
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
        "Synchronisé à ${ZonedDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))} · $days journées · $sessionCount enregistrements de séances, avant regroupement.${if(!permission) " Autorisation Séances absente : actualise les autorisations." else " Toutes les sources disponibles ont été lues."}".also { vault.status=it }
    }
}
class SyncWorker(context: Context,parameters: WorkerParameters): CoroutineWorker(context,parameters) {
    override suspend fun doWork(): Result {
        val vault=Vault(applicationContext);if(!vault.automatic)return Result.success()
        return try {
            if(!HealthReader(applicationContext).client.permissionController.getGrantedPermissions().contains(HealthReader.background)) {
                vault.status="Synchronisation manuelle : autorisation en arrière-plan absente.";return Result.success()
            }
            BridgeSync.send(applicationContext,3);Result.success()
        }catch(e: Exception){vault.status=e.message ?: "Synchronisation en attente.";if(runAttemptCount<3)Result.retry() else Result.failure()}
    }
}

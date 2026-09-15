package fr.bmbed.equilibre.connect

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object BridgeSync {
    suspend fun send(context: Context,days: Int) = withContext(Dispatchers.IO) {
        val vault=Vault(context);val parts=(vault.code() ?: error("Associe ce téléphone depuis le dashboard.")).split('.')
        require(vault.source.isNotBlank()) { "Choisis une source de calories totales." }
        val snapshots=HealthReader(context).snapshots(vault.source,days)
        val body=JSONObject().put("action","sync").put("deviceId",parts[1]).put("token",parts[2]).put("snapshots",snapshots).toString()
        val connection=URL("https://yuzvnyecrtcvzmxnlhfd.supabase.co/functions/v1/health-bridge").openConnection() as HttpURLConnection
        try {
            connection.requestMethod="POST";connection.connectTimeout=20000;connection.readTimeout=30000;connection.doOutput=true;connection.instanceFollowRedirects=false
            connection.setRequestProperty("Content-Type","application/json")
            connection.setRequestProperty("apikey","sb_publishable_e7Yaf39-gmRsAdYMfmJVsA_1Z9Lmtjf")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val success=connection.responseCode in 200..299
            val response=(if(success)connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            if(!success)error(runCatching { JSONObject(response).optString("error","Synchronisation impossible.") }.getOrDefault("Synchronisation impossible."))
            "Synchronisé à ${ZonedDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))} · $days journées vérifiées.".also { vault.status=it }
        }finally { connection.disconnect() }
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

package fr.bmbed.equilibre.connect

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

object SyncWork {
    const val MANUAL="equilibre-health-manual"
    const val AUTOMATIC="equilibre-health-sync"
    private fun network()=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    fun manual(context: Context) {
        val request=OneTimeWorkRequestBuilder<SyncWorker>().setInputData(workDataOf("manual" to true)).setConstraints(network()).build()
        WorkManager.getInstance(context).enqueueUniqueWork(MANUAL,ExistingWorkPolicy.KEEP,request)
    }
    fun automatic(context: Context) {
        val request=PeriodicWorkRequestBuilder<SyncWorker>(1,TimeUnit.HOURS).setConstraints(network()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(AUTOMATIC,ExistingPeriodicWorkPolicy.KEEP,request)
    }
    fun stop(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(AUTOMATIC) }
}

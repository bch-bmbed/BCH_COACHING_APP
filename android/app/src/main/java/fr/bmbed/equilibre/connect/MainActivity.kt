package fr.bmbed.equilibre.connect

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.work.*
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class MainActivity: ComponentActivity() {
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private lateinit var sourcePicker: Spinner
    private lateinit var vault: Vault
    private var sources=listOf<String>()
    private val permissionRequest=registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
        status.text="Autorisations enregistrées. Recherche des sources…"
        discover()
    }
    private fun text(value: String,size: Float=16f): TextView = TextView(this).apply { text=value;textSize=size;setTextColor(Color.rgb(20,44,58));setPadding(0,12,0,12);content.addView(this) }
    private fun button(label: String,action: ()->Unit) = Button(this).apply { text=label;isAllCaps=false;setOnClickListener { action() };content.addView(this) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState);vault=Vault(this)
        val scroll=ScrollView(this);content=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(32,42,32,36) };scroll.addView(content);setContentView(scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view,insets ->
            val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);insets
        }
        text("Équilibre Connect",28f)
        text("Tes dépenses, au fil de la journée",20f)
        text("Cette passerelle lit tes calories totales et tes pas dans Santé Connect, puis les transmet à ton compte Équilibre. Elle ne lit ni tes repas, ni tes données médicales. Aucun accès en écriture à Santé Connect.")
        status=text(vault.status)
        text("1. Associer mon compte",20f)
        text("Dans le dashboard → Compte → Santé Connect, crée un code d’association puis colle-le ici. Ce code reste privé.")
        val code=EditText(this).apply { hint="Code EQ1…";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD;setSingleLine(false);content.addView(this) }
        button("Enregistrer le code") { try{vault.setCode(code.text.toString().trim());code.setText("");status.text="Code enregistré. Autorise Santé Connect puis synchronise pour vérifier l’association."}catch(e: Exception){status.text=e.message} }
        text("2. Autoriser Santé Connect",20f)
        button("Autoriser les calories et les pas") {
            when(HealthConnectClient.getSdkStatus(this)) {
                HealthConnectClient.SDK_AVAILABLE -> permissionRequest.launch(HealthReader.required)
                else -> { status.text="Installe ou mets à jour Santé Connect, puis réessaie.";open("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata") }
            }
        }
        text("3. Choisir la dépense totale",20f)
        text("Choisis l’application qui fournit le total repos + activité. Une seule source est utilisée. Les pas sont agrégés séparément par Santé Connect.")
        sourcePicker=Spinner(this);content.addView(sourcePicker)
        button("Rechercher les sources") { discover() }
        sourcePicker.onItemSelectedListener=object: AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?,view: View?,position: Int,id: Long) { if(position in sources.indices)vault.source=sources[position] }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        button("Synchroniser maintenant (14 jours)") { lifecycleScope.launch { status.text="Lecture et synchronisation en cours…";try{status.text=BridgeSync.send(this@MainActivity,14)}catch(e: Exception){status.text=e.message ?: "Synchronisation impossible.";vault.status=status.text.toString()} } }
        text("4. Actualisation automatique",20f)
        text("Android peut lire les données environ chaque heure en arrière-plan. Le délai dépend des applications sources, de la batterie et des autorisations. Le dashboard affiche l’heure des dernières données.")
        button("Activer la synchronisation en arrière-plan") {
            lifecycleScope.launch {
                try {
                    val reader=HealthReader(this@MainActivity)
                    if(reader.client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)!=HealthConnectFeatures.FEATURE_STATUS_AVAILABLE){status.text="Arrière-plan indisponible sur cette version. Utilise Synchroniser maintenant.";return@launch}
                    vault.automatic=true
                    val request=PeriodicWorkRequestBuilder<SyncWorker>(1,TimeUnit.HOURS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
                    WorkManager.getInstance(this@MainActivity).enqueueUniquePeriodicWork("equilibre-health-sync",ExistingPeriodicWorkPolicy.UPDATE,request)
                    permissionRequest.launch(HealthReader.required+HealthReader.background)
                }catch(e: Exception){status.text=e.message}
            }
        }
        button("Arrêter la synchronisation automatique") { vault.automatic=false;WorkManager.getInstance(this).cancelUniqueWork("equilibre-health-sync");status.text="Synchronisation automatique arrêtée." }
        button("Ouvrir mon dashboard") { open("https://bch-bmbed.github.io/BCH_COACHING_APP/") }
        button("Confidentialité et données") { startActivity(Intent(this,PrivacyActivity::class.java)) }
        text("Pour retirer l’accès au compte, désactive cette passerelle dans le dashboard. Tu peux aussi retirer les autorisations dans Santé Connect.",14f)
        if(HealthConnectClient.getSdkStatus(this)==HealthConnectClient.SDK_AVAILABLE)discover()
    }
    private fun discover() {
        lifecycleScope.launch {
            try {
                val selected=vault.source;sources=HealthReader(this@MainActivity).sources()
                val labels=sources.map { source -> runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(source,0)).toString()+" · "+source }.getOrDefault(source) }
                sourcePicker.adapter=ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,labels)
                if(sources.isEmpty())status.text="Aucune calorie totale trouvée ces 7 derniers jours. Vérifie dans Santé Connect → Données → Activité → Calories totales brûlées. Voir des séances dans Google Fit ne garantit pas la présence de ce total."
                else {sourcePicker.setSelection(sources.indexOf(selected).coerceAtLeast(0));status.text="${sources.size} source(s) de calories totales disponible(s). Choisis celle de référence."}
            }catch(e: Exception){status.text="Autorise d’abord la lecture des calories totales dans Santé Connect."}
        }
    }
    private fun open(url: String){startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}
}

class PrivacyActivity: ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text=TextView(this).apply {
            textSize=17f;setPadding(28,48,28,32)
            text="Équilibre Connect — Confidentialité\n\nCette application personnelle lit uniquement les calories totales brûlées et les pas que tu autorises dans Santé Connect. Elle ne modifie aucune donnée de Santé Connect.\n\nLes calories sont regroupées par heure, avec leur période de couverture, leur application source et le fuseau horaire. Les pas sont regroupés par jour. Jusqu’à 14 jours sont envoyés lors d’une synchronisation manuelle, et les 3 derniers jours lors de la synchronisation automatique, pour reprendre les corrections tardives.\n\nCes données sont transmises par HTTPS à ton compte privé Équilibre, hébergé par Supabase. Aucun transfert à une régie publicitaire, aucun traceur et aucun accès aux données médicales, GPS ou fréquence cardiaque.\n\nLe code d’association autorise seulement l’envoi de ces données. Il est chiffré sur le téléphone avec une clé du Keystore Android et n’est pas inclus dans les sauvegardes Android. Le serveur conserve uniquement son empreinte. Tu peux révoquer la passerelle dans Compte sur le dashboard et arrêter la lecture dans Santé Connect.\n\nLa dépense affichée reste une estimation. Les périodes sans données ne sont jamais assimilées à zéro. Les imports sont conservés dans ton compte pour le suivi ; révoquer une passerelle arrête les futurs envois sans effacer l’historique. Pour supprimer les imports du compte, utilise la gestion des données de ton projet Supabase.\n\nProjet et contact : github.com/bch-bmbed/BCH_COACHING_APP"
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}

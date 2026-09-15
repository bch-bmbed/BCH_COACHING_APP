package fr.bmbed.equilibre.connect

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.doAfterTextChanged
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity: ComponentActivity() {
    private lateinit var content: LinearLayout
    private lateinit var vault: Vault
    private lateinit var accountState: TextView
    private lateinit var permissionState: TextView
    private lateinit var permissionDetail: TextView
    private lateinit var syncState: TextView
    private lateinit var lastSync: TextView
    private lateinit var report: TextView
    private lateinit var automaticState: TextView
    private lateinit var message: TextView
    private lateinit var progress: ProgressBar
    private lateinit var codeForm: LinearLayout
    private lateinit var code: EditText
    private lateinit var saveCode: Button
    private lateinit var changeCode: Button
    private lateinit var permissionButton: Button
    private lateinit var syncButton: Button
    private lateinit var automaticButton: Button
    private lateinit var stopButton: Button
    private var hasCode=false
    private var editingCode=false
    private var granted=emptySet<String>()
    private var permissionChecked=false
    private var healthAvailable=false
    private var backgroundAvailable=false
    private var workChecked=false
    private var manualSubmitting=false
    private var manualWork=emptyList<WorkInfo>()
    private var automaticWork=emptyList<WorkInfo>()
    private val ink=Color.rgb(20,44,58)
    private val permissionRequest=registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { refreshPermissions() }
    private fun dp(n: Int)=(n*resources.displayMetrics.density).toInt()
    private fun text(parent: LinearLayout,value: String,size: Float=15f)=TextView(this).apply {
        text=value;textSize=size;setTextColor(ink);setPadding(0,dp(6),0,dp(6));parent.addView(this)
    }
    private fun button(parent: LinearLayout,label: String,action: ()->Unit)=Button(this).apply {
        text=label;isAllCaps=false;minHeight=dp(48);setTextColor(ink)
        backgroundTintList=ColorStateList.valueOf(Color.rgb(224,239,232))
        setOnClickListener { action() }
        parent.addView(this,LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(4) })
    }
    private fun card(title: String)=LinearLayout(this).apply {
        orientation=LinearLayout.VERTICAL;setPadding(dp(16),dp(12),dp(16),dp(16))
        background=GradientDrawable().apply { setColor(Color.WHITE);cornerRadius=dp(16).toFloat();setStroke(dp(1),Color.rgb(216,230,223)) }
        content.addView(this,LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(14) })
        text(this,title,19f).setTypeface(null,Typeface.BOLD)
    }
    private fun showState(view: TextView,state: StepStatus) {
        view.text=state.label
        view.setTextColor(when(state.tone) { StepTone.DONE->Color.rgb(30,112,77);StepTone.ATTENTION->Color.rgb(148,86,16);else->ink })
        view.setTypeface(null,Typeface.BOLD);view.accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState);vault=Vault(this);hasCode=runCatching { vault.code()!=null }.getOrDefault(false)
        val scroll=ScrollView(this)
        content=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(dp(16),dp(18),dp(16),dp(24));setBackgroundColor(Color.rgb(243,247,245)) }
        scroll.addView(content);setContentView(scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view,insets ->
            val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);insets
        }
        text(content,"Équilibre Connect",27f).setTypeface(null,Typeface.BOLD)
        val version=packageManager.getPackageInfo(packageName,0).versionName
        text(content,"Version $version · toutes tes sources Santé Connect",13f)
        text(content,"Les coches confirment l’état réel. Après la configuration, seul « Synchroniser maintenant » sert à actualiser tes données.")
        message=text(content,"",14f).apply { visibility=View.GONE;accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val account=card("1 · Mon compte")
        accountState=text(account,"")
        changeCode=button(account,"Modifier le code d’association") { editingCode=!editingCode;code.setText("");render() }
        codeForm=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;account.addView(this) }
        text(codeForm,"Dans le dashboard → Compte → Santé Connect, crée un code puis colle-le ici. Le code reste privé.",14f)
        code=EditText(this).apply { hint="Code EQ1…";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD;setSingleLine(false);codeForm.addView(this) }
        saveCode=button(codeForm,"Enregistrer le code") {
            try { vault.setCode(code.text.toString().trim());hasCode=true;editingCode=false;code.setText("");notice("Code enregistré. La prochaine synchronisation vérifiera le compte.");render() }
            catch(e: Exception){notice(e.message ?: "Code invalide.")}
        }
        code.doAfterTextChanged { if(::saveCode.isInitialized)saveCode.isEnabled=code.text.isNotBlank()&&!busy() }

        val permissions=card("2 · Mes autorisations")
        permissionState=text(permissions,"");permissionDetail=text(permissions,"",14f)
        permissionButton=button(permissions,"Autoriser les données de sport") {
            if(HealthConnectClient.getSdkStatus(this)==HealthConnectClient.SDK_AVAILABLE) {
                if(granted.containsAll(HealthReader.required))refreshPermissions() else permissionRequest.launch(HealthReader.required)
            } else { notice("Installe ou mets à jour Santé Connect, puis reviens ici.");open("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata") }
        }

        val sync=card("3 · Mes données")
        syncState=text(sync,"");lastSync=text(sync,"",14f);report=text(sync,"",14f)
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate=true;visibility=View.GONE;sync.addView(this) }
        syncButton=button(sync,"Synchroniser maintenant") {
            if(!busy()) {
                manualSubmitting=true;render()
                try { SyncWork.manual(this) } catch(e: Exception){manualSubmitting=false;notice(e.message ?: "Impossible de démarrer.");render()}
            }
        }
        text(sync,"Actualise les 14 derniers jours, y compris les corrections. Les séances sans calories restent signalées dans le bilan.",13f)

        val automatic=card("4 · Actualisation automatique")
        automaticState=text(automatic,"")
        text(automatic,"Environ chaque heure, selon Android, le réseau et les données publiées par tes applications.",14f)
        automaticButton=button(automatic,"Activer la synchronisation automatique") {
            vault.automatic=true
            if(HealthReader.background in granted) { SyncWork.automatic(this);render() }
            else permissionRequest.launch(HealthReader.required+HealthReader.background)
        }
        stopButton=button(automatic,"Désactiver l’actualisation automatique") { vault.automatic=false;SyncWork.stop(this);render() }
        button(content,"Ouvrir mon dashboard") { open("https://bch-bmbed.github.io/BCH_COACHING_APP/") }
        button(content,"Confidentialité et données") { startActivity(Intent(this,PrivacyActivity::class.java)) }
        val manager=WorkManager.getInstance(this)
        manager.getWorkInfosForUniqueWorkLiveData(SyncWork.MANUAL).observe(this) {
            manualWork=it.orEmpty();manualSubmitting=false;render()
        }
        manager.getWorkInfosForUniqueWorkLiveData(SyncWork.AUTOMATIC).observe(this) { automaticWork=it.orEmpty();workChecked=true;render() }
        render()
    }
    override fun onResume() { super.onResume();if(::vault.isInitialized)refreshPermissions() }
    private fun refreshPermissions() {
        lifecycleScope.launch {
            try {
                healthAvailable=HealthConnectClient.getSdkStatus(this@MainActivity)==HealthConnectClient.SDK_AVAILABLE
                if(healthAvailable) {
                    val reader=HealthReader(this@MainActivity)
                    granted=reader.client.permissionController.getGrantedPermissions()
                    backgroundAvailable=reader.client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)==HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
                    if(vault.automatic&&backgroundAvailable&&HealthReader.background in granted)SyncWork.automatic(this@MainActivity)
                } else { granted=emptySet();backgroundAvailable=false }
                permissionChecked=true
            } catch(e: Exception) { permissionChecked=false;notice(e.message ?: "Impossible de vérifier les autorisations.") }
            render()
        }
    }
    private fun running()=(manualWork+automaticWork).any { it.state==WorkInfo.State.RUNNING }
    private fun pending()=manualSubmitting||manualWork.any { !it.state.isFinished }
    private fun busy()=running()||pending()
    private fun render() {
        if(!::stopButton.isInitialized)return
        val busy=busy();val complete=granted.containsAll(HealthReader.required)
        showState(accountState,SetupState.account(hasCode,vault.lastSuccess>0))
        codeForm.visibility=if(!hasCode||editingCode)View.VISIBLE else View.GONE
        changeCode.visibility=if(hasCode)View.VISIBLE else View.GONE
        changeCode.text=if(editingCode)"Annuler le changement" else "Modifier le code d’association"
        changeCode.isEnabled=!busy;saveCode.isEnabled=!busy&&code.text.isNotBlank()
        showState(permissionState,SetupState.permissions(granted.count { it in HealthReader.required },HealthReader.required.size,permissionChecked))
        permissionDetail.text=if(!permissionChecked)"Vérification au retour dans l’application." else listOf(
            "Séances" to HealthReader.sessionPermission,"Calories actives" to HealthReader.activePermission,
            "Calories totales" to HealthReader.totalPermission,"Pas" to HealthReader.stepsPermission,
            "Distance" to HealthReader.distancePermission,"Vitesse" to HealthReader.speedPermission
        ).joinToString(" · ") { (label,p)->(if(p in granted)"✓ " else "○ ")+label }
        permissionButton.text=if(complete)"✓ Données autorisées · vérifier" else "Autoriser / compléter les données"
        permissionButton.isEnabled=!busy
        showState(syncState,SetupState.sync(running(),pending(),vault.syncOutcome,vault.lastSuccess>0))
        lastSync.text=if(vault.lastSuccess>0)"Dernière réussite : "+DateTimeFormatter.ofPattern("dd/MM/yyyy à HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(vault.lastSuccess)) else "Aucune réussite confirmée depuis cette mise à jour."
        report.text=if(vault.syncOutcome=="error")vault.lastError else vault.lastSummary.ifBlank { vault.status }
        syncButton.text=if(running())"Synchronisation en cours…" else if(pending())"En attente de démarrage / réseau…" else if(vault.syncOutcome=="success")"✓ Synchronisé · actualiser maintenant" else "Synchroniser maintenant"
        syncButton.isEnabled=hasCode&&healthAvailable&&permissionChecked&&granted.any { it in HealthReader.required }&&!busy
        progress.visibility=if(busy)View.VISIBLE else View.GONE
        val scheduled=automaticWork.any { !it.state.isFinished }
        val automatic=SetupState.automatic(vault.automatic,backgroundAvailable,HealthReader.background in granted,scheduled,permissionChecked&&workChecked)
        showState(automaticState,automatic)
        automaticButton.text=if(automatic.tone==StepTone.DONE)"✓ Automatisation activée" else if(vault.automatic)"Terminer l’activation automatique" else "Activer la synchronisation automatique"
        automaticButton.isEnabled=hasCode&&permissionChecked&&backgroundAvailable&&automatic.tone!=StepTone.DONE&&!busy
        stopButton.isEnabled=vault.automatic||scheduled
    }
    private fun notice(value: String) { message.text=value;message.visibility=View.VISIBLE }
    private fun open(url: String){startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}
}

class PrivacyActivity: ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text=TextView(this).apply {
            textSize=17f;setPadding(28,48,28,32)
            text="Équilibre Connect — Confidentialité\n\nCette application personnelle lit les séances (titre, type, horaires et provenance), les calories totales, les calories actives, les pas, les distances et les vitesses que tu autorises dans Santé Connect. Elle ne modifie aucune donnée de Santé Connect.\n\nLes calories sont regroupées par heure, avec leur période de couverture, leur application source et le fuseau horaire. Les pas sont regroupés par jour. La distance et la moyenne des mesures de vitesse sont associées aux séances de la même application. Les points de vitesse individuels ne sont pas envoyés. Toutes les applications sources sont prises en compte ; les totaux sont agrégés par Santé Connect et les séances similaires sont regroupées dans le dashboard. Les données source des séances restent consultables. Jusqu’à 14 jours sont envoyés lors d’une synchronisation manuelle, et les 3 derniers jours lors de la synchronisation automatique, pour reprendre les corrections tardives.\n\nCes données sont transmises par HTTPS à ton compte privé Équilibre, hébergé par Supabase. Aucun transfert à une régie publicitaire, aucun traceur et aucun accès aux données médicales, GPS ou fréquence cardiaque.\n\nLe code d’association autorise seulement l’envoi de ces données. Il est chiffré sur le téléphone avec une clé du Keystore Android et n’est pas inclus dans les sauvegardes Android. Le serveur conserve uniquement son empreinte. Tu peux révoquer la passerelle dans Compte sur le dashboard et arrêter la lecture dans Santé Connect.\n\nLa dépense affichée reste une estimation. Les périodes sans données ne sont jamais assimilées à zéro. Les imports sont conservés dans ton compte pour le suivi ; révoquer une passerelle arrête les futurs envois sans effacer l’historique. Pour supprimer les imports du compte, utilise la gestion des données de ton projet Supabase.\n\nProjet et contact : github.com/bch-bmbed/BCH_COACHING_APP"
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}

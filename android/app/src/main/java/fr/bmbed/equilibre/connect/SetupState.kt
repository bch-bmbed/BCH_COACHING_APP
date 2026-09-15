package fr.bmbed.equilibre.connect

enum class StepTone { WAITING, DONE, ATTENTION, WORKING }
data class StepStatus(val label: String,val tone: StepTone)
object SetupState {
    fun account(hasCode: Boolean,verified: Boolean)=when {
        !hasCode -> StepStatus("À faire · aucun compte associé",StepTone.WAITING)
        verified -> StepStatus("✓ Compte associé et vérifié",StepTone.DONE)
        else -> StepStatus("✓ Code enregistré · à vérifier par une synchronisation",StepTone.DONE)
    }
    fun permissions(granted: Int,total: Int,checked: Boolean)=when {
        !checked -> StepStatus("Vérification des autorisations…",StepTone.WORKING)
        granted==total -> StepStatus("✓ $total/$total autorisations accordées",StepTone.DONE)
        else -> StepStatus("$granted/$total autorisations · à compléter",StepTone.ATTENTION)
    }
    fun automatic(wanted: Boolean,available: Boolean,permission: Boolean,scheduled: Boolean,checked: Boolean)=when {
        !checked -> StepStatus("Vérification de l’arrière-plan…",StepTone.WORKING)
        !available -> StepStatus("Indisponible sur ce téléphone · synchronisation manuelle",StepTone.ATTENTION)
        !wanted -> StepStatus("Désactivé",StepTone.WAITING)
        !permission -> StepStatus("Autorisation d’arrière-plan manquante",StepTone.ATTENTION)
        !scheduled -> StepStatus("À réactiver · aucune tâche programmée",StepTone.ATTENTION)
        else -> StepStatus("✓ Synchronisation automatique activée",StepTone.DONE)
    }
    fun sync(running: Boolean,queued: Boolean,outcome: String,hasSuccess: Boolean)=when {
        running -> StepStatus("Synchronisation en cours…",StepTone.WORKING)
        queued -> StepStatus("Synchronisation programmée · en attente de démarrage / réseau",StepTone.WORKING)
        outcome=="error" -> StepStatus("Échec du dernier essai · voir le message ci-dessous",StepTone.ATTENTION)
        outcome=="running" -> StepStatus("Dernier essai interrompu · à relancer",StepTone.ATTENTION)
        hasSuccess -> StepStatus("✓ Dernière synchronisation réussie",StepTone.DONE)
        else -> StepStatus("À faire · aucune synchronisation confirmée",StepTone.WAITING)
    }
}

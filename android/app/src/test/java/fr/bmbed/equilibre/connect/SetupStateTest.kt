package fr.bmbed.equilibre.connect

import org.junit.Assert.*
import org.junit.Test

class SetupStateTest {
    @Test fun savedCodeDoesNotClaimServerValidation() {
        assertTrue(SetupState.account(true,false).label.contains("à vérifier"))
        assertEquals(StepTone.WAITING,SetupState.account(false,true).tone)
    }
    @Test fun removedOrPartialPermissionsNeverShowCompleted() {
        assertEquals(StepTone.DONE,SetupState.permissions(4,4,true).tone)
        assertEquals(StepTone.ATTENTION,SetupState.permissions(3,4,true).tone)
        assertEquals(StepTone.WORKING,SetupState.permissions(4,4,false).tone)
    }
    @Test fun automaticRequiresPermissionAndScheduledWork() {
        assertEquals(StepTone.DONE,SetupState.automatic(true,true,true,true,true).tone)
        assertEquals(StepTone.ATTENTION,SetupState.automatic(true,true,false,true,true).tone)
        assertEquals(StepTone.ATTENTION,SetupState.automatic(true,true,true,false,true).tone)
        assertEquals(StepTone.WAITING,SetupState.automatic(false,true,true,true,true).tone)
    }
    @Test fun queuedAndRunningWorkNeverClaimSuccess() {
        assertEquals(StepTone.WORKING,SetupState.sync(false,true,"success",true).tone)
        assertEquals(StepTone.WORKING,SetupState.sync(true,false,"success",true).tone)
    }
    @Test fun failedAndInterruptedAttemptsKeepFailureVisibleAfterPriorSuccess() {
        assertEquals(StepTone.ATTENTION,SetupState.sync(false,false,"error",true).tone)
        assertEquals(StepTone.ATTENTION,SetupState.sync(false,false,"running",true).tone)
        assertEquals(StepTone.DONE,SetupState.sync(false,false,"success",true).tone)
    }
}

package fr.bmbed.equilibre.connect

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Vault(context: Context) {
    private val prefs = context.getSharedPreferences("bridge", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("equilibre-bridge", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("equilibre-bridge", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun setCode(value: String) {
        require(Regex("EQ1\\.[0-9a-f-]{36}\\.[0-9a-f]{64}").matches(value)) { "Code invalide. Copie le code complet depuis Compte → Santé Connect." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        prefs.edit().putString("code", Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)).apply()
        prefs.edit().remove("lastSuccess").remove("lastSummary").remove("lastError").remove("syncOutcome").apply()
    }
    fun code(): String? {
        val encoded = prefs.getString("code", null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
    }
    var source: String
        get() = prefs.getString("source", "") ?: ""
        set(value) { prefs.edit().putString("source", value).apply() }
    var status: String
        get() = prefs.getString("status", "Aucune synchronisation.") ?: ""
        set(value) { prefs.edit().putString("status", value).apply() }
    var automatic: Boolean
        get() = prefs.getBoolean("automatic", false)
        set(value) { prefs.edit().putBoolean("automatic", value).apply() }
    val lastSuccess: Long get() = prefs.getLong("lastSuccess",0)
    val lastSummary: String get() = prefs.getString("lastSummary","") ?: ""
    val lastError: String get() = prefs.getString("lastError","") ?: ""
    val syncOutcome: String get() = prefs.getString("syncOutcome","") ?: ""
    fun syncStarted() { prefs.edit().putString("syncOutcome","running").remove("lastError").apply() }
    fun syncSucceeded(summary: String) {
        prefs.edit().putLong("lastSuccess",System.currentTimeMillis()).putString("lastSummary",summary)
            .putString("syncOutcome","success").putString("status",summary).remove("lastError").apply()
    }
    fun syncFailed(message: String) {
        prefs.edit().putString("syncOutcome","error").putString("lastError",message).putString("status",message).apply()
    }
    fun forget() { prefs.edit().clear().apply() }
}

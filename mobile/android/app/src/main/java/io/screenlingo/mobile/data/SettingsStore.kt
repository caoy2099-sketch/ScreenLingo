package io.screenlingo.mobile.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.screenlingo.mobile.core.ModelSettings
import io.screenlingo.mobile.core.endpointOrigin
import io.screenlingo.mobile.core.requireNewOriginKey
import io.screenlingo.mobile.core.validatedSettings
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** API keys are encrypted by a non-exportable Android Keystore key, bound to their origin. */
class SettingsStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("model_settings", Context.MODE_PRIVATE)

    fun load(): ModelSettings {
        val defaults = ModelSettings()
        val endpoint = preferences.getString("endpoint", defaults.endpoint) ?: defaults.endpoint
        val encrypted = preferences.getString("api_key", "").orEmpty()
        val apiKey = if (encrypted.isEmpty()) "" else try {
            decrypt(encrypted, endpointOrigin(endpoint))
        } catch (_: Exception) {
            throw IllegalStateException("无法解锁已保存的 API Key，请在设置中清空后重新填写。")
        }
        return validatedSettings(ModelSettings(
            endpoint = endpoint,
            apiKey = apiKey,
            model = preferences.getString("model", "").orEmpty(),
            visionModel = preferences.getString("vision_model", "").orEmpty(),
        ))
    }

    fun save(settings: ModelSettings) {
        val normalized = validatedSettings(settings)
        val previousEndpoint = preferences.getString("endpoint", ModelSettings().endpoint) ?: ModelSettings().endpoint
        val previousCiphertext = preferences.getString("api_key", "").orEmpty()
        if (endpointOrigin(previousEndpoint) != endpointOrigin(normalized.endpoint) &&
            normalized.apiKey.isNotEmpty() && previousCiphertext.isNotEmpty()) {
            val oldKey = try { decrypt(previousCiphertext, endpointOrigin(previousEndpoint)) } catch (_: Exception) {
                throw IllegalStateException("请先清空已保存的 API Key，再更换服务地址。")
            }
            requireNewOriginKey(previousEndpoint, oldKey, normalized)
        }
        val encrypted = if (normalized.apiKey.isEmpty()) "" else try {
            encrypt(normalized.apiKey, endpointOrigin(normalized.endpoint))
        } catch (_: Exception) {
            throw IllegalStateException("设备无法安全保存 API Key，设置尚未保存。")
        }
        check(preferences.edit()
            .putString("endpoint", normalized.endpoint)
            .putString("api_key", encrypted)
            .putString("model", normalized.model)
            .putString("vision_model", normalized.visionModel)
            .commit()) { "设置保存失败，请检查设备可用空间。" }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
            generateKey()
        }
    }

    private fun encrypt(value: String, origin: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        val encoder = Base64.getEncoder()
        return encoder.encodeToString(cipher.iv) + ":" + encoder.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)))
    }

    private fun decrypt(value: String, origin: String): String {
        val parts = value.split(':', limit = 2)
        require(parts.size == 2)
        val decoder = Base64.getDecoder()
        val iv = decoder.decode(parts[0])
        require(iv.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(decoder.decode(parts[1])).toString(Charsets.UTF_8)
    }

    private companion object { const val KEY_ALIAS = "screenlingo.model_key.v1" }
}

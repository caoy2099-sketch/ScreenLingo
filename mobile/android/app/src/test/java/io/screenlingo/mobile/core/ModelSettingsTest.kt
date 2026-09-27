package io.screenlingo.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class ModelSettingsTest {
    @Test fun canonicalizesTlsHostAndDefaultPort() {
        assertEquals("https://example.com/v1", validateEndpoint(" HTTPS://EXAMPLE.COM:443/v1/ "))
        assertEquals(endpointOrigin("https://example.com/v1"), endpointOrigin("https://EXAMPLE.com:443/other"))
    }

    @Test fun cleartextIsRestrictedToLoopback() {
        for (endpoint in listOf("http://localhost:11434/v1", "http://127.0.0.1/v1", "http://[::1]:1234/v1")) {
            validateEndpoint(endpoint)
        }
        for (endpoint in listOf("http://127.8.2.3/v1", "http://192.168.1.1/v1", "http://10.0.2.2/v1", "http://example.com/v1", "http://localhost.example.com/v1")) {
            assertThrows(endpoint, IllegalArgumentException::class.java) { validateEndpoint(endpoint) }
        }
    }

    @Test fun rejectsEmbeddedCredentialsAmbiguousUrlsAndExtraParameters() {
        for (endpoint in listOf("ftp://example.com/v1", "https://user:secret@example.com", "https://example.com?a=1",
            "https://example.com/#part", "https://example.com/\\evil", "https://example.com/\n", "not-a-url")) {
            assertThrows(endpoint, IllegalArgumentException::class.java) { validateEndpoint(endpoint) }
        }
    }

    @Test fun rejectsHeaderInjectionAndOversizedModelNames() {
        assertThrows(IllegalArgumentException::class.java) { validatedSettings(ModelSettings(apiKey = "secret\r\nX-Header: injected")) }
        assertThrows(IllegalArgumentException::class.java) { validatedSettings(ModelSettings(model = "a".repeat(201))) }
        assertThrows(IllegalArgumentException::class.java) { validatedSettings(ModelSettings(visionModel = "a\nb")) }
        assertFalse(ModelSettings(apiKey = "private-secret").toString().contains("private-secret"))
    }

    @Test fun endpointChangesCannotReuseOldKeysAcrossOrigins() {
        val previous = "https://provider.example/v1"
        val settings = ModelSettings(endpoint = "https://different.example/v1", apiKey = "old-key")
        assertThrows(IllegalArgumentException::class.java) { requireNewOriginKey(previous, "old-key", settings) }
        requireNewOriginKey(previous, "old-key", settings.copy(apiKey = "new-key"))
        requireNewOriginKey(previous, "old-key", settings.copy(apiKey = ""))
        requireNewOriginKey(previous, "old-key", settings.copy(endpoint = "https://PROVIDER.example:443/v2"))
        assertThrows(IllegalArgumentException::class.java) {
            requireNewOriginKey(previous, "old-key", settings.copy(endpoint = "https://provider.example:8443/v1"))
        }
    }
}

package io.screenlingo.mobile.data

import io.screenlingo.mobile.core.ModelSettings
import java.util.concurrent.TimeUnit
import java.net.InetAddress
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TranslationRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: TranslationRepository
    private val client = OkHttpClient()

    @Before fun prepare() {
        server = MockWebServer().apply { start(InetAddress.getByName("127.0.0.1"), 0) }
        repository = TranslationRepository(client, localUrl("/"))
    }

    @After fun cleanUp() { server.shutdown() }

    private fun localUrl(path: String) = server.url(path).newBuilder().host("127.0.0.1").build()
    private fun settings() = ModelSettings(endpoint = localUrl("/v1").toString(), apiKey = "test-key", model = "test-model")
    private fun modelResponse() = MockResponse().setBody("""{"choices":[{"message":{"content":"测试译文"}}]}""")

    @Test fun defaultBingOriginUsesCanonicalNonRedirectingHost() {
        assertEquals("https://www.bing.com/", DEFAULT_BING_ORIGIN)
    }

    @Test fun modelTranslationSendsTextOnlyAndExpectedAuthorization() = runBlocking {
        server.enqueue(modelResponse())
        assertEquals("测试译文", repository.translate("TypeError", settings()))
        val request = server.takeRequest()
        assertEquals("/v1/chat/completions", request.path)
        assertEquals("Bearer test-key", request.getHeader("Authorization"))
        val body = JSONObject(request.body.readUtf8())
        assertEquals("test-model", body.getString("model"))
        assertEquals("TypeError", body.getJSONArray("messages").getJSONObject(1).getString("content"))
        assertFalse(body.toString().contains("image_url"))
    }

    @Test fun fullCompletionEndpointIsNotDuplicated() = runBlocking {
        server.enqueue(modelResponse())
        repository.translate("error", settings().copy(endpoint = localUrl("/custom/chat/completions").toString()))
        assertEquals("/custom/chat/completions", server.takeRequest().path)
    }

    @Test fun redirectsNeverForwardTextOrApiKeyToAnotherHost() {
        MockWebServer().use { other ->
            other.start(InetAddress.getByName("127.0.0.1"), 0)
            server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", other.url("/collect")))
            assertThrows(TranslationException::class.java) { runBlocking { repository.translate("private", settings()) } }
            assertEquals(1, server.requestCount)
            assertEquals(0, other.requestCount)
        }
    }

    @Test fun modelFailureDoesNotFallBackToBingAndDoesNotEchoServerSecrets() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("sensitive upstream diagnostic"))
        val error = assertThrows(TranslationException::class.java) { runBlocking { repository.translate("private", settings()) } }
        assertTrue(error.message.orEmpty().contains("API Key"))
        assertFalse(error.message.orEmpty().contains("sensitive"))
        assertEquals(1, server.requestCount)
    }

    @Test fun enforcesDeclaredAndChunkedResponseLimits() {
        server.enqueue(MockResponse().setBody("x".repeat(MAX_RESPONSE_BYTES + 1)))
        assertThrows(TranslationException::class.java) { runBlocking { requestText(client, Request.Builder().url(server.url("/")).build()) } }
        server.enqueue(MockResponse().setChunkedBody("x".repeat(MAX_RESPONSE_BYTES + 1), 4096))
        assertThrows(TranslationException::class.java) { runBlocking { requestText(client, Request.Builder().url(server.url("/")).build()) } }
    }

    @Test fun acceptsExactlyTheResponseLimit() = runBlocking {
        server.enqueue(MockResponse().setChunkedBody("x".repeat(MAX_RESPONSE_BYTES), 4096))
        assertEquals(MAX_RESPONSE_BYTES, requestText(client, Request.Builder().url(server.url("/")).build()).length)
    }

    @Test fun coroutineCancellationCancelsTheHttpCall() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val request = async(start = CoroutineStart.UNDISPATCHED) { repository.translate("error", settings()) }
        assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
        request.cancel()
        try {
            withTimeout(2000) { request.await() }
            throw AssertionError("Cancellation should propagate")
        } catch (_: CancellationException) {
            assertTrue(request.isCancelled)
        }
    }

    @Test fun malformedAndEmptyModelResultsHaveReadableErrors() {
        for (response in listOf("not json", "{\"choices\":[]}")) {
            server.enqueue(MockResponse().setBody(response))
            val error = assertThrows(TranslationException::class.java) { runBlocking { repository.translate("error", settings()) } }
            assertTrue(error.message.orEmpty().any { it.code > 0x3000 })
        }
    }

    @Test fun bingKeepsCookiesAndDoesNotReceiveConfiguredModelKey() = runBlocking {
        server.enqueue(MockResponse().setHeader("Set-Cookie", "session=synthetic; Path=/; HttpOnly").setBody(
            """<div id="tta_outGDCont" data-iid="translator.1"></div><script>IG:"ABC123";params_AbusePreventionHelper = [123456,"token",3600];</script>""",
        ))
        server.enqueue(MockResponse().setBody("""[{"translations":[{"text":"译文"}]}]"""))
        assertEquals("译文", repository.translate("source", settings().copy(model = "")))
        val page = server.takeRequest()
        val translate = server.takeRequest()
        assertEquals("/translator?mkt=zh-CN", page.path)
        assertEquals(null, page.getHeader("Authorization"))
        assertEquals(null, translate.getHeader("Authorization"))
        assertEquals("session=synthetic", translate.getHeader("Cookie"))
        assertTrue(translate.body.readUtf8().contains("text=source"))
    }

    @Test fun picturesAreUploadedOnlyWithExplicitVisionModel() = runBlocking {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.explain("", "说明内容", jpeg, settings()) }
        }
        assertEquals(0, server.requestCount)
        server.enqueue(modelResponse())
        repository.explain("", "说明内容", jpeg, settings().copy(visionModel = "vision-model"))
        val body = JSONObject(server.takeRequest().body.readUtf8())
        assertEquals("vision-model", body.getString("model"))
        assertTrue(body.toString().contains("data:image/jpeg;base64,"))
    }

    @Test fun inputLimitsRejectBeforeAnyNetworkRequest() {
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.translate("x".repeat(10_001), settings()) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.translate("  ", settings()) } }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.explain("text", "why", ByteArray(2 * 1024 * 1024 + 1), settings().copy(visionModel = "vision")) }
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun bingChunkingPreservesAllCharactersAndSurrogatePairs() {
        val text = "a".repeat(999) + "👩" + " b".repeat(750)
        val chunks = bingChunks(text)
        assertEquals(text, chunks.joinToString(""))
        assertTrue(chunks.all { it.length <= 1000 })
        assertTrue(chunks.all { !Character.isHighSurrogate(it.last()) && !Character.isLowSurrogate(it.first()) })
    }
}

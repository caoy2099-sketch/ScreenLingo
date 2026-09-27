package io.screenlingo.mobile.data

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageInputTest {
    @Test fun acceptsExactLimitAndClosesInput() = runBlocking {
        val closed = AtomicBoolean()
        val input = object : ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)) {
            override fun close() { closed.set(true); super.close() }
        }
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), BoundedImageReader().read(4, {}) { input })
        assertTrue(closed.get())
    }

    @Test fun rejectsEmptyAndOversizeInputs() {
        for (bytes in listOf(byteArrayOf(), byteArrayOf(1, 2, 3, 4, 5))) {
            assertThrows(ImageReadException::class.java) {
                runBlocking { BoundedImageReader().read(4, {}) { bytes.inputStream() } }
            }
        }
    }

    @Test fun cancellationReturnsWhileOpenIsBlockedAndClosesLateInput() = runBlocking {
        val opened = CountDownLatch(1)
        val releaseOpen = CountDownLatch(1)
        val cancelledOpen = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val input = object : ByteArrayInputStream(byteArrayOf(1)) {
            override fun close() { closed.countDown(); super.close() }
        }
        val request = async(start = CoroutineStart.UNDISPATCHED) {
            BoundedImageReader().read(4, { cancelledOpen.countDown() }) {
                opened.countDown()
                check(releaseOpen.await(5, TimeUnit.SECONDS))
                input
            }
        }
        try {
            assertTrue(opened.await(2, TimeUnit.SECONDS))
            request.cancel()
            withTimeout(1000) { request.join() }
            assertTrue(cancelledOpen.await(2, TimeUnit.SECONDS))
        } finally {
            releaseOpen.countDown()
        }
        assertTrue(closed.await(2, TimeUnit.SECONDS))
    }

    @Test fun cancellationDoesNotWaitForBlockedReadOrCloseAndWorkStaysBounded() = runBlocking {
        val reader = BoundedImageReader(maxConcurrentReads = 1)
        val reading = CountDownLatch(1)
        val closing = CountDownLatch(1)
        val release = CountDownLatch(1)
        val input = object : InputStream() {
            override fun read(): Int {
                reading.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                return -1
            }
            override fun close() {
                closing.countDown()
                check(release.await(5, TimeUnit.SECONDS))
            }
        }
        val request = async(start = CoroutineStart.UNDISPATCHED) { reader.read(4, {}) { input } }
        try {
            assertTrue(reading.await(2, TimeUnit.SECONDS))
            request.cancel()
            withTimeout(1000) { request.join() }
            assertTrue(closing.await(2, TimeUnit.SECONDS))
            assertThrows(ImageReadException::class.java) {
                runBlocking { reader.read(4, {}) { byteArrayOf(1).inputStream() } }
            }
        } finally {
            release.countDown()
        }
        // Capacity becomes reusable only after both blocked workers have actually stopped.
        withTimeout(2000) {
            while (true) {
                try {
                    assertArrayEquals(byteArrayOf(1), reader.read(4, {}) { byteArrayOf(1).inputStream() })
                    break
                } catch (_: ImageReadException) {
                    delay(10)
                }
            }
        }
    }

    @Test fun ownDeadlineHasReadableErrorButCallerCancellationStillPropagates() {
        val error = assertThrows(ImageReadException::class.java) {
            runBlocking { withImageDeadline<Unit>(timeoutMillis = 20) { awaitCancellation() } }
        }
        assertTrue(error.message.orEmpty().contains("超时"))
        assertThrows(CancellationException::class.java) {
            runBlocking { withTimeout(20) { withImageDeadline<Unit>(timeoutMillis = 1000) { awaitCancellation() } } }
        }
    }
}

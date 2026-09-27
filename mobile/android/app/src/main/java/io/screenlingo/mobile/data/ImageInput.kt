package io.screenlingo.mobile.data

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

internal class ImageReadException(message: String, cause: Throwable? = null) : IOException(message, cause)

internal suspend fun <T : Any> withImageDeadline(
    timeoutMillis: Long = 30_000,
    block: suspend () -> T,
): T = withTimeoutOrNull(timeoutMillis) { block() }
    ?: throw ImageReadException("图片读取或识别超时，请重新分享图片或裁剪后重试。")

/**
 * Some content providers ignore cancellation or block inside open/read/close. The coroutine
 * still cancels promptly. Their workers retain a slot until all resource cleanup finishes,
 * so repeated imports cannot create an unbounded number of blocked threads.
 */
internal class BoundedImageReader(maxConcurrentReads: Int = 2) {
    init { require(maxConcurrentReads > 0) }
    private val slots = Semaphore(maxConcurrentReads)

    suspend fun read(maxBytes: Int, cancelOpen: () -> Unit, open: () -> InputStream): ByteArray {
        require(maxBytes in 1..20 * 1024 * 1024)
        return suspendCancellableCoroutine { continuation ->
            if (!slots.tryAcquire()) {
                continuation.resumeWithException(ImageReadException("图片提供方仍未结束上次读取，请稍后重试或重启截译。"))
            } else {
                ReadAttempt(continuation, maxBytes, cancelOpen, open, slots).start()
            }
        }
    }

    private class ReadAttempt(
        private val continuation: CancellableContinuation<ByteArray>,
        private val maxBytes: Int,
        private val cancelOpen: () -> Unit,
        private val open: () -> InputStream,
        private val slots: Semaphore,
    ) {
        private val lock = Any()
        private var input: ClosingInput? = null
        private var cancelled = false
        private var readerFinished = false
        private var cleanupFinished = true
        private var released = false

        fun start() {
            continuation.invokeOnCancellation { cancel() }
            Thread({
                try {
                    checkActive()
                    val bytes = ClosingInput(open()).use { managed ->
                        synchronized(lock) { input = managed }
                        checkActive()
                        readBytes(managed.stream)
                    }
                    if (continuation.isActive) continuation.resume(bytes)
                } catch (error: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                } finally {
                    synchronized(lock) {
                        input = null
                        readerFinished = true
                        releaseWhenFinished()
                    }
                }
            }, "ScreenLingo-image-read").apply { isDaemon = true }.start()
        }

        private fun cancel() {
            val needsCleanup = synchronized(lock) {
                if (readerFinished || cancelled) false else {
                    cancelled = true
                    cleanupFinished = false
                    true
                }
            }
            if (!needsCleanup) return
            // Never run provider callbacks or a potentially blocking close on the UI thread.
            Thread({
                try {
                    try { synchronized(lock) { input }?.close() } catch (_: Exception) {
                        // Cancellation is already delivered; a close failure cannot replace it.
                    }
                    try { cancelOpen() } catch (_: Exception) {
                        // Provider cancellation is best effort; its worker still holds a slot.
                    }
                } finally {
                    synchronized(lock) {
                        cleanupFinished = true
                        releaseWhenFinished()
                    }
                }
            }, "ScreenLingo-image-cancel").apply { isDaemon = true }.start()
        }

        private fun checkActive() {
            if (!continuation.isActive) throw CancellationException("Image read cancelled")
        }

        private fun readBytes(stream: InputStream): ByteArray {
            ByteArrayOutputStream(minOf(maxBytes, 64 * 1024)).use { output ->
                val buffer = ByteArray(8 * 1024)
                var total = 0
                while (true) {
                    checkActive()
                    val read = stream.read(buffer, 0, minOf(buffer.size, maxBytes - total + 1))
                    if (read < 0) break
                    total += read
                    if (total > maxBytes) throw ImageReadException("图片超过 20 MB，请先裁剪需要识别的区域后重试。")
                    output.write(buffer, 0, read)
                }
                checkActive()
                if (total == 0) throw ImageReadException("图片内容为空，请重新选择图片。")
                return output.toByteArray()
            }
        }

        // Called only while lock is held. Cancellation and the read worker may finish in either order.
        private fun releaseWhenFinished() {
            if (readerFinished && cleanupFinished && !released) {
                released = true
                slots.release()
            }
        }
    }

    private class ClosingInput(val stream: InputStream) : Closeable {
        private val closed = AtomicBoolean()
        override fun close() { if (closed.compareAndSet(false, true)) stream.close() }
    }
}

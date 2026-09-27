package io.screenlingo.mobile.data

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import android.os.CancellationSignal
import android.os.Process
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

data class RecognizedImage(val preview: Bitmap, val jpeg: ByteArray?, val text: String)

class ImageRecognizer(private val context: Context) {
    suspend fun read(uri: Uri): RecognizedImage = withImageDeadline {
        withContext(Dispatchers.IO) {
            var preview: Bitmap? = null
            var recognition: Task<Text>? = null
            var delivered = false
            try {
                requireReadableContent(uri)
                val image = decodeImage(readBounded(uri))
                preview = image
                currentCoroutineContext().ensureActive()
                val recognizer = TextRecognition.getClient(
                    ChineseTextRecognizerOptions.Builder().build(),
                )
                val text = try {
                    val task = recognizer.process(InputImage.fromBitmap(image, 0))
                    recognition = task
                    task.await().text.trim()
                } finally {
                    recognizer.close()
                }
                currentCoroutineContext().ensureActive()
                if (text.isBlank()) {
                    throw ImageReadException("没有识别到文字，请选择文字更清晰的图片后重试。")
                }
                // OCR and text selection must remain usable even when this image cannot be
                // compressed under the optional vision-question upload limit.
                val jpeg = compressForQuestionOrNull(image)
                currentCoroutineContext().ensureActive()
                RecognizedImage(image, jpeg, text).also { delivered = true }
            } catch (error: CancellationException) {
                throw error
            } catch (error: ImageReadException) {
                throw error
            } catch (error: SecurityException) {
                throw ImageReadException("图片访问权限已失效，请重新选择或分享这张图片。", error)
            } catch (error: Exception) {
                throw ImageReadException("图片读取或识别失败，请选择清晰且较小的图片后重试。", error)
            } finally {
                if (!delivered) {
                    preview?.let { bitmap ->
                        val task = recognition
                        if (task != null && !task.isComplete) {
                            // Cancelling await does not stop native OCR; release its image afterward.
                            task.addOnCompleteListener(DIRECT_EXECUTOR) { bitmap.recycle() }
                        } else {
                            bitmap.recycle()
                        }
                    }
                }
            }
        }
    }

    private fun requireReadableContent(uri: Uri) {
        if (uri.scheme != "content" || uri.authority.isNullOrBlank()) {
            throw ImageReadException("请从相册选择图片，或通过系统分享将图片发送到截译。")
        }
        if (context.checkUriPermission(
                uri,
                Process.myPid(),
                Process.myUid(),
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            throw ImageReadException("尚未获得这张图片的读取权限，请重新选择或分享图片。")
        }
    }

    private suspend fun readBounded(uri: Uri): ByteArray {
        val cancellation = CancellationSignal()
        return INPUT_READER.read(MAX_INPUT_BYTES, cancellation::cancel) {
            val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r", cancellation)
                ?: throw ImageReadException("无法打开图片，请重新选择清晰且较小的图片。")
            try {
                // The stream owns the descriptor, including offset/length-limited assets.
                descriptor.createInputStream()
            } catch (error: Exception) {
                try { descriptor.close() } catch (closeError: Exception) { error.addSuppressed(closeError) }
                throw error
            }
        }
    }

    private suspend fun decodeImage(bytes: ByteArray): Bitmap {
        currentCoroutineContext().ensureActive()
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val width = bounds.outWidth
        val height = bounds.outHeight
        if (bounds.outMimeType !in SUPPORTED_TYPES || width <= 0 || height <= 0) {
            throw ImageReadException("图片格式无法识别，请改用清晰的 PNG、JPEG 或 WebP 图片。")
        }
        if (width > MAX_DIMENSION || height > MAX_DIMENSION || width.toLong() * height > MAX_PIXELS) {
            throw ImageReadException("图片尺寸过大，请裁剪到需要识别的文字区域后重试。")
        }
        var sampleSize = 1
        while ((maxOf(width, height) + sampleSize - 1) / sampleSize > MAX_PREVIEW_EDGE) {
            sampleSize *= 2
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: throw ImageReadException("图片无法解码，请重新选择清晰且较小的图片。")
        var completed = false
        try {
            currentCoroutineContext().ensureActive()
            val edge = maxOf(bitmap.width, bitmap.height)
            if (edge > MAX_PREVIEW_EDGE) {
                val ratio = MAX_PREVIEW_EDGE.toDouble() / edge
                val scaled = Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * ratio).toInt().coerceAtLeast(1),
                    (bitmap.height * ratio).toInt().coerceAtLeast(1),
                    true,
                )
                if (scaled !== bitmap) bitmap.recycle()
                bitmap = scaled
            }
            val orientation = if (bounds.outMimeType in EXIF_TYPES) {
                bytes.inputStream().use { stream ->
                    ExifInterface(stream).getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL,
                    )
                }
            } else {
                ExifInterface.ORIENTATION_NORMAL
            }
            val matrix = orientationMatrix(orientation)
            if (!matrix.isIdentity) {
                val corrected = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                if (corrected !== bitmap) bitmap.recycle()
                bitmap = corrected
            }
            if (bitmap.hasAlpha()) {
                val flattened = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
                Canvas(flattened).apply {
                    drawColor(Color.WHITE)
                    drawBitmap(bitmap, 0f, 0f, null)
                }
                bitmap.recycle()
                bitmap = flattened
            }
            currentCoroutineContext().ensureActive()
            completed = true
            return bitmap
        } finally {
            if (!completed) bitmap.recycle()
        }
    }

    private fun orientationMatrix(orientation: Int): Matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                setRotate(90f)
                postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                setRotate(-90f)
                postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
        }
    }

    private suspend fun compressForQuestion(bitmap: Bitmap): ByteArray {
        ByteArrayOutputStream().use { output ->
            for (quality in intArrayOf(90, 75, 60, 45, 30, 20)) {
                currentCoroutineContext().ensureActive()
                output.reset()
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                    throw ImageReadException("图片转换失败，请重新选择清晰且较小的图片。")
                }
                if (output.size() <= MAX_QUESTION_BYTES) return output.toByteArray()
            }
        }
        throw ImageReadException("图片仍然过大，请裁剪到需要提问的区域后重试。")
    }

    private suspend fun compressForQuestionOrNull(bitmap: Bitmap): ByteArray? = try {
        compressForQuestion(bitmap)
    } catch (error: ImageReadException) {
        if (error.message == "图片仍然过大，请裁剪到需要提问的区域后重试。") null else throw error
    }

    private companion object {
        const val MAX_INPUT_BYTES = 20 * 1024 * 1024
        const val MAX_QUESTION_BYTES = 2 * 1024 * 1024
        const val MAX_DIMENSION = 20_000
        const val MAX_PIXELS = 40_000_000L
        const val MAX_PREVIEW_EDGE = 2_048
        val EXIF_TYPES = setOf("image/jpeg", "image/png", "image/webp", "image/heif", "image/heic")
        val SUPPORTED_TYPES = EXIF_TYPES + setOf("image/bmp", "image/gif")
        val DIRECT_EXECUTOR = Executor { command -> command.run() }
        val INPUT_READER = BoundedImageReader()
    }
}

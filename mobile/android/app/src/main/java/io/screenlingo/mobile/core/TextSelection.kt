package io.screenlingo.mobile.core

import java.text.BreakIterator
import java.util.Locale

enum class SelectionMode { WORD, SENTENCE }

data class TextPiece(val start: Int, val end: Int, val text: String)

/** Offsets always refer to the original UTF-16 string; no OCR text is rewritten. */
object TextSelection {
    const val MAX_TEXT_LENGTH = 10_000
    const val MAX_PIECES = 600

    fun split(text: String, mode: SelectionMode): List<TextPiece> {
        require(text.length <= MAX_TEXT_LENGTH) { "内容过长，最多支持 10000 个字符，请先缩小范围。" }
        if (text.isBlank()) return emptyList()
        val iterator = when (mode) {
            SelectionMode.WORD -> BreakIterator.getWordInstance(Locale.SIMPLIFIED_CHINESE)
            SelectionMode.SENTENCE -> BreakIterator.getSentenceInstance(Locale.SIMPLIFIED_CHINESE)
        }
        iterator.setText(text)
        val pieces = mutableListOf<TextPiece>()
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            // Some platform ICU versions expose boundaries inside an emoji sequence.
            if (end < text.length && joinsEmoji(text, end)) {
                end = iterator.next()
                continue
            }
            var visibleStart = start
            var visibleEnd = end
            while (visibleStart < visibleEnd && text[visibleStart].isWhitespace()) visibleStart++
            while (visibleEnd > visibleStart && text[visibleEnd - 1].isWhitespace()) visibleEnd--
            if (visibleEnd > visibleStart) {
                pieces += TextPiece(visibleStart, visibleEnd, text.substring(visibleStart, visibleEnd))
                require(pieces.size <= MAX_PIECES) {
                    "内容包含超过 600 个片段，请改用按句选择，或先缩小范围。"
                }
            }
            start = end
            end = iterator.next()
        }
        return pieces
    }

    fun assemble(source: String, pieces: List<TextPiece>, selected: Set<Int>): String {
        require(source.length <= MAX_TEXT_LENGTH && pieces.size <= MAX_PIECES) { "内容超过选择上限。" }
        require(selected.all { it in pieces.indices }) { "选择已过期，请重新选择文字。" }
        var previousEnd = 0
        for (piece in pieces) {
            require(piece.start >= previousEnd && piece.end > piece.start && piece.end <= source.length &&
                source.substring(piece.start, piece.end) == piece.text) { "文字已变化，请重新选择。" }
            previousEnd = piece.end
        }
        if (selected.isEmpty()) return ""
        if (selected.size == pieces.size) return source
        val output = StringBuilder()
        var previous: TextPiece? = null
        for ((index, piece) in pieces.withIndex()) {
            if (index !in selected) continue
            previous?.let {
                val gap = source.substring(it.end, piece.start)
                // Retain original spaces/newlines between adjacent selected pieces.
                // A skipped word is separated so unrelated English words never fuse.
                output.append(if (gap.all(Char::isWhitespace)) gap else " ")
            }
            output.append(piece.text)
            previous = piece
        }
        return output.toString()
    }

    private fun joinsEmoji(text: String, boundary: Int): Boolean {
        val next = text.codePointAt(boundary)
        val previous = text.codePointBefore(boundary)
        if (next == 0x200D || previous == 0x200D || next in 0xFE00..0xFE0F ||
            next in 0x1F3FB..0x1F3FF || next == 0x20E3 ||
            Character.isLowSurrogate(text[boundary])) return true
        if (next in 0x1F1E6..0x1F1FF && previous in 0x1F1E6..0x1F1FF) {
            var regionalCount = 0
            var position = boundary
            while (position > 0 && text.codePointBefore(position) in 0x1F1E6..0x1F1FF) {
                position -= Character.charCount(text.codePointBefore(position))
                regionalCount++
            }
            return regionalCount % 2 == 1
        }
        return false
    }
}

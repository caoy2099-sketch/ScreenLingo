package io.screenlingo.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TextSelectionTest {
    @Test fun selectingEverythingPreservesWhitespaceAndCodeExactly() {
        val source = "  TypeError: foo(bar)\n\t中文提示。  👩🏽‍💻 🇨🇳\n"
        for (mode in SelectionMode.entries) {
            val pieces = TextSelection.split(source, mode)
            assertEquals(source, TextSelection.assemble(source, pieces, pieces.indices.toSet()))
            assertTrue(pieces.all { source.substring(it.start, it.end) == it.text })
        }
    }

    @Test fun duplicateWordsAreSelectedByPosition() {
        val source = "error first error last"
        val pieces = TextSelection.split(source, SelectionMode.WORD)
        val secondError = pieces.indexOfLast { it.text == "error" }
        assertEquals("error last", TextSelection.assemble(source, pieces, setOf(secondError, pieces.lastIndex)))
        assertEquals("", TextSelection.assemble(source, pieces, emptySet()))
    }

    @Test fun selectionOrderComesFromSourceAndSkippedWordsDoNotFuse() {
        val source = "one two three"
        val pieces = TextSelection.split(source, SelectionMode.WORD)
        assertEquals("one three", TextSelection.assemble(source, pieces, linkedSetOf(2, 0)))
    }

    @Test fun adjacentSelectedPiecesRetainOriginalWhitespace() {
        val source = "one\n\t two  three"
        val pieces = TextSelection.split(source, SelectionMode.WORD)
        assertEquals("one\n\t two", TextSelection.assemble(source, pieces, setOf(0, 1)))
    }

    @Test fun emojiJoinersModifiersAndFlagsStayIntact() {
        val source = "hello 👩🏽‍💻 🇨🇳 👍🏾 bye"
        val pieces = TextSelection.split(source, SelectionMode.WORD)
        for (emoji in listOf("👩🏽‍💻", "🇨🇳", "👍🏾")) assertTrue(pieces.any { it.text == emoji })
        assertFalse(pieces.any { it.text.length == 1 && Character.isSurrogate(it.text[0]) })
    }

    @Test fun sentenceModeKeepsChineseAndEnglishEndings() {
        val source = "第一句。第二句！ Third sentence. Next sentence?"
        val pieces = TextSelection.split(source, SelectionMode.SENTENCE)
        assertTrue(pieces.size >= 3)
        assertEquals(source, TextSelection.assemble(source, pieces, pieces.indices.toSet()))
    }

    @Test fun emptyAndWhitespaceInputsProduceNoChips() {
        assertTrue(TextSelection.split("", SelectionMode.WORD).isEmpty())
        assertTrue(TextSelection.split(" \t\n", SelectionMode.WORD).isEmpty())
    }

    @Test fun limitsFailExplicitlyInsteadOfTruncating() {
        assertThrows(IllegalArgumentException::class.java) { TextSelection.split("a".repeat(10_001), SelectionMode.SENTENCE) }
        assertThrows(IllegalArgumentException::class.java) { TextSelection.split("word ".repeat(601), SelectionMode.WORD) }
        assertEquals(600, TextSelection.split("word ".repeat(600), SelectionMode.WORD).size)
    }

    @Test fun staleOrInvalidSelectionsAreRejected() {
        val pieces = TextSelection.split("hello world", SelectionMode.WORD)
        assertThrows(IllegalArgumentException::class.java) { TextSelection.assemble("other world", pieces, setOf(0)) }
        assertThrows(IllegalArgumentException::class.java) { TextSelection.assemble("hello world", pieces, setOf(2)) }
        assertThrows(IllegalArgumentException::class.java) {
            TextSelection.assemble("hello world", listOf(TextPiece(-1, 2, "x")), setOf(0))
        }
    }
}

package io.screenlingo.mobile.ui

import android.graphics.Bitmap
import io.screenlingo.mobile.core.ModelSettings
import io.screenlingo.mobile.core.SelectionMode
import io.screenlingo.mobile.core.TextPiece

enum class MobilePage { HOME, WORKSPACE, SETTINGS }

data class MobileState(
  val contentVersion: Long = 0,
  val page: MobilePage = MobilePage.HOME,
  val source: String = "",
  val sourceLabel: String = "",
  val mode: SelectionMode = SelectionMode.WORD,
  val pieces: List<TextPiece> = emptyList(),
  val selected: Set<Int> = emptySet(),
  val selection: String = "",
  val preview: Bitmap? = null,
  val imageAttachmentAvailable: Boolean = false,
  val busy: String? = null,
  val error: String? = null,
  val result: String = "",
  val resultTitle: String = "",
  val settings: ModelSettings = ModelSettings(),
  val settingsBusy: Boolean = true,
  val notice: String? = null,
)

sealed interface MobileAction {
  data object ImportImage : MobileAction
  data object Paste : MobileAction
  data object Example : MobileAction
  data object Copy : MobileAction
  data object Share : MobileAction
  data object Search : MobileAction
  data object Translate : MobileAction
  data object Cancel : MobileAction
  data object SelectAll : MobileAction
  data object ClearSelection : MobileAction
  data object ClearContent : MobileAction
  data object DismissNotice : MobileAction
  data class Navigate(val page: MobilePage) : MobileAction
  data class SetSource(val text: String) : MobileAction
  data class SetMode(val mode: SelectionMode) : MobileAction
  data class TogglePiece(val index: Int) : MobileAction
  data class Ask(val question: String, val includeImage: Boolean) : MobileAction
  data class SaveSettings(val settings: ModelSettings) : MobileAction
}

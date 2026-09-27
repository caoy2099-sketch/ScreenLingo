package io.screenlingo.mobile

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.screenlingo.mobile.core.ModelSettings
import io.screenlingo.mobile.core.SelectionMode
import io.screenlingo.mobile.core.TextSelection
import io.screenlingo.mobile.data.ImageRecognizer
import io.screenlingo.mobile.data.SettingsStore
import io.screenlingo.mobile.data.TranslationRepository
import io.screenlingo.mobile.ui.MobileAction
import io.screenlingo.mobile.ui.MobilePage
import io.screenlingo.mobile.ui.MobileState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MobileViewModel internal constructor(private val services: MobileServices) : ViewModel() {
  constructor(application: Application) : this(MobileServices.live(application))
  private val mutableState = MutableStateFlow(MobileState())
  val state = mutableState.asStateFlow()
  private var active: Job? = null
  private var revision = 0L
  private var imageJpeg: ByteArray? = null
  private var loadedSettings: ModelSettings? = null
  private var saving: Job? = null

  // A share intent can cancel content work, but must never cancel provider selection.
  private val initialization = viewModelScope.launch {
    try {
      val settings = services.loadSettings()
      loadedSettings = settings
      mutableState.update { it.copy(settings = settings) }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Exception) {
      report(error.message ?: "设置读取失败，请重新保存设置后使用翻译。")
    } finally {
      mutableState.update { it.copy(settingsBusy = false) }
    }
  }

  fun receiveImage(uri: Uri) {
    invalidateContentDialogs()
    runOperation("正在本机识别图片中的文字") {
      val image = services.readImage(uri)
      installText(image.text, "图片 · 本地识别", image.preview, image.jpeg)
    }
  }

  fun receiveText(text: String, label: String = "分享的文字") {
    cancelPending()
    invalidateContentDialogs()
    try {
      installText(text, label, null, null)
    } catch (error: IllegalArgumentException) {
      report(error.message ?: "无法处理这段文字，请缩小范围。")
    }
  }

  fun dispatch(action: MobileAction) {
    when (action) {
      MobileAction.Example -> receiveText(
        "Your session has expired. Please sign in again.\n你的登录已过期，请重新登录。\nError: CONNECTION_TIMEOUT",
        "示例文字 · 点词试试",
      )
      is MobileAction.Navigate -> mutableState.update { it.copy(page = action.page) }
      is MobileAction.SetSource -> {
        cancelPending()
        try { installText(action.text, "已编辑的文字", state.value.preview, imageJpeg) }
        catch (error: IllegalArgumentException) { report(error.message ?: "内容无法拆分，请缩小范围。") }
      }
      is MobileAction.SetMode -> {
        cancelPending()
        try {
          val current = state.value
          val pieces = TextSelection.split(current.source, action.mode)
          mutableState.update { it.copy(mode = action.mode, pieces = pieces,
            selected = pieces.indices.toSet(), selection = current.source, result = "", error = null) }
        } catch (error: IllegalArgumentException) { report(error.message ?: "内容无法拆分，请缩小范围。") }
      }
      is MobileAction.TogglePiece -> changeSelection {
        if (action.index !in it.pieces.indices) it.selected
        else if (action.index in it.selected) it.selected - action.index else it.selected + action.index
      }
      MobileAction.SelectAll -> changeSelection { it.pieces.indices.toSet() }
      MobileAction.ClearSelection -> changeSelection { emptySet() }
      MobileAction.Translate -> {
        val current = state.value
        runOperation("正在翻译选中的文字") {
          val result = services.translate(current.selection, readySettings())
          mutableState.update { it.copy(result = result, resultTitle = "中文译文") }
        }
      }
      is MobileAction.Ask -> {
        val current = state.value
        val attachment = if (action.includeImage) imageJpeg else null
        if (action.includeImage && attachment == null) {
          report(if (current.preview != null) "当前截图超过视觉模型的 2 MB 限制，请裁剪图片后重新导入。" else "当前没有图片，请先导入截图。")
          return
        }
        runOperation(if (attachment != null) "正在发送截图并提问" else "正在解释选中的文字") {
          val result = services.explain(current.selection, action.question, attachment, readySettings())
          mutableState.update { it.copy(result = result, resultTitle = "提问结果") }
        }
      }
      is MobileAction.SaveSettings -> saveSettings(action.settings)
      MobileAction.ClearContent -> {
        cancelPending()
        imageJpeg = null
        mutableState.update { MobileState(contentVersion = it.contentVersion + 1,
          settings = it.settings, settingsBusy = it.settingsBusy,
          notice = "本次内容已清空") }
      }
      MobileAction.Cancel -> {
        cancelPending()
        mutableState.update { it.copy(notice = "已取消，原有内容仍保留") }
      }
      MobileAction.DismissNotice -> mutableState.update { it.copy(notice = null) }
      else -> Unit // Android-owned import, clipboard, and share actions are handled by the activity.
    }
  }

  fun report(message: String) { mutableState.update { it.copy(error = message) } }
  fun notify(message: String) { mutableState.update { it.copy(notice = message) } }

  private fun invalidateContentDialogs() {
    mutableState.update { it.copy(contentVersion = it.contentVersion + 1) }
  }

  private suspend fun readySettings(): ModelSettings {
    initialization.join()
    saving?.join()
    return loadedSettings ?: error("设置读取失败，请先在设置中重新保存；本次没有发送内容。")
  }

  private fun saveSettings(requested: ModelSettings) {
    if (saving?.isActive == true) return
    saving = viewModelScope.launch {
      initialization.join()
      mutableState.update { it.copy(settingsBusy = true, error = null) }
      try {
        val settings = services.saveSettings(requested)
        loadedSettings = settings
        mutableState.update { it.copy(settings = settings, notice = "设置已保存") }
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (error: Exception) {
        report(error.message ?: "设置保存失败，请重试。")
      } finally {
        mutableState.update { it.copy(settingsBusy = false) }
      }
    }
  }

  private fun installText(text: String, label: String, preview: Bitmap?, jpeg: ByteArray?) {
    require(text.isNotBlank()) { "没有发现可用文字，请选择清晰截图或粘贴文字。" }
    require(text.length <= TextSelection.MAX_TEXT_LENGTH) { "内容超过 10000 个字符，请先缩小范围。" }
    var mode = state.value.mode
    var notice: String? = null
    val pieces = try {
      TextSelection.split(text, mode)
    } catch (error: IllegalArgumentException) {
      if (mode == SelectionMode.SENTENCE) throw error
      mode = SelectionMode.SENTENCE
      notice = "内容较长，已改为按句选择；原文完整保留"
      TextSelection.split(text, mode)
    }
    imageJpeg = jpeg
    mutableState.update { it.copy(page = MobilePage.WORKSPACE, source = text, sourceLabel = label,
      mode = mode, pieces = pieces, selected = pieces.indices.toSet(), selection = text,
      preview = preview, imageAttachmentAvailable = jpeg != null, result = "", resultTitle = "", error = null,
      notice = notice ?: if (preview != null && jpeg == null) "图片已识别，但尺寸过大，不能附图提问；请裁剪后重新导入" else null) }
  }

  private fun changeSelection(select: (MobileState) -> Set<Int>) {
    cancelPending()
    mutableState.update {
      val selected = select(it)
      it.copy(selected = selected, selection = TextSelection.assemble(it.source, it.pieces, selected),
        result = "", error = null)
    }
  }

  private fun cancelPending() {
    revision++
    active?.cancel()
    active = null
    mutableState.update { it.copy(busy = null) }
  }

  private fun runOperation(label: String, block: suspend () -> Unit) {
    cancelPending()
    val expected = revision
    mutableState.update { it.copy(busy = label, error = null) }
    active = viewModelScope.launch {
      try {
        block()
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (error: Exception) {
        if (expected == revision) report(error.message?.take(300) ?: "操作未完成，请重试。")
      } finally {
        if (expected == revision) mutableState.update { it.copy(busy = null) }
      }
    }
  }
}

/** Injectable boundaries keep lifecycle and provider-selection regressions testable on the JVM. */
internal class MobileServices(
  val loadSettings: suspend () -> ModelSettings,
  val saveSettings: suspend (ModelSettings) -> ModelSettings,
  val readImage: suspend (Uri) -> io.screenlingo.mobile.data.RecognizedImage,
  val translate: suspend (String, ModelSettings) -> String,
  val explain: suspend (String, String, ByteArray?, ModelSettings) -> String,
) {
  companion object {
    fun live(application: Application): MobileServices {
      val store = SettingsStore(application)
      val translator = TranslationRepository()
      val recognizer = ImageRecognizer(application)
      return MobileServices(
        loadSettings = { withContext(Dispatchers.IO) { store.load() } },
        saveSettings = { settings -> withContext(Dispatchers.IO) { store.save(settings); store.load() } },
        readImage = recognizer::read,
        translate = translator::translate,
        explain = translator::explain,
      )
    }
  }
}

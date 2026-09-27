package io.screenlingo.mobile

import android.app.SearchManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.screenlingo.mobile.core.TextSelection
import io.screenlingo.mobile.ui.MobileAction
import io.screenlingo.mobile.ui.MobilePage
import io.screenlingo.mobile.ui.MobileScreen
import io.screenlingo.mobile.ui.ScreenLingoTheme

class MainActivity : ComponentActivity() {
  private val model: MobileViewModel by viewModels {
    viewModelFactory { initializer { MobileViewModel(application) } }
  }
  private val imagePicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
    if (uri != null) model.receiveImage(uri)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      val state by model.state.collectAsStateWithLifecycle()
      ScreenLingoTheme {
        BackHandler(enabled = state.page != MobilePage.HOME) {
          model.dispatch(MobileAction.Navigate(MobilePage.HOME))
        }
        MobileScreen(state = state, onAction = ::handleAction)
      }
    }
    if (savedInstanceState == null) acceptIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    acceptIntent(intent)
  }

  private fun acceptIntent(intent: Intent) {
    try {
      when (intent.action) {
        Intent.ACTION_PROCESS_TEXT -> receiveText(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT), "选中的文字")
        Intent.ACTION_SEND -> when {
          intent.type?.startsWith("image/") == true -> {
            val uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else @Suppress("DEPRECATION") (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            if (uri != null) model.receiveImage(uri) else model.report("没有收到图片，请从相册重新分享。")
          }
          intent.type == "text/plain" -> receiveText(intent.getCharSequenceExtra(Intent.EXTRA_TEXT), "分享的文字")
          else -> model.report("暂不支持这种分享内容，请选择一张图片或一段文字。")
        }
      }
    } catch (_: Exception) {
      model.report("无法读取分享内容，请重新分享或从相册导入。")
    }
  }

  private fun receiveText(text: CharSequence?, label: String) {
    if (text == null || text.isBlank()) model.report("没有可用文字，请先复制一段内容。")
    else if (text.length > TextSelection.MAX_TEXT_LENGTH) model.report("内容超过 10000 个字符，请先缩小范围。")
    else model.receiveText(text.toString(), label)
  }

  private fun handleAction(action: MobileAction) {
    try {
      when (action) {
        MobileAction.ImportImage -> imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        MobileAction.Paste -> {
          val clip = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
          receiveText(if (clip != null && clip.itemCount > 0) clip.getItemAt(0).text else null, "粘贴的文字")
        }
        MobileAction.Copy -> withSelection { selected ->
          (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("截译选中文字", selected))
          model.notify("已复制选中文字")
        }
        MobileAction.Share -> withSelection { selected ->
          val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, selected) }
          startActivity(Intent.createChooser(send, "分享选中文字"))
        }
        MobileAction.Search -> withSelection { selected ->
          val search = Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, selected)
          try { startActivity(search) }
          catch (_: android.content.ActivityNotFoundException) {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.bing.com/search?q=" + Uri.encode(selected))))
          }
        }
        else -> model.dispatch(action)
      }
    } catch (_: Exception) {
      model.report("系统未能完成此操作，请重试或使用复制。")
    }
  }

  private fun withSelection(action: (String) -> Unit) {
    val selected = model.state.value.selection
    if (selected.isBlank()) model.report("请先点选需要处理的文字。") else action(selected)
  }
}

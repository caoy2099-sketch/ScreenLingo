package io.screenlingo.mobile.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import io.screenlingo.mobile.core.ModelSettings
import io.screenlingo.mobile.core.SelectionMode
import io.screenlingo.mobile.core.TextSelection

private const val MAX_QUESTION_LENGTH = 2000

@Composable
fun MobileScreen(state: MobileState, onAction: (MobileAction) -> Unit) {
  val snackbar = remember { SnackbarHostState() }
  var editSource by remember(state.contentVersion) { mutableStateOf(false) }
  var askQuestion by remember(state.contentVersion) { mutableStateOf(false) }
  LaunchedEffect(state.notice) {
    state.notice?.let {
      snackbar.showSnackbar(it, withDismissAction = true)
      onAction(MobileAction.DismissNotice)
    }
  }

  Scaffold(
    modifier = Modifier.fillMaxSize().imePadding(),
    containerColor = MaterialTheme.colorScheme.background,
    contentWindowInsets = WindowInsets.safeDrawing,
    snackbarHost = { SnackbarHost(snackbar) },
    bottomBar = {
      Column {
        if (state.page == MobilePage.WORKSPACE && state.source.isNotBlank()) {
          WorkspaceActionBar(state, onAction)
        }
        NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
          NavigationBarItem(
            selected = state.page == MobilePage.HOME,
            onClick = { onAction(MobileAction.Navigate(MobilePage.HOME)) },
            icon = { Icon(Icons.Outlined.TextFields, contentDescription = null) },
            label = { Text("取词") },
          )
          NavigationBarItem(
            selected = state.page == MobilePage.WORKSPACE,
            onClick = { onAction(MobileAction.Navigate(MobilePage.WORKSPACE)) },
            icon = { Icon(Icons.Outlined.GridView, contentDescription = null) },
            label = { Text("工作台") },
          )
          NavigationBarItem(
            selected = state.page == MobilePage.SETTINGS,
            onClick = { onAction(MobileAction.Navigate(MobilePage.SETTINGS)) },
            icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
            label = { Text("设置") },
          )
        }
      }
    },
  ) { padding ->
    Box(
      Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding),
      contentAlignment = Alignment.TopCenter,
    ) {
      LazyColumn(
        modifier = Modifier.widthIn(max = 720.dp).fillMaxSize(),
        contentPadding = PaddingValues(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
      ) {
        item(key = "heading") {
          when (state.page) {
            MobilePage.HOME -> Brand()
            MobilePage.WORKSPACE -> PageHeading("文字工作台", "选出你需要的，让下一步更简单。")
            MobilePage.SETTINGS -> PageHeading("按你的习惯", "配好一次，之后专注内容。")
          }
        }
        state.busy?.let { message ->
          item(key = "busy") { BusyCard(message) { onAction(MobileAction.Cancel) } }
        }
        state.error?.let { error ->
          item(key = "error") {
            ErrorCard(error, state.source.isNotBlank(), onEdit = { editSource = true }, onAction = onAction)
          }
        }
        when (state.page) {
          MobilePage.HOME -> item(key = "home") { HomeContent(state, onAction) }
          MobilePage.WORKSPACE -> {
            if (state.source.isBlank() && state.busy == null) {
              item(key = "empty") { EmptyWorkspace(onAction) }
            } else if (state.source.isNotBlank()) {
              item(key = "source") { SourceCard(state) { editSource = true } }
              item(key = "selection") { SelectionCard(state, onAction) }
              item(key = "selected") { SelectedContent(state, onAction, onAsk = { askQuestion = true }) }
              if (state.result.isNotBlank()) {
                item(key = "result") { ResultCard(state) }
              }
            }
          }
          MobilePage.SETTINGS -> item(key = "settings") { SettingsContent(state.settings, state.busy != null || state.settingsBusy, onAction) }
        }
      }
    }
  }

  if (editSource) {
    EditSourceDialog(
      source = state.source,
      onDismiss = { editSource = false },
      onSave = {
        onAction(MobileAction.SetSource(it))
        editSource = false
      },
    )
  }
  if (askQuestion) {
    AskDialog(state, onDismiss = { askQuestion = false }, onAction = {
      onAction(it)
      askQuestion = false
    })
  }
}

@Composable
private fun Brand() {
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Box(
      Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.primary),
      contentAlignment = Alignment.Center,
    ) {
      Icon(Icons.Outlined.Translate, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(25.dp))
    }
    Column {
      Text("截译", style = MaterialTheme.typography.titleLarge)
      Text("SCREENLINGO", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Spacer(Modifier.weight(1f))
    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(20.dp)) {
      Text("移动版 · 预览", Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
  }
}

@Composable
private fun HomeContent(state: MobileState, onAction: (MobileAction) -> Unit) {
  var showGuide by remember { mutableStateOf(false) }
  Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
    Column(Modifier.padding(top = 12.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text("看不懂的，\n一点就懂。", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.semantics { heading() })
      Text("截图里的外语，复制不了的文字。\n取出来，选一选，再翻译或提问。", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Card(
      onClick = { onAction(MobileAction.ImportImage) },
      enabled = state.busy == null,
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
      modifier = Modifier.fillMaxWidth(),
    ) {
      Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Icon(Icons.Outlined.AddPhotoAlternate, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Column(Modifier.weight(1f)) {
            Text("导入截图", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text("在本机识别中英文，轻点选词", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
          }
          Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
      }
    }
    OutlinedButton(
      onClick = { onAction(MobileAction.Paste) },
      enabled = state.busy == null,
      modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp),
      shape = MaterialTheme.shapes.medium,
    ) {
      Icon(Icons.Outlined.ContentPaste, null)
      Spacer(Modifier.width(10.dp))
      Text("粘贴文字", style = MaterialTheme.typography.titleMedium)
    }
    SectionCard {
      Text("先试一下", style = MaterialTheme.typography.titleMedium)
      Text("遇到英文 App 提示，不必来回切换查词。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      TextButton(onClick = { onAction(MobileAction.Example) }, enabled = state.busy == null, contentPadding = PaddingValues(horizontal = 0.dp), modifier = Modifier.heightIn(min = 48.dp)) {
        Text("打开示例文字")
        Spacer(Modifier.width(8.dp))
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, Modifier.size(18.dp))
      }
    }
    Column {
      TextButton(onClick = { showGuide = !showGuide }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text("从相册分享给截译", modifier = Modifier.weight(1f))
        Icon(if (showGuide) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, if (showGuide) "收起使用说明" else "展开使用说明")
      }
      if (showGuide) {
        Text("1. 像平时一样截屏。\n2. 在相册里打开截图，点击“分享”。\n3. 选择“截译”，识别后点选需要的文字。\n\n可选中的文字，也可以通过系统的“分享”或“截译”菜单带进来。", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Outlined.PrivacyTip, null, Modifier.size(17.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Text("识字在本机 · 翻译与提问按需联网", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun EmptyWorkspace(onAction: (MobileAction) -> Unit) {
  SectionCard {
    Icon(Icons.Outlined.TextFields, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
    Text("从一段内容开始", style = MaterialTheme.typography.titleLarge)
    Text("导入截图或粘贴文字，它们会在这里变成可以轻点选择的词句。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    Button(onClick = { onAction(MobileAction.ImportImage) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("导入截图") }
    OutlinedButton(onClick = { onAction(MobileAction.Paste) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("粘贴文字") }
  }
}

@Composable
private fun SourceCard(state: MobileState, onEdit: () -> Unit) {
  SectionCard {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text("原文", style = MaterialTheme.typography.titleMedium)
        if (state.sourceLabel.isNotBlank()) {
          Text(state.sourceLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      TextButton(onClick = onEdit, enabled = state.busy == null, modifier = Modifier.heightIn(min = 48.dp)) {
        Icon(Icons.Outlined.Edit, null, Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text("编辑")
      }
    }
    state.preview?.let { bitmap ->
      Image(
        bitmap = bitmap.asImageBitmap(),
        contentDescription = "当前导入的截图",
        modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp, max = 180.dp).clip(MaterialTheme.shapes.small),
        contentScale = ContentScale.Fit,
      )
    }
    Text("识别有误时可编辑原文；下方按词或按句选择。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SelectionCard(state: MobileState, onAction: (MobileAction) -> Unit) {
  SectionCard {
    Text("点选需要的部分", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
      FilterChip(selected = state.mode == SelectionMode.WORD, onClick = { onAction(MobileAction.SetMode(SelectionMode.WORD)) }, enabled = state.busy == null, label = { Text("按词") }, modifier = Modifier.heightIn(min = 48.dp))
      FilterChip(selected = state.mode == SelectionMode.SENTENCE, onClick = { onAction(MobileAction.SetMode(SelectionMode.SENTENCE)) }, enabled = state.busy == null, label = { Text("按句") }, modifier = Modifier.heightIn(min = 48.dp))
      TextButton(onClick = { onAction(MobileAction.SelectAll) }, enabled = state.busy == null, modifier = Modifier.heightIn(min = 48.dp)) { Text("全选") }
      TextButton(onClick = { onAction(MobileAction.ClearSelection) }, enabled = state.busy == null && state.selected.isNotEmpty(), modifier = Modifier.heightIn(min = 48.dp)) { Text("清空选择") }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      state.pieces.forEachIndexed { index, piece ->
        val selected = index in state.selected
        FilterChip(
          selected = selected,
          onClick = { onAction(MobileAction.TogglePiece(index)) },
          enabled = state.busy == null,
          modifier = Modifier.heightIn(min = 48.dp),
          label = { Text(piece.text, style = MaterialTheme.typography.bodyLarge) },
          leadingIcon = if (selected) { { Icon(Icons.Outlined.Check, null, Modifier.size(16.dp)) } } else null,
        )
      }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SelectedContent(state: MobileState, onAction: (MobileAction) -> Unit, onAsk: () -> Unit) {
  val canUseSelection = state.selection.isNotBlank() && state.busy == null
  val canAsk = state.busy == null && !state.settingsBusy &&
    (state.selection.isNotBlank() || state.imageAttachmentAvailable)
  SectionCard {
    Text("已选 ${state.selected.size} / ${state.pieces.size} 个片段", style = MaterialTheme.typography.titleMedium)
    if (state.selection.isBlank()) {
      Text("轻点上方词句，或点击“全选”。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
      SelectionContainer { Text(state.selection, style = MaterialTheme.typography.bodyLarge) }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      UtilityAction("复制", Icons.Outlined.ContentCopy, canUseSelection) { onAction(MobileAction.Copy) }
      UtilityAction("分享", Icons.Outlined.Share, canUseSelection) { onAction(MobileAction.Share) }
      UtilityAction("查找", Icons.Outlined.Search, canUseSelection) { onAction(MobileAction.Search) }
    }
    OutlinedButton(onClick = onAsk, enabled = canAsk, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
      Icon(Icons.Outlined.Forum, null, Modifier.size(20.dp))
      Spacer(Modifier.width(8.dp))
      Text(if (state.selection.isNotBlank()) "问一问这段内容" else "问一问当前截图")
    }
    TextButton(onClick = { onAction(MobileAction.ClearContent) }, enabled = state.busy == null, modifier = Modifier.heightIn(min = 48.dp)) { Text("清除本次内容") }
  }
}

@Composable
private fun WorkspaceActionBar(state: MobileState, onAction: (MobileAction) -> Unit) {
  Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 3.dp) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
      Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Button(onClick = { onAction(MobileAction.Translate) }, enabled = state.busy == null && !state.settingsBusy && state.selection.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
          Icon(Icons.Outlined.Translate, null, Modifier.size(21.dp))
          Spacer(Modifier.width(8.dp))
          Text("翻译成中文", style = MaterialTheme.typography.titleMedium)
        }
        Text(
          when {
            state.settingsBusy -> "正在读取翻译设置…"
            state.settings.model.isBlank() -> "使用必应在线翻译，只发送所选文字，无需密钥。"
            else -> "点击后将所选文字发给你配置的模型。"
          },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

@Composable
private fun ResultCard(state: MobileState) {
  SectionCard {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Icon(Icons.Outlined.AutoAwesome, null, Modifier.size(21.dp), tint = MaterialTheme.colorScheme.primary)
      Text(state.resultTitle.ifBlank { "结果" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
    }
    SelectionContainer { Text(state.result, style = MaterialTheme.typography.bodyLarge) }
    Text("长按结果可选择和复制。模型回答仅供参考。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun BusyCard(message: String, onCancel: () -> Unit) {
  Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
      Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
      TextButton(onClick = onCancel, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ErrorCard(error: String, hasSource: Boolean, onEdit: () -> Unit, onAction: (MobileAction) -> Unit) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
    Column(Modifier.fillMaxWidth().padding(18.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text("这一步没有完成", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onErrorContainer)
      Text(error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
      Text("识别失败可重新导入；调整原文或模型设置后，可再次翻译或提问。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (hasSource) TextButton(onClick = onEdit, modifier = Modifier.heightIn(min = 48.dp)) { Text("编辑原文") }
        TextButton(onClick = { onAction(MobileAction.ImportImage) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("重新导入") }
        TextButton(onClick = { onAction(MobileAction.Navigate(MobilePage.SETTINGS)) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("检查设置") }
      }
    }
  }
}

@Composable
private fun SettingsContent(settings: ModelSettings, busy: Boolean, onAction: (MobileAction) -> Unit) {
  var endpoint by remember(settings) { mutableStateOf(settings.endpoint) }
  // Credentials deliberately stay out of rememberSaveable / saved instance state.
  var apiKey by remember(settings) { mutableStateOf(settings.apiKey) }
  var model by remember(settings) { mutableStateOf(settings.model) }
  var visionModel by remember(settings) { mutableStateOf(settings.visionModel) }
  var showKey by remember { mutableStateOf(false) }
  Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
    SectionCard {
      Text("连接你的模型（可选）", style = MaterialTheme.typography.titleLarge)
      Text("默认使用必应在线翻译，无需密钥。填写文字模型后，翻译会改用该模型，也能对文字提问。模型服务需兼容 OpenAI 格式，费用由服务商收取。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(value = endpoint, onValueChange = { endpoint = it }, label = { Text("服务地址") }, placeholder = { Text("https://api.example.com/v1") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(
        value = apiKey,
        onValueChange = { apiKey = it },
        label = { Text("API Key") },
        visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        singleLine = true,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth(),
        trailingIcon = { IconButton(onClick = { showKey = !showKey }) { Icon(if (showKey) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (showKey) "隐藏 API Key" else "显示 API Key") } },
      )
      if (apiKey.isNotEmpty()) {
        TextButton(onClick = { apiKey = ""; showKey = false }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("清除密钥（保存后生效）") }
      }
      OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("文字模型名称") }, supportingText = { Text("填写准确名称；留空并保存，恢复必应翻译。") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(value = visionModel, onValueChange = { visionModel = it }, label = { Text("看图模型名称（可选）") }, supportingText = { Text("附上截图提问时使用，需要支持图片输入。") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
      Button(onClick = { onAction(MobileAction.SaveSettings(ModelSettings(endpoint, apiKey, model, visionModel))) }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(if (busy) "处理中…" else "保存设置") }
    }
    SectionCard {
      Text("内容由你掌握", style = MaterialTheme.typography.titleMedium)
      Text("截图识字在手机本地完成。翻译时，所选文字发送给必应或你配置的模型；提问时，问题和所选文字发送给你配置的模型。截图仅在提问时主动勾选“附上当前截图”后发送。", style = MaterialTheme.typography.bodyMedium)
      Text("识字组件由 Google ML Kit 提供，可能发送性能、使用指标并检查兼容性；识别的图片、文字和结果不用于这些指标上传。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text("查找会将所选文字交给手机的搜索应用；分享会打开系统分享面板，由你选择接收方。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text("不自动读取剪贴板，不持续录屏。密钥加密保存在本机，内容不保留为历史记录。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    SectionCard {
      Text("网络跟随手机", style = MaterialTheme.typography.titleMedium)
      Text("使用当前 Wi-Fi 或移动网络，遵循系统代理设置。开启系统 VPN 时，连接由系统与 VPN 应用的分流规则决定；没有开启时使用当前网络。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Text("截译 ScreenLingo · 0.1.0-alpha.1\n移动端预览版", Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun EditSourceDialog(source: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
  var draft by remember(source) { mutableStateOf(source) }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("编辑原文") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("保存后会重新拆分词句，并选中全部内容。", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(value = draft, onValueChange = { draft = it }, modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 320.dp), label = { Text("原文") }, isError = draft.length > TextSelection.MAX_TEXT_LENGTH, supportingText = { Text("${draft.length} / ${TextSelection.MAX_TEXT_LENGTH}") })
      }
    },
    confirmButton = { TextButton(onClick = { onSave(draft) }, enabled = draft.isNotBlank() && draft.length <= TextSelection.MAX_TEXT_LENGTH, modifier = Modifier.heightIn(min = 48.dp)) { Text("保存原文") } },
    dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") } },
  )
}

@Composable
private fun AskDialog(state: MobileState, onDismiss: () -> Unit, onAction: (MobileAction) -> Unit) {
  var question by remember { mutableStateOf("") }
  var includeImage by remember { mutableStateOf(false) }
  val configured = if (includeImage) state.settings.visionModel.isNotBlank() else state.settings.model.isNotBlank()
  val questionTooLong = question.length > MAX_QUESTION_LENGTH
  AlertDialog(
    onDismissRequest = onDismiss,
    icon = { Icon(Icons.Outlined.Forum, null) },
    title = { Text("问一问") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("问题和所选文字将发送给你在设置中连接的模型。", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
          value = question,
          onValueChange = { question = it },
          label = { Text("想了解什么？") },
          placeholder = { Text("这段提示是什么意思？我该怎么做？") },
          isError = questionTooLong,
          supportingText = { Text(if (questionTooLong) "问题最多支持 $MAX_QUESTION_LENGTH 个字符，请缩短后发送。" else "${question.length} / $MAX_QUESTION_LENGTH") },
          minLines = 2,
          maxLines = 5,
          modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(checked = includeImage, onCheckedChange = { includeImage = it }, enabled = state.imageAttachmentAvailable)
          Column(Modifier.weight(1f)) {
            Text("附上当前截图", style = MaterialTheme.typography.bodyMedium)
            Text(
              when {
                state.imageAttachmentAvailable -> "会发送整张导入的图片，请先检查隐私内容。"
                state.preview != null -> "图片已识别，但尺寸过大，不能附图提问；请裁剪后重新导入。"
                else -> "当前没有导入的截图。"
              },
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
        if (!configured) {
          Text(if (includeImage) "请先在设置中填写支持图片的看图模型。" else "请先在设置中填写文字模型。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
          TextButton(onClick = { onAction(MobileAction.Navigate(MobilePage.SETTINGS)) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("去设置") }
        }
      }
    },
    confirmButton = {
      val hasMaterial = state.selection.isNotBlank() || (includeImage && state.imageAttachmentAvailable)
      TextButton(
        onClick = { onAction(MobileAction.Ask(question.trim(), includeImage)) },
        enabled = question.isNotBlank() && !questionTooLong && hasMaterial && configured && state.busy == null && !state.settingsBusy,
        modifier = Modifier.heightIn(min = 48.dp),
      ) { Text("发送问题") }
    },
    dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") } },
  )
}

@Composable
private fun PageHeading(title: String, subtitle: String) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun SectionCard(content: @Composable ColumnScope.() -> Unit) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
  }
}

@Composable
private fun UtilityAction(label: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
  TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) {
    Icon(icon, null, Modifier.size(18.dp))
    Spacer(Modifier.width(6.dp))
    Text(label)
  }
}

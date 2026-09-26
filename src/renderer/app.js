'use strict';

// Keep this renderer-side guard aligned with the main-process image limit.
const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;

const elements = Object.fromEntries(
  [
    'app-shell', 'page-title', 'workspace-open', 'settings-title',
    'actionbar', 'empty-view', 'workbench', 'settings-view', 'capture-button',
    'clipboard-button', 'image-button', 'cancel-button', 'empty-capture-button',
    'empty-clipboard-button', 'empty-image-button', 'settings-open', 'settings-back',
    'theme-toggle', 'source-image', 'image-loading', 'ocr-progress-label', 'source-tabs',
    'image-tab', 'text-tab', 'image-panel', 'text-panel', 'source-text', 'confidence-label',
    'copy-source-button', 'translate-button', 'retry-button', 'copy-result-button',
    'translation-output', 'result-skeleton', 'result-error', 'error-title', 'error-message',
    'error-retry-button', 'provider-label', 'source-engine', 'rail-capture', 'rail-ocr',
    'rail-translate', 'question-form', 'question-input', 'question-submit', 'answer-output',
    'vision-state', 'status-dot', 'status-text', 'status-engine', 'privacy-state', 'toast', 'drop-overlay',
    'result-announcer',
    'settings-form', 'settings-save', 'settings-error', 'openai-fields', 'endpoint-input',
    'model-input', 'vision-model-input', 'api-key-input', 'api-key-toggle', 'api-key-clear', 'api-key-state',
    'capture-hotkey-input', 'clipboard-hotkey-input', 'auto-translate-input',
    'close-to-tray-input', 'proxy-input', 'proxy-field', 'network-check', 'network-result'
  ].map((id) => [
    id.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()),
    document.getElementById(id)
  ])
);

const state = {
  phase: 'idle',
  sourceText: '',
  translation: '',
  imageDataUrl: '',
  settings: null,
  theme: 'system',
  toastTimer: null,
  toastRevealTimer: null,
  dragDepth: 0,
  announcementTimer: null,
  removeApiKey: false
};

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  window.clearTimeout(state.toastRevealTimer);
  elements.toast.hidden = true;
  elements.toast.textContent = '';
  state.toastRevealTimer = window.setTimeout(() => {
    elements.toast.textContent = String(message || '');
    elements.toast.hidden = false;
    state.toastRevealTimer = null;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3200);
  }, 0);
}

function applyTheme(theme) {
  state.theme = theme || 'system';
  const resolved = state.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : state.theme;
  document.documentElement.dataset.theme = resolved;
  const nextThemeLabel = resolved === 'dark' ? '切换至浅色主题' : '切换至深色主题';
  elements.themeToggle.title = nextThemeLabel;
  elements.themeToggle.setAttribute('aria-label', nextThemeLabel);
}

function setStatus(message, tone = 'ready') {
  elements.statusText.textContent = message;
  elements.statusDot.classList.toggle('busy', tone === 'busy');
  elements.statusDot.classList.toggle('error', tone === 'error');
}

function readLocalImage(file, fallbackMessage) {
  if (file.size > MAX_LOCAL_IMAGE_BYTES) {
    const message = '图片超过 20 MB，请先裁剪或压缩后重试。';
    showToast(message);
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => runAction(
    () => window.screenLingo.submitImage(String(reader.result)),
    fallbackMessage
  ));
  reader.addEventListener('error', () => {
    const message = `${fallbackMessage}。请确认图片可以正常打开。`;
    showToast(message);
    setStatus(message, 'error');
  });
  reader.readAsDataURL(file);
}

function announceResult(label, text) {
  window.clearTimeout(state.announcementTimer);
  elements.resultAnnouncer.textContent = '';
  const content = String(text || '').trim();
  if (!content) return;
  state.announcementTimer = window.setTimeout(() => {
    elements.resultAnnouncer.textContent = `${label}：${content}`;
    state.announcementTimer = null;
  }, 50);
}

function setApiKeyVisibility(show) {
  elements.apiKeyInput.type = show ? 'text' : 'password';
  const label = show ? '隐藏 API Key' : '显示 API Key';
  elements.apiKeyToggle.setAttribute('aria-label', label);
  elements.apiKeyToggle.setAttribute('aria-pressed', String(show));
  elements.apiKeyToggle.title = label;
  elements.apiKeyToggle.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
  refreshIcons();
}

function setBusy(isBusy) {
  elements.cancelButton.hidden = !isBusy;
  [
    elements.captureButton, elements.clipboardButton, elements.imageButton,
    elements.emptyCaptureButton, elements.emptyClipboardButton, elements.emptyImageButton,
    elements.translateButton, elements.retryButton, elements.errorRetryButton
  ]
    .forEach((button) => { button.disabled = isBusy; });
}

function selectSourceTab(tab) {
  const showImage = tab === 'image' && Boolean(state.imageDataUrl);
  elements.imageTab.classList.toggle('active', showImage);
  elements.textTab.classList.toggle('active', !showImage);
  elements.imageTab.setAttribute('aria-selected', String(showImage));
  elements.textTab.setAttribute('aria-selected', String(!showImage));
  elements.imageTab.tabIndex = showImage ? 0 : -1;
  elements.textTab.tabIndex = showImage ? -1 : 0;
  elements.imagePanel.hidden = !showImage;
  elements.textPanel.hidden = showImage;
  elements.imagePanel.tabIndex = showImage ? 0 : -1;
  elements.textPanel.tabIndex = showImage ? -1 : 0;
}

function handleSourceTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [elements.imageTab, elements.textTab].filter((tab) => !tab.disabled);
  const currentIndex = tabs.indexOf(event.target);
  if (currentIndex === -1) return;
  event.preventDefault();
  let nextIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else nextIndex = (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  selectSourceTab(nextTab === elements.imageTab ? 'image' : 'text');
  nextTab.focus();
}

function updateViewNavigation(view) {
  const isSettings = view === 'settings';
  elements.appShell.dataset.view = view;
  elements.pageTitle.textContent = isSettings ? '偏好设置' : '翻译工作台';
  const currentLink = isSettings ? elements.settingsOpen : elements.workspaceOpen;
  const otherLink = isSettings ? elements.workspaceOpen : elements.settingsOpen;
  currentLink.setAttribute('aria-current', 'page');
  otherLink.removeAttribute('aria-current');
}

function showWorkbench() {
  elements.emptyView.hidden = true;
  elements.settingsView.hidden = true;
  elements.workbench.hidden = false;
  elements.actionbar.hidden = false;
  updateViewNavigation('workbench');
}

function showSettings() {
  elements.emptyView.hidden = true;
  elements.workbench.hidden = true;
  elements.settingsView.hidden = false;
  elements.actionbar.hidden = false;
  populateSettings(state.settings);
  updateViewNavigation('settings');
  elements.settingsTitle.focus();
}

function hideSettings() {
  elements.settingsView.hidden = true;
  elements.actionbar.hidden = false;
  const hasSource = Boolean(state.imageDataUrl || state.sourceText);
  elements.workbench.hidden = !hasSource;
  elements.emptyView.hidden = hasSource;
  updateViewNavigation(hasSource ? 'workbench' : 'empty');
  elements.workspaceOpen.focus();
}

function showInlineError(title, message) {
  elements.errorTitle.textContent = title || '处理失败';
  elements.errorMessage.textContent = message || '请重试。';
  elements.resultError.hidden = false;
  elements.resultSkeleton.hidden = true;
}

function clearInlineError() {
  elements.resultError.hidden = true;
  elements.errorTitle.textContent = '';
  elements.errorMessage.textContent = '';
}

function updateRail(phase) {
  const ocrDone = ['translating', 'ready', 'asking', 'answered'].includes(phase);
  const translationDone = ['ready', 'asking', 'answered'].includes(phase);
  elements.railCapture.classList.toggle('active', phase !== 'idle');
  elements.railOcr.classList.toggle('active', ocrDone);
  elements.railTranslate.classList.toggle('active', translationDone);
}

function applyWorkflowUpdate(update) {
  if (!update || typeof update !== 'object') return;
  if (update.reset) {
    window.clearTimeout(state.announcementTimer);
    state.announcementTimer = null;
    elements.resultAnnouncer.textContent = '';
    state.sourceText = '';
    state.translation = '';
    elements.sourceText.value = '';
    elements.translationOutput.textContent = '';
    elements.answerOutput.textContent = '';
    elements.answerOutput.hidden = true;
    elements.confidenceLabel.textContent = '';
    elements.confidenceLabel.hidden = true;
    clearInlineError();
  }

  if (typeof update.imageDataUrl === 'string') {
    state.imageDataUrl = update.imageDataUrl;
    elements.sourceImage.src = update.imageDataUrl;
    elements.imageTab.disabled = !update.imageDataUrl;
    showWorkbench();
    selectSourceTab(update.imageDataUrl ? 'image' : 'text');
  }

  if (typeof update.sourceText === 'string') {
    state.sourceText = update.sourceText;
    elements.sourceText.value = update.sourceText;
    if (!state.imageDataUrl) selectSourceTab('text');
  }

  if (typeof update.translation === 'string') {
    state.translation = update.translation;
    elements.translationOutput.textContent = update.translation;
    announceResult('翻译结果', update.translation);
  }

  if (typeof update.answer === 'string') {
    elements.answerOutput.textContent = update.answer;
    elements.answerOutput.hidden = false;
    announceResult('截图回答', update.answer);
  }

  if (Number.isFinite(update.confidence)) {
    elements.confidenceLabel.hidden = false;
    elements.confidenceLabel.textContent = `OCR ${Math.round(update.confidence)}%`;
  }

  if (typeof update.providerLabel === 'string') {
    elements.providerLabel.textContent = update.providerLabel;
  }
  if (typeof update.networkLabel === 'string') {
    elements.statusEngine.textContent = `本地 OCR · ${update.networkLabel}`;
  }

  if (typeof update.phase === 'string') {
    state.phase = update.phase;
    const isBusy = ['capturing', 'ocr', 'translating', 'asking'].includes(update.phase);
    setBusy(isBusy);
    elements.imageLoading.hidden = update.phase !== 'ocr';
    elements.resultSkeleton.hidden = update.phase !== 'translating';
    elements.translationOutput.hidden = update.phase === 'translating';
    elements.questionSubmit.disabled = update.phase === 'asking';
    updateRail(update.phase);
  }

  if (Number.isFinite(update.progress)) {
    elements.ocrProgressLabel.textContent = `正在识别 ${Math.round(update.progress * 100)}%`;
  }

  if (update.error) {
    const title = update.error.title || '处理失败';
    const message = update.error.message || String(update.error);
    showInlineError(title, message);
    setStatus(message, 'error');
  } else if (update.statusMessage) {
    setStatus(update.statusMessage, ['capturing', 'ocr', 'translating', 'asking'].includes(update.phase) ? 'busy' : 'ready');
  }
}

async function runAction(action, fallbackMessage) {
  clearInlineError();
  try {
    const result = await action();
    if (result?.cancelled) return result;
    if (result && result.ok === false) {
      throw new Error(result.error || fallbackMessage);
    }
    return result;
  } catch (error) {
    const message = error?.message || fallbackMessage;
    showInlineError(fallbackMessage, message);
    if (elements.workbench.hidden) showToast(message);
    setStatus(message, 'error');
    return null;
  }
}

async function translateCurrentText() {
  const text = elements.sourceText.value.trim();
  if (!text) {
    showToast('没有可翻译的文字');
    selectSourceTab('text');
    elements.sourceText.focus();
    return;
  }
  state.sourceText = text;
  await runAction(() => window.screenLingo.translateText(text), '翻译失败');
}

async function copyText(text, label) {
  if (!text) {
    showToast('没有可复制的内容');
    return;
  }
  try {
    const result = await window.screenLingo.copyText(text);
    if (result?.ok === false) throw new Error(result.error || '复制失败。');
    showToast(label);
  } catch (error) {
    const message = error?.message || '复制失败。';
    showToast(message);
  }
}

function populateSettings(settings) {
  if (!settings) return;
  state.settings = settings;
  const provider = settings.provider || 'bing';
  const providerInput = elements.settingsForm.querySelector(`input[name="provider"][value="${provider}"]`);
  if (providerInput) providerInput.checked = true;
  elements.endpointInput.value = settings.endpoint || '';
  elements.modelInput.value = settings.model || '';
  elements.visionModelInput.value = settings.visionModel || '';
  elements.apiKeyInput.value = '';
  state.removeApiKey = false;
  setApiKeyVisibility(false);
  elements.apiKeyInput.placeholder = settings.hasApiKey ? '••••••••••••' : '';
  elements.apiKeyState.textContent = settings.hasApiKey ? '密钥已加密保存' : '';
  elements.apiKeyClear.hidden = !settings.hasApiKey;
  elements.captureHotkeyInput.value = settings.screenshotHotkey || 'Alt+Shift+S';
  elements.clipboardHotkeyInput.value = settings.clipboardHotkey || 'Alt+Shift+T';
  for (const [shortcut, value] of [
    ['capture', elements.captureHotkeyInput.value],
    ['clipboard', elements.clipboardHotkeyInput.value]
  ]) {
    document.querySelectorAll(`[data-shortcut="${shortcut}"]`).forEach((label) => {
      label.textContent = value.replace(/\s*\+\s*/g, ' + ');
    });
  }
  elements.autoTranslateInput.checked = settings.autoTranslate !== false;
  elements.closeToTrayInput.checked = settings.closeToTray !== false;
  const themeInput = elements.settingsForm.querySelector(`input[name="theme"][value="${settings.theme || 'system'}"]`);
  if (themeInput) themeInput.checked = true;
  const networkInput = elements.settingsForm.querySelector(`input[name="networkMode"][value="${settings.networkMode || 'auto'}"]`);
  if (networkInput) networkInput.checked = true;
  elements.proxyInput.value = settings.proxyUrl || 'socks5://127.0.0.1:10808';
  updateNetworkFields();
  updateProviderFields();
}

function updateNetworkFields() {
  const mode = new FormData(elements.settingsForm).get('networkMode') || 'auto';
  elements.proxyField.hidden = !['auto', 'manual'].includes(mode);
  elements.networkResult.textContent = '';
}

async function checkNetwork() {
  elements.networkCheck.disabled = true;
  try {
    const form = new FormData(elements.settingsForm);
    const result = await window.screenLingo.getNetworkStatus({
      provider: String(form.get('provider') || 'bing'), endpoint: elements.endpointInput.value,
      networkMode: String(form.get('networkMode') || 'auto'), proxyUrl: elements.proxyInput.value
    });
    elements.networkResult.textContent = result.ok ? `当前路由：${result.label}` : result.error;
  } catch (error) {
    elements.networkResult.textContent = error.message;
  } finally { elements.networkCheck.disabled = false; }
}

function updateProviderFields() {
  const provider = new FormData(elements.settingsForm).get('provider') || 'bing';
  const openAI = provider === 'openai';
  elements.openaiFields.hidden = !openAI;
  elements.visionState.textContent = openAI ? '视觉模型' : '需配置视觉模型';
  elements.privacyState.querySelector('span').textContent = openAI ? '本地 OCR · 自选服务' : '本地 OCR';
}

async function saveSettings(event) {
  event.preventDefault();
  elements.settingsError.hidden = true;
  elements.settingsSave.disabled = true;
  const form = new FormData(elements.settingsForm);
  const payload = {
    provider: String(form.get('provider') || 'bing'),
    networkMode: String(form.get('networkMode') || 'auto'),
    proxyUrl: elements.proxyInput.value.trim(),
    endpoint: elements.endpointInput.value.trim(),
    model: elements.modelInput.value.trim(),
    visionModel: elements.visionModelInput.value.trim(),
    screenshotHotkey: elements.captureHotkeyInput.value.trim(),
    clipboardHotkey: elements.clipboardHotkeyInput.value.trim(),
    autoTranslate: elements.autoTranslateInput.checked,
    closeToTray: elements.closeToTrayInput.checked,
    theme: String(form.get('theme') || 'system')
  };
  if (elements.apiKeyInput.value) payload.apiKey = elements.apiKeyInput.value;
  else if (state.removeApiKey) payload.apiKey = '';

  try {
    const result = await window.screenLingo.saveSettings(payload);
    if (!result?.ok) throw new Error(result?.error || '设置保存失败。');
    state.settings = result.settings;
    applyTheme(result.settings.theme);
    populateSettings(result.settings);
    showToast('设置已保存');
    hideSettings();
  } catch (error) {
    elements.settingsError.textContent = error?.message || '设置保存失败。';
    elements.settingsError.hidden = false;
  } finally {
    elements.settingsSave.disabled = false;
  }
}

function bindActions() {
  const capture = () => runAction(() => window.screenLingo.captureScreen(), '截图失败');
  const clipboard = () => runAction(() => window.screenLingo.translateClipboard(), '读取剪贴板失败');
  const chooseImage = () => runAction(() => window.screenLingo.chooseImage(), '打开图片失败');

  [elements.captureButton, elements.emptyCaptureButton].forEach((button) => button.addEventListener('click', capture));
  [elements.clipboardButton, elements.emptyClipboardButton].forEach((button) => button.addEventListener('click', clipboard));
  [elements.imageButton, elements.emptyImageButton].forEach((button) => button.addEventListener('click', chooseImage));

  elements.cancelButton.addEventListener('click', () => window.screenLingo.cancelTask());
  elements.settingsOpen.addEventListener('click', showSettings);
  elements.workspaceOpen.addEventListener('click', hideSettings);
  elements.settingsBack.addEventListener('click', hideSettings);
  elements.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
  elements.imageTab.addEventListener('click', () => selectSourceTab('image'));
  elements.textTab.addEventListener('click', () => selectSourceTab('text'));
  elements.sourceTabs.addEventListener('keydown', handleSourceTabKeydown);
  elements.translateButton.addEventListener('click', translateCurrentText);
  elements.retryButton.addEventListener('click', translateCurrentText);
  elements.errorRetryButton.addEventListener('click', translateCurrentText);
  elements.copySourceButton.addEventListener('click', () => copyText(elements.sourceText.value, '原文已复制'));
  elements.copyResultButton.addEventListener('click', () => copyText(state.translation, '译文已复制'));

  elements.questionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = elements.questionInput.value.trim();
    if (!question) return;
    const result = await runAction(() => window.screenLingo.askScreenshot(question), '提问失败');
    if (result?.ok) elements.questionInput.value = '';
  });

  elements.settingsForm.addEventListener('change', (event) => {
    if (event.target.name === 'provider') updateProviderFields();
    if (event.target.name === 'theme') applyTheme(event.target.value);
    if (event.target.name === 'networkMode') updateNetworkFields();
  });
  elements.networkCheck.addEventListener('click', checkNetwork);
  elements.settingsForm.addEventListener('submit', saveSettings);

  window.addEventListener('dragenter', (event) => {
    const hasImage = [...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!hasImage) return;
    event.preventDefault();
    state.dragDepth += 1;
    elements.dropOverlay.hidden = false;
  });

  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) {
      state.dragDepth = 0;
      elements.dropOverlay.hidden = true;
      return;
    }
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) elements.dropOverlay.hidden = true;
  });

  elements.apiKeyToggle.addEventListener('click', () => {
    const show = elements.apiKeyInput.type === 'password';
    setApiKeyVisibility(show);
  });
  elements.apiKeyClear.addEventListener('click', () => {
    state.removeApiKey = true;
    elements.apiKeyInput.value = '';
    elements.apiKeyInput.placeholder = '';
    elements.apiKeyClear.hidden = true;
    elements.apiKeyState.textContent = '保存后清除密钥';
  });

  elements.sourceText.addEventListener('input', () => {
    state.sourceText = elements.sourceText.value;
  });
  elements.sourceText.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      translateCurrentText();
    }
  });

  window.addEventListener('paste', (event) => {
    const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    readLocalImage(file, '读取粘贴图片失败');
  });

  window.addEventListener('dragover', (event) => {
    if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) {
      event.preventDefault();
    }
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    state.dragDepth = 0;
    elements.dropOverlay.hidden = true;
    const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'));
    if (!file) {
      showToast('仅支持拖入图片文件');
      return;
    }
    readLocalImage(file, '读取图片失败');
  });
}

async function initialize() {
  refreshIcons();
  bindActions();
  updateViewNavigation('empty');
  selectSourceTab('text');
  window.screenLingo.onWorkflowUpdate(applyWorkflowUpdate);
  window.screenLingo.onNavigate((target) => {
    if (target === 'settings') showSettings();
    else hideSettings();
  });
  systemTheme.addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });

  try {
    state.settings = await window.screenLingo.getSettings();
    applyTheme(state.settings?.theme || 'system');
    populateSettings(state.settings);
    elements.providerLabel.textContent = { openai: 'OpenAI 兼容', bing: '必应', google: 'Google' }[state.settings?.provider] || '必应';
  } catch {
    applyTheme('system');
  }
}

initialize();

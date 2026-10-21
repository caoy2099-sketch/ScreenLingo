'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  session
} = require('electron');
const { CaptureService } = require('./capture-service');
const { inspectImageDataUrl } = require('./image-service');
const { NetworkService } = require('./network-service');
const { OcrCancelledError, OcrService, validateImageDataUrl } = require('./ocr-service');
const { QuickResultService, resolveQuickTheme } = require('./quick-result-service');
const { SelectionService } = require('./selection-service');
const { SettingsStore, normalizeSettingsPatch } = require('./settings-store');
const { TranslationService } = require('./translation-service');
const { WindowsShellIntegration } = require('./windows-shell-integration');

const APP_NAME = '截译 ScreenLingo';
const MAX_CLIPBOARD_TEXT_LENGTH = 60_000;
const MAX_OPEN_IMAGE_BYTES = 20 * 1024 * 1024;
const QUICK_ACTIONS = new Set(['capture', 'clipboard', 'selection']);
const SUPPORTED_IMAGE_EXTENSIONS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp']
]);

let mainWindow = null;
let tray = null;
let captureService = null;
let ocrService = null;
let translationService = null;
let networkService = null;
let settingsStore = null;
let quickResultService = null;
let selectionService = null;
let shellIntegration = null;
let shellIntegrationDisabled = false;
let appInitialized = false;
let pendingQuickAction = parseQuickAction(process.argv);
let suppressAutoShow = Boolean(pendingQuickAction);
let quitting = false;
let workflowRevision = 0;
let workflowAbortController = null;
let lastImageDataUrl = '';
let lastSourceText = '';
let lastTranslation = '';
let registeredHotkeys = [];
let mainRendererReady = false;
let pendingWorkflowUpdates = [];
const MAX_PENDING_WORKFLOW_UPDATES = 200;

function parseQuickAction(argv) {
  if (!Array.isArray(argv)) return null;
  for (const argument of argv) {
    if (typeof argument !== 'string' || !argument.startsWith('--quick-action=')) continue;
    const action = argument.slice('--quick-action='.length).trim().toLowerCase();
    if (QUICK_ACTIONS.has(action)) return action;
  }
  return null;
}

function quickTheme() {
  if (!settingsStore) return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return resolveQuickTheme(settingsStore.get().theme, nativeTheme.shouldUseDarkColors);
}

function getPublicSettings() {
  return {
    ...settingsStore.getPublic(),
    integrationStatus: shellIntegration?.getStatus() || {
      supported: process.platform === 'win32',
      installed: false,
      error: ''
    }
  };
}

function createTrayImage() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  return image.resize({ width: 20, height: 20, quality: 'best' });
}

function isMainSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function assertMainSender(event) {
  if (!isMainSender(event)) {
    throw new Error('拒绝来自未知窗口的请求。');
  }
}

function sendWorkflowUpdate(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainRendererReady) {
    pendingWorkflowUpdates.push(payload);
    if (pendingWorkflowUpdates.length > MAX_PENDING_WORKFLOW_UPDATES) {
      pendingWorkflowUpdates.splice(0, pendingWorkflowUpdates.length - MAX_PENDING_WORKFLOW_UPDATES);
    }
    return;
  }
  mainWindow.webContents.send('workflow:update', payload);
}

function markMainRendererReady() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainRendererReady = true;
  const queued = pendingWorkflowUpdates;
  pendingWorkflowUpdates = [];
  for (const update of queued) {
    mainWindow.webContents.send('workflow:update', update);
  }
}

function serializeError(error, fallbackTitle = '处理失败') {
  let message = error?.message || String(error || '未知错误');
  if (error?.code === 'OCR_WORKER_ERROR') {
    message = `本地 OCR 启动失败：${message}`;
  }
  return { title: fallbackTitle, message: message.slice(0, 800), code: error?.code || 'UNKNOWN' };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function showMainWindow() {
  quickResultService?.dismiss();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showMainWindowWhenReady() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.once('ready-to-show', showMainWindow);
    return;
  }
  showMainWindow();
}

function openSettingsWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const navigate = () => mainWindow?.webContents.send('app:navigate', 'settings');
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', navigate);
  } else {
    navigate();
  }
  showMainWindowWhenReady();
}

function beginWorkflow(phase, { reset = false } = {}) {
  workflowRevision += 1;
  workflowAbortController?.abort();
  workflowAbortController = new AbortController();
  ocrService?.cancelLatest('superseded');
  const revision = workflowRevision;
  sendWorkflowUpdate({ phase, reset, statusMessage: phase === 'capturing' ? '拖动鼠标框选报错区域' : '正在处理' });
  return { revision, signal: workflowAbortController.signal };
}

function isCurrentWorkflow(revision, signal) {
  return revision === workflowRevision && !signal.aborted;
}

function cancelWorkflow({ notify = true } = {}) {
  workflowRevision += 1;
  workflowAbortController?.abort();
  workflowAbortController = null;
  ocrService?.cancelLatest('cancelled');
  captureService?.cancel();
  if (notify) {
    sendWorkflowUpdate({ phase: lastSourceText ? 'ready' : 'idle', statusMessage: '已停止' });
  }
}

function providerLabel(settings) {
  return { openai: 'OpenAI 兼容', bing: '必应', google: 'Google' }[settings.provider] || settings.provider;
}

function providerUrl(settings) {
  if (settings.provider === 'openai') return settings.endpoint;
  return settings.provider === 'google' ? 'https://translate.googleapis.com' : 'https://cn.bing.com';
}

async function translateWithinWorkflow(text, task) {
  if (!isCurrentWorkflow(task.revision, task.signal)) return null;
  const normalized = String(text || '').trim();
  if (!normalized) throw new Error('没有识别到可翻译的文字，请切换到“识别文本”手动修正。');
  if (normalized.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    throw new Error(`文字过长，最多支持 ${MAX_CLIPBOARD_TEXT_LENGTH} 个字符。`);
  }

  const settings = settingsStore.get();
  const route = await networkService.resolve(settings, providerUrl(settings), { signal: task.signal });
  if (!isCurrentWorkflow(task.revision, task.signal)) return null;
  sendWorkflowUpdate({
    phase: 'translating',
    sourceText: normalized,
    translation: '',
    providerLabel: providerLabel(settings),
    networkLabel: route.label,
    statusMessage: '正在翻译'
  });
  const translation = await translationService.translateText({
    text: normalized,
    provider: settings.provider,
    endpoint: settings.endpoint,
    apiKey: settings.apiKey,
    model: settings.model,
    fetchImpl: route.fetchImpl,
    sourceLanguage: 'auto',
    targetLanguage: settings.provider === 'google' ? 'zh-CN' : '简体中文',
    signal: task.signal
  });

  if (!isCurrentWorkflow(task.revision, task.signal)) return null;
  lastSourceText = normalized;
  lastTranslation = translation;
  sendWorkflowUpdate({
    phase: 'ready',
    sourceText: normalized,
    translation,
    providerLabel: providerLabel(settings),
    statusMessage: '翻译完成'
  });
  return translation;
}

async function processImage(imageDataUrl, existingTask = null, { presentation = 'workspace', anchor = null } = {}) {
  const task = existingTask || beginWorkflow('ocr', { reset: true });
  const useOverlay = presentation === 'overlay' && Boolean(anchor);
  if (useOverlay) {
    quickResultService?.showCaptureLoading(anchor, { theme: quickTheme() });
  }
  validateImageDataUrl(imageDataUrl);
  inspectImageDataUrl(imageDataUrl);
  lastImageDataUrl = imageDataUrl;
  lastSourceText = '';
  lastTranslation = '';
  if (!useOverlay) {
    showMainWindow();
  }
  sendWorkflowUpdate({
    phase: 'ocr',
    reset: true,
    imageDataUrl,
    statusMessage: '正在本地识别图片文字',
    progress: 0
  });

  const result = await ocrService.recognize(imageDataUrl, {
    signal: task.signal,
    onProgress(update) {
      if (!isCurrentWorkflow(task.revision, task.signal)) return;
      if (useOverlay) {
        quickResultService?.showCaptureProgress(anchor, {
          progress: update.progress,
          message: '正在本地识别屏幕文字'
        });
      }
      sendWorkflowUpdate({
        phase: 'ocr',
        progress: update.progress,
        statusMessage: '正在本地识别图片文字'
      });
    }
  });

  if (!isCurrentWorkflow(task.revision, task.signal)) return null;
  lastSourceText = result.text;
  sendWorkflowUpdate({
    phase: settingsStore.get().autoTranslate ? 'translating' : 'ready',
    sourceText: result.text,
    confidence: result.confidence,
    statusMessage: result.text ? '文字识别完成' : '没有识别到文字'
  });

  if (!result.text) {
    throw new Error('没有识别到文字。请缩小范围、提高截图清晰度，或在“识别文本”中手动粘贴。');
  }
  if (settingsStore.get().autoTranslate) {
    if (useOverlay) {
      quickResultService?.showCaptureProgress(anchor, {
        progress: 1,
        message: '正在翻译'
      });
    }
    const translation = await translateWithinWorkflow(result.text, task);
    if (useOverlay && translation && isCurrentWorkflow(task.revision, task.signal)) {
      quickResultService?.showCaptureResult(anchor, {
        translation,
        sourceText: lastSourceText,
        providerLabel: providerLabel(settingsStore.get()),
        theme: quickTheme()
      });
    }
  }
  return result;
}

async function runCaptureWorkflow({ presentation = 'workspace' } = {}) {
  const allowOverlay = presentation === 'overlay' && settingsStore.get().autoTranslate !== false;
  const task = beginWorkflow('capturing');
  quickResultService?.hideAll();
  const wasVisible = Boolean(mainWindow?.isVisible());
  if (wasVisible) {
    mainWindow.hide();
    await wait(140);
    if (!isCurrentWorkflow(task.revision, task.signal)) return { ok: false, cancelled: true };
  }

  let captureAnchor = null;
  try {
    const capture = await captureService.captureCurrentDisplay();
    if (!isCurrentWorkflow(task.revision, task.signal)) return { ok: false, cancelled: true };
    if (!capture) {
      if (wasVisible) showMainWindow();
      sendWorkflowUpdate({ phase: lastSourceText ? 'ready' : 'idle', statusMessage: '已取消截图' });
      return { ok: true, cancelled: true };
    }
    captureAnchor = capture.screenRect;
    await processImage(capture.dataUrl, task, allowOverlay
      ? { presentation: 'overlay', anchor: captureAnchor }
      : {});
    return { ok: true };
  } catch (error) {
    if (error instanceof OcrCancelledError || error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    const serialized = serializeError(error, '截图处理失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    if (allowOverlay && captureAnchor) {
      quickResultService?.showCaptureError(captureAnchor, serialized, { theme: quickTheme() });
      return { ok: false, error: serialized.message };
    }
    showMainWindow();
    return { ok: false, error: serialized.message };
  }
}

async function runClipboardWorkflow({ presentation = 'workspace' } = {}) {
  const usePanel = presentation === 'panel';
  const cursor = usePanel ? screen.getCursorScreenPoint() : null;
  const text = clipboard.readText('clipboard').trim();
  if (!text) {
    const message = '剪贴板里没有文字。请先复制报错，再按剪贴板翻译热键。';
    if (usePanel) {
      quickResultService?.hideAll();
      quickResultService?.resetSuppression();
      cancelWorkflow();
      quickResultService?.showPanelError(cursor, {
        title: '剪贴板翻译',
        message,
        theme: quickTheme()
      });
      return { ok: false, error: message };
    }
    showMainWindow();
    sendWorkflowUpdate({ phase: lastSourceText ? 'ready' : 'idle', error: { title: '没有可翻译内容', message } });
    return { ok: false, error: message };
  }
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    const message = `剪贴板文字过长，最多支持 ${MAX_CLIPBOARD_TEXT_LENGTH} 个字符。`;
    if (usePanel) {
      quickResultService?.hideAll();
      quickResultService?.resetSuppression();
      cancelWorkflow();
      quickResultService?.showPanelError(cursor, {
        title: '内容过长',
        message,
        theme: quickTheme()
      });
      return { ok: false, error: message };
    }
    showMainWindow();
    sendWorkflowUpdate({ phase: 'error', error: { title: '内容过长', message } });
    return { ok: false, error: message };
  }

  const task = beginWorkflow('translating', { reset: true });
  captureService?.cancel();
  lastImageDataUrl = '';
  lastSourceText = text;
  lastTranslation = '';
  if (usePanel) {
    quickResultService?.hideAll();
    quickResultService?.showPanelLoading(cursor, {
      title: '剪贴板翻译',
      meta: '剪贴板',
      message: '正在翻译剪贴板文字',
      theme: quickTheme()
    });
  } else {
    showMainWindow();
  }
  sendWorkflowUpdate({ phase: 'translating', reset: true, imageDataUrl: '', sourceText: text, statusMessage: '正在翻译剪贴板文字' });
  try {
    const translation = await translateWithinWorkflow(text, task);
    if (usePanel && translation) {
      quickResultService?.showPanelResult(cursor, {
        title: '剪贴板翻译',
        meta: providerLabel(settingsStore.get()),
        translation,
        sourceText: text,
        providerLabel: providerLabel(settingsStore.get()),
        theme: quickTheme()
      });
    }
    return { ok: true };
  } catch (error) {
    if (error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    const serialized = serializeError(error, '翻译失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    if (usePanel) {
      quickResultService?.showPanelError(cursor, {
        title: '剪贴板翻译',
        message: serialized.message,
        theme: quickTheme()
      });
      return { ok: false, error: serialized.message };
    }
    return { ok: false, error: serialized.message };
  }
}

async function runTextWorkflow(text, {
  presentation = 'workspace',
  title = '选中文本',
  cursor = null,
  allowClipboardFallback = false
} = {}) {
  const usePanel = presentation === 'panel';
  const anchor = usePanel ? (cursor || screen.getCursorScreenPoint()) : null;
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    const message = '没有可翻译的文字。';
    if (usePanel) {
      quickResultService?.resetSuppression();
      quickResultService?.showPanelError(anchor, {
        title,
        message,
        theme: quickTheme(),
        allowClipboardFallback
      });
    }
    return { ok: false, error: message };
  }

  const task = beginWorkflow('translating');
  captureService?.cancel();
  lastSourceText = normalized;
  lastTranslation = '';
  if (usePanel) {
    quickResultService?.hideAll();
    quickResultService?.showPanelLoading(anchor, {
      title,
      meta: '已读取选区',
      message: '正在翻译选中文本',
      theme: quickTheme()
    });
    lastImageDataUrl = '';
    sendWorkflowUpdate({
      phase: 'translating',
      reset: true,
      imageDataUrl: '',
      sourceText: normalized,
      statusMessage: '正在翻译选中文本'
    });
  }
  try {
    const translation = await translateWithinWorkflow(normalized, task);
    if (usePanel && translation) {
      quickResultService?.showPanelResult(anchor, {
        title,
        meta: providerLabel(settingsStore.get()),
        translation,
        sourceText: normalized,
        providerLabel: providerLabel(settingsStore.get()),
        theme: quickTheme()
      });
    }
    return { ok: true };
  } catch (error) {
    if (error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    const serialized = serializeError(error, '翻译失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    if (usePanel) {
      quickResultService?.showPanelError(anchor, {
        title,
        message: serialized.message,
        theme: quickTheme(),
        allowClipboardFallback
      });
      return { ok: false, error: serialized.message };
    }
    return { ok: false, error: serialized.message };
  }
}

async function runSelectionWorkflow() {
  quickResultService?.hideAll();
  quickResultService?.resetSuppression();
  cancelWorkflow();
  const readRevision = workflowRevision;
  const cursor = screen.getCursorScreenPoint();
  const selected = await selectionService.readSelectedText();
  if (readRevision !== workflowRevision) return { ok: false, cancelled: true };
  if (!selected.ok) {
    quickResultService?.showPanelError(cursor, {
      title: '选中文本',
      message: selected.error,
      theme: quickTheme(),
      allowClipboardFallback: true
    });
    return { ok: false, error: selected.error };
  }
  return runTextWorkflow(selected.text, {
    presentation: 'panel',
    title: '选中文本',
    cursor,
    allowClipboardFallback: true
  });
}

async function handleQuickAction(action) {
  if (action === 'capture') return runCaptureWorkflow({ presentation: 'overlay' });
  if (action === 'clipboard') return runClipboardWorkflow({ presentation: 'panel' });
  if (action === 'selection') return runSelectionWorkflow();
  showMainWindow();
  return { ok: true };
}

async function runQuestionWorkflow(question) {
  const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
  if (!lastImageDataUrl) return { ok: false, error: '请先框选截图或打开一张图片。' };
  if (!normalizedQuestion) return { ok: false, error: '请输入关于截图的问题。' };

  const settings = settingsStore.get();
  if (settings.provider !== 'openai') {
    return { ok: false, error: '截图提问需要在设置中选择 OpenAI 兼容服务，并配置视觉模型。' };
  }

  const task = beginWorkflow('asking');
  sendWorkflowUpdate({ phase: 'asking', statusMessage: '正在分析截图' });
  try {
    const route = await networkService.resolve(settings, settings.endpoint, { signal: task.signal });
    if (!isCurrentWorkflow(task.revision, task.signal)) return { ok: false, cancelled: true };
    sendWorkflowUpdate({ networkLabel: route.label });
    const answer = await translationService.askScreenshot({
      provider: settings.provider,
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      fetchImpl: route.fetchImpl,
      visionModel: settings.visionModel,
      imageDataUrl: lastImageDataUrl,
      sourceText: lastSourceText,
      question: normalizedQuestion,
      signal: task.signal,
      timeoutMs: 90_000
    });
    if (!isCurrentWorkflow(task.revision, task.signal)) return { ok: false, cancelled: true };
    sendWorkflowUpdate({ phase: 'answered', answer, statusMessage: '截图分析完成' });
    return { ok: true };
  } catch (error) {
    if (error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    const serialized = serializeError(error, '截图提问失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    return { ok: false, error: serialized.message };
  }
}

async function readImageFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_IMAGE_EXTENSIONS.get(extension);
  if (!mimeType) throw new Error('只支持 PNG、JPEG、WebP 或 BMP 图片。');
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('所选图片无法读取。');
  if (stat.size > MAX_OPEN_IMAGE_BYTES) throw new Error('图片超过 20 MB，请先裁剪后重试。');
  const bytes = await fs.promises.readFile(filePath);
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  validateImageDataUrl(dataUrl);
  return dataUrl;
}

async function chooseImageWorkflow() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开报错截图',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
  try {
    await processImage(await readImageFile(result.filePaths[0]));
    return { ok: true };
  } catch (error) {
    if (error instanceof OcrCancelledError || error?.code === 'ABORTED') return { ok: false, cancelled: true };
    const serialized = serializeError(error, '图片处理失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    return { ok: false, error: serialized.message };
  }
}

async function submitImageWorkflow(imageDataUrl) {
  try {
    await processImage(imageDataUrl);
    return { ok: true };
  } catch (error) {
    if (error instanceof OcrCancelledError || error?.code === 'ABORTED') return { ok: false, cancelled: true };
    const serialized = serializeError(error, '图片处理失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    return { ok: false, error: serialized.message };
  }
}

function unregisterHotkeys() {
  for (const accelerator of registeredHotkeys) globalShortcut.unregister(accelerator);
  registeredHotkeys = [];
}

function registerHotkeys(settings) {
  unregisterHotkeys();
  const definitions = [
    [settings.screenshotHotkey, () => runCaptureWorkflow({ presentation: 'overlay' }), '截图翻译'],
    [settings.clipboardHotkey, () => runClipboardWorkflow({ presentation: 'panel' }), '剪贴板翻译'],
    [settings.selectionHotkey, runSelectionWorkflow, '选中文本翻译']
  ];
  const seen = new Set();
  try {
    for (const [accelerator, handler, label] of definitions) {
      const normalized = String(accelerator || '').trim();
      if (!normalized) continue;
      if (seen.has(normalized.toLowerCase())) throw new Error('两个功能不能使用同一个快捷键。');
      seen.add(normalized.toLowerCase());
      if (!globalShortcut.register(normalized, () => void handler())) {
        throw new Error(`${label}快捷键“${normalized}”已被其他程序占用。`);
      }
      registeredHotkeys.push(normalized);
    }
  } catch (error) {
    unregisterHotkeys();
    throw error;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#f4f7f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  mainRendererReady = false;
  pendingWorkflowUpdates = [];

  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('did-start-loading', () => {
    mainRendererReady = false;
  });
  mainWindow.webContents.on('did-finish-load', markMainRendererReady);
  mainWindow.on('close', (event) => {
    if (!quitting && settingsStore.get().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    mainRendererReady = false;
    pendingWorkflowUpdates = [];
  });
  mainWindow.once('ready-to-show', () => {
    if (!suppressAutoShow) mainWindow?.show();
  });
  void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开截译', click: showMainWindow },
    { type: 'separator' },
    { label: '截屏翻译', click: () => void runCaptureWorkflow({ presentation: 'overlay' }) },
    { label: '翻译选中文本', click: () => void runSelectionWorkflow() },
    { label: '翻译剪贴板', click: () => void runClipboardWorkflow({ presentation: 'panel' }) },
    { type: 'separator' },
    {
      label: '设置',
      click: openSettingsWindow
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip(APP_NAME);
  tray.on('click', showMainWindowWhenReady);
  rebuildTrayMenu();
}

function registerIpcHandlers() {
  ipcMain.handle('workflow:capture', (event) => {
    assertMainSender(event);
    return runCaptureWorkflow();
  });
  ipcMain.handle('workflow:clipboard', (event) => {
    assertMainSender(event);
    return runClipboardWorkflow();
  });
  ipcMain.handle('workflow:choose-image', (event) => {
    assertMainSender(event);
    return chooseImageWorkflow();
  });
  ipcMain.handle('workflow:submit-image', (event, imageDataUrl) => {
    assertMainSender(event);
    return submitImageWorkflow(imageDataUrl);
  });
  ipcMain.handle('workflow:translate-text', (event, text) => {
    assertMainSender(event);
    return runTextWorkflow(text);
  });
  ipcMain.handle('workflow:ask', (event, question) => {
    assertMainSender(event);
    return runQuestionWorkflow(question);
  });
  ipcMain.handle('workflow:cancel', (event) => {
    assertMainSender(event);
    cancelWorkflow();
    return { ok: true };
  });
  ipcMain.handle('settings:get', (event) => {
    assertMainSender(event);
    return getPublicSettings();
  });
  ipcMain.handle('quick:ready', (event) => {
    if (!quickResultService?.acceptsSender(event.sender)) {
      throw new Error('拒绝来自未知窗口的快速结果请求。');
    }
    return quickResultService.ready(event.sender);
  });
  ipcMain.handle('quick:action', (event, action) => {
    if (!quickResultService?.acceptsSender(event.sender)) {
      throw new Error('拒绝来自未知窗口的快速结果操作。');
    }
    return quickResultService.handleAction(action);
  });
  ipcMain.handle('network:status', async (event, patch = {}) => {
    assertMainSender(event);
    try {
      const settings = { ...settingsStore.getPublic(), ...normalizeSettingsPatch(patch) };
      const route = await networkService.resolve(settings, providerUrl(settings));
      return { ok: true, label: route.label };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('settings:save', async (event, patch) => {
    assertMainSender(event);
    try {
      const normalized = normalizeSettingsPatch(patch);
      if (Object.hasOwn(patch, 'apiKey')) {
        if (patch.apiKey && !safeStorage.isEncryptionAvailable()) {
          throw new Error('Windows 安全存储当前不可用，API Key 未保存。');
        }
        normalized.apiKey = patch.apiKey;
      }
      const previous = settingsStore.get();
      const candidate = { ...previous, ...normalized };
      let integrationChanged = false;
      try {
        registerHotkeys(candidate);
        if (
          Object.hasOwn(normalized, 'shellIntegration')
          && normalized.shellIntegration !== previous.shellIntegration
          && !shellIntegrationDisabled
        ) {
          const applied = await shellIntegration.apply(normalized.shellIntegration);
          if (!applied.ok) throw new Error(applied.error || 'Windows 右键菜单更新失败。');
          integrationChanged = true;
        }
        const publicSettings = settingsStore.update(normalized);
        quickResultService?.updateTheme(publicSettings.theme);
        return { ok: true, settings: { ...publicSettings, integrationStatus: shellIntegration?.getStatus() || null } };
      } catch (error) {
        if (integrationChanged) {
          try {
            await shellIntegration.apply(previous.shellIntegration);
          } catch {
            // Keep the original save error; the next launch reconciles the registry.
          }
        }
        try {
          registerHotkeys(previous);
        } catch (rollbackError) {
          error.message = `${error.message} 原快捷键恢复失败：${rollbackError.message}`;
        }
        throw error;
      }
    } catch (error) {
      return { ok: false, error: error?.message || '设置保存失败。' };
    }
  });
  ipcMain.handle('clipboard:write', (event, text) => {
    assertMainSender(event);
    if (typeof text !== 'string' || !text || text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
      return { ok: false, error: '复制内容为空或过长。' };
    }
    clipboard.writeText(text);
    return { ok: true };
  });
  ipcMain.handle('window:show-main', (event) => {
    assertMainSender(event);
    showMainWindow();
    return { ok: true };
  });
  ipcMain.handle('capture:complete', (event, selection) => {
    if (!captureService.acceptsSender(event.sender)) throw new Error('拒绝来自未知窗口的截图请求。');
    captureService.complete(selection);
    return { ok: true };
  });
  ipcMain.handle('capture:cancel', (event) => {
    if (!captureService.acceptsSender(event.sender)) throw new Error('拒绝来自未知窗口的截图请求。');
    captureService.cancel();
    return { ok: true };
  });
}

async function initialize() {
  settingsStore = new SettingsStore({
    filePath: path.join(app.getPath('userData'), 'settings.json'),
    cryptoAdapter: safeStorage
  });
  translationService = new TranslationService();
  networkService = new NetworkService({ session });
  ocrService = new OcrService({
    projectRoot: path.join(__dirname, '..', '..'),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    workerPath: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'ocr-worker.js')
      : path.join(__dirname, 'ocr-worker.js')
  });
  captureService = new CaptureService({
    BrowserWindow,
    desktopCapturer,
    screen,
    preloadPath: path.join(__dirname, 'preload.js'),
    capturePagePath: path.join(__dirname, '..', 'renderer', 'capture.html')
  });
  selectionService = new SelectionService({
    scriptPath: app.isPackaged
      ? path.join(process.resourcesPath, 'selection-reader.ps1')
      : path.join(__dirname, 'selection-reader.ps1')
  });
  quickResultService = new QuickResultService({
    BrowserWindow,
    screen,
    preloadPath: path.join(__dirname, 'quick-preload.js'),
    pagePath: path.join(__dirname, '..', 'renderer', 'quick.html'),
    copyText: (text) => clipboard.writeText(text),
    showWorkspace: showMainWindowWhenReady,
    translateClipboard: () => void runClipboardWorkflow({ presentation: 'panel' }),
    resolveTheme: (theme = settingsStore.get().theme) =>
      resolveQuickTheme(theme, nativeTheme.shouldUseDarkColors)
  });
  shellIntegrationDisabled = Boolean(process.env.SCREENLINGO_DISABLE_SHELL_INTEGRATION);
  shellIntegration = new WindowsShellIntegration({
    execPath: process.execPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpcHandlers();
  createMainWindow();
  createTray();

  if (!shellIntegrationDisabled) {
    const integrationEnabled = settingsStore.get().shellIntegration;
    void (integrationEnabled ? shellIntegration.install() : shellIntegration.remove()).then((integrationResult) => {
      if (!integrationResult.ok) {
        sendWorkflowUpdate({
          phase: 'idle',
          error: { title: 'Windows 右键菜单不可用', message: integrationResult.error }
        });
      }
      sendWorkflowUpdate({ integrationStatus: shellIntegration.getStatus() });
    });
  }

  try {
    registerHotkeys(settingsStore.get());
  } catch (error) {
    sendWorkflowUpdate({ phase: 'idle', error: { title: '快捷键不可用', message: error.message } });
  }

  nativeTheme.on('updated', () => {
    if (settingsStore?.get().theme === 'system') quickResultService?.updateTheme('system');
  });

  appInitialized = true;
  const queuedAction = pendingQuickAction;
  pendingQuickAction = null;
  if (queuedAction === 'show') {
    showMainWindowWhenReady();
  } else if (queuedAction) {
    void handleQuickAction(queuedAction);
  }
}

function handleSecondInstance(_event, argv) {
  const action = parseQuickAction(argv);
  if (!appInitialized) {
    pendingQuickAction = action || 'show';
    suppressAutoShow = true;
    return;
  }
  if (action) {
    void handleQuickAction(action);
  } else {
    showMainWindowWhenReady();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', handleSecondInstance);
  app.whenReady().then(initialize).catch((error) => {
    dialog.showErrorBox(APP_NAME, `启动失败：${error?.message || error}`);
    app.quit();
  });
}

app.on('activate', showMainWindowWhenReady);
app.on('before-quit', () => {
  quitting = true;
  unregisterHotkeys();
  cancelWorkflow({ notify: false });
  quickResultService?.dispose();
  captureService?.dispose();
  void ocrService?.destroy();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = {
  APP_NAME,
  MAX_CLIPBOARD_TEXT_LENGTH,
  MAX_OPEN_IMAGE_BYTES,
  handleQuickAction,
  parseQuickAction,
  providerLabel
};

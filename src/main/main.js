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
  safeStorage,
  screen,
  session
} = require('electron');
const { CaptureService } = require('./capture-service');
const { inspectImageDataUrl } = require('./image-service');
const { NetworkService } = require('./network-service');
const { OcrCancelledError, OcrService, validateImageDataUrl } = require('./ocr-service');
const { DEFAULT_SETTINGS, SettingsStore, normalizeSettingsPatch } = require('./settings-store');
const { TranslationError, TranslationService } = require('./translation-service');

const APP_NAME = '截译 ScreenLingo';
const MAX_CLIPBOARD_TEXT_LENGTH = 60_000;
const MAX_OPEN_IMAGE_BYTES = 20 * 1024 * 1024;
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
let quitting = false;
let workflowRevision = 0;
let workflowAbortController = null;
let lastImageDataUrl = '';
let lastSourceText = '';
let lastTranslation = '';
let registeredHotkeys = [];

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
  mainWindow.webContents.send('workflow:update', payload);
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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

async function processImage(imageDataUrl, existingTask = null) {
  const task = existingTask || beginWorkflow('ocr', { reset: true });
  validateImageDataUrl(imageDataUrl);
  inspectImageDataUrl(imageDataUrl);
  lastImageDataUrl = imageDataUrl;
  lastSourceText = '';
  lastTranslation = '';
  showMainWindow();
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
    await translateWithinWorkflow(result.text, task);
  }
  return result;
}

async function runCaptureWorkflow() {
  const task = beginWorkflow('capturing');
  const wasVisible = Boolean(mainWindow?.isVisible());
  if (wasVisible) {
    mainWindow.hide();
    await wait(140);
  }

  try {
    const capture = await captureService.captureCurrentDisplay();
    if (!isCurrentWorkflow(task.revision, task.signal)) return { ok: false, cancelled: true };
    if (!capture) {
      if (wasVisible) showMainWindow();
      sendWorkflowUpdate({ phase: lastSourceText ? 'ready' : 'idle', statusMessage: '已取消截图' });
      return { ok: true, cancelled: true };
    }
    await processImage(capture.dataUrl, task);
    return { ok: true };
  } catch (error) {
    if (error instanceof OcrCancelledError || error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    showMainWindow();
    const serialized = serializeError(error, '截图处理失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    return { ok: false, error: serialized.message };
  }
}

async function runClipboardWorkflow() {
  const text = clipboard.readText('clipboard').trim();
  if (!text) {
    const message = '剪贴板里没有文字。请先复制报错，再按剪贴板翻译热键。';
    showMainWindow();
    sendWorkflowUpdate({ phase: lastSourceText ? 'ready' : 'idle', error: { title: '没有可翻译内容', message } });
    return { ok: false, error: message };
  }
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    const message = `剪贴板文字过长，最多支持 ${MAX_CLIPBOARD_TEXT_LENGTH} 个字符。`;
    showMainWindow();
    sendWorkflowUpdate({ phase: 'error', error: { title: '内容过长', message } });
    return { ok: false, error: message };
  }

  const task = beginWorkflow('translating', { reset: true });
  lastImageDataUrl = '';
  lastSourceText = text;
  lastTranslation = '';
  showMainWindow();
  sendWorkflowUpdate({ phase: 'translating', reset: true, imageDataUrl: '', sourceText: text, statusMessage: '正在翻译剪贴板文字' });
  try {
    await translateWithinWorkflow(text, task);
    return { ok: true };
  } catch (error) {
    if (error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    const serialized = serializeError(error, '翻译失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    return { ok: false, error: serialized.message };
  }
}

async function runTextWorkflow(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) return { ok: false, error: '没有可翻译的文字。' };
  const task = beginWorkflow('translating');
  lastSourceText = normalized;
  lastTranslation = '';
  try {
    await translateWithinWorkflow(normalized, task);
    return { ok: true };
  } catch (error) {
    if (error?.code === 'ABORTED' || !isCurrentWorkflow(task.revision, task.signal)) {
      return { ok: false, cancelled: true };
    }
    const serialized = serializeError(error, '翻译失败');
    sendWorkflowUpdate({ phase: 'error', error: serialized });
    return { ok: false, error: serialized.message };
  }
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
    [settings.screenshotHotkey, runCaptureWorkflow, '截图翻译'],
    [settings.clipboardHotkey, runClipboardWorkflow, '剪贴板翻译']
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

  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('close', (event) => {
    if (!quitting && settingsStore.get().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开截译', click: showMainWindow },
    { label: '框选截图', click: () => void runCaptureWorkflow() },
    { label: '翻译剪贴板', click: () => void runClipboardWorkflow() },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        showMainWindow();
        mainWindow?.webContents.send('app:navigate', 'settings');
      }
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
  tray.on('click', showMainWindow);
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
    return settingsStore.getPublic();
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
  ipcMain.handle('settings:save', (event, patch) => {
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
      try {
        registerHotkeys(candidate);
        const publicSettings = settingsStore.update(normalized);
        return { ok: true, settings: publicSettings };
      } catch (error) {
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

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpcHandlers();
  createMainWindow();
  createTray();

  try {
    registerHotkeys(settingsStore.get());
  } catch (error) {
    sendWorkflowUpdate({ phase: 'idle', error: { title: '快捷键不可用', message: error.message } });
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(initialize).catch((error) => {
    dialog.showErrorBox(APP_NAME, `启动失败：${error?.message || error}`);
    app.quit();
  });
}

app.on('activate', showMainWindow);
app.on('before-quit', () => {
  quitting = true;
  unregisterHotkeys();
  cancelWorkflow({ notify: false });
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
  providerLabel
};

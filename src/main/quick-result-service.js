'use strict';

const MAX_QUICK_TEXT_LENGTH = 60_000;
const MAX_QUICK_MESSAGE_LENGTH = 800;
const PANEL_WIDTH = 380;
const PANEL_MIN_HEIGHT = 92;
const PANEL_MAX_HEIGHT = 420;
const OVERLAY_MIN_WIDTH = 340;
const OVERLAY_MIN_HEIGHT = 148;
const OVERLAY_MAX_WIDTH = 780;
const OVERLAY_MAX_HEIGHT = 620;
const SCREEN_GAP = 8;
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 16;
const VALID_THEMES = new Set(['light', 'dark']);
const VALID_ACTIONS = new Set(['close', 'copy', 'workspace', 'translate-clipboard', 'resize']);

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') {
    throw new TypeError('缺少快速窗口位置。');
  }
  const width = Math.max(1, finiteInteger(rect.width, 0));
  const height = Math.max(1, finiteInteger(rect.height, 0));
  return {
    x: finiteInteger(rect.x, 0),
    y: finiteInteger(rect.y, 0),
    width,
    height
  };
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') {
    throw new TypeError('缺少光标位置。');
  }
  return { x: finiteInteger(point.x, 0), y: finiteInteger(point.y, 0) };
}

function normalizeWorkArea(workArea) {
  const area = normalizeRect(workArea);
  return {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    right: area.x + area.width,
    bottom: area.y + area.height
  };
}

function keepInside(rect, workArea) {
  const area = normalizeWorkArea(workArea);
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  return {
    x: Math.max(area.x, Math.min(rect.x, area.right - width)),
    y: Math.max(area.y, Math.min(rect.y, area.bottom - height)),
    width,
    height
  };
}

function computeOverlayBounds(anchor, workArea) {
  const rect = normalizeRect(anchor);
  const area = normalizeWorkArea(workArea);
  const width = Math.min(Math.max(rect.width, OVERLAY_MIN_WIDTH), OVERLAY_MAX_WIDTH, area.width);
  const height = Math.min(Math.max(rect.height, OVERLAY_MIN_HEIGHT), OVERLAY_MAX_HEIGHT, area.height);
  return keepInside({ x: rect.x, y: rect.y, width, height }, area);
}

function computePanelBounds(cursor, workArea, height = 190, width = PANEL_WIDTH) {
  const point = normalizePoint(cursor);
  const area = normalizeWorkArea(workArea);
  const panelWidth = Math.min(Math.max(finiteInteger(width, PANEL_WIDTH), 280), area.width);
  const panelHeight = Math.min(Math.max(finiteInteger(height, 190), PANEL_MIN_HEIGHT), PANEL_MAX_HEIGHT, area.height);
  let x = point.x + CURSOR_OFFSET_X;
  let y = point.y + CURSOR_OFFSET_Y;
  if (x + panelWidth > area.right - SCREEN_GAP) x = point.x - panelWidth - CURSOR_OFFSET_X;
  if (y + panelHeight > area.bottom - SCREEN_GAP) y = point.y - panelHeight - CURSOR_OFFSET_Y;
  return keepInside({ x, y, width: panelWidth, height: panelHeight }, area);
}

function computePanelResize(bounds, requestedHeight, workArea) {
  const current = normalizeRect(bounds);
  const height = Math.min(
    Math.max(finiteInteger(requestedHeight, current.height), PANEL_MIN_HEIGHT),
    PANEL_MAX_HEIGHT,
    normalizeWorkArea(workArea).height
  );
  return keepInside({ ...current, height }, workArea);
}

function resolveQuickTheme(theme, systemPrefersDark) {
  if (VALID_THEMES.has(theme)) return theme;
  return systemPrefersDark ? 'dark' : 'light';
}

function compactText(value, maxLength = MAX_QUICK_TEXT_LENGTH) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength);
}

function compactMessage(value) {
  const message = typeof value === 'string' ? value.trim() : '';
  return message.slice(0, MAX_QUICK_MESSAGE_LENGTH);
}

class QuickResultService {
  constructor({
    BrowserWindow,
    screen,
    preloadPath,
    pagePath,
    copyText,
    showWorkspace,
    translateClipboard,
    resolveTheme
  }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.preloadPath = preloadPath;
    this.pagePath = pagePath;
    this.copyText = copyText;
    this.showWorkspace = showWorkspace;
    this.translateClipboard = translateClipboard;
    this.resolveTheme = resolveTheme || ((theme) => resolveQuickTheme(theme, false));
    this.window = null;
    this.state = null;
    this.anchor = null;
    this.panelCursor = null;
    this.suppressResults = false;
  }

  getWindow() {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  acceptsSender(webContents) {
    const window = this.getWindow();
    return Boolean(window && window.webContents === webContents);
  }

  getStateFor(webContents) {
    if (!this.acceptsSender(webContents) || !this.state) return null;
    return { ...this.state };
  }

  ready(webContents) {
    const state = this.getStateFor(webContents);
    return state ? { ok: true, state } : { ok: false, error: '快速窗口已关闭。' };
  }

  resetSuppression() {
    this.suppressResults = false;
  }

  getWorkArea(anchor) {
    const display = this.screen.getDisplayMatching(normalizeRect(anchor));
    return display?.workArea || display?.bounds || { x: 0, y: 0, width: 1280, height: 720 };
  }

  themeFor(preferredTheme) {
    return resolveQuickTheme(this.resolveTheme(preferredTheme), false);
  }

  createWindow(mode, bounds, theme) {
    const isOverlay = mode === 'overlay';
    const backgroundColor = theme === 'dark' ? '#23212f' : '#fbfaff';
    const window = new this.BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: false,
      backgroundColor,
      show: false,
      title: '截译',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: true,
      roundedCorners: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        webSecurity: true
      }
    });

    this.window = window;
    window.setMenu(null);
    window.setAlwaysOnTop(true, isOverlay ? 'floating' : 'pop-up-menu');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.once('ready-to-show', () => {
      if (this.window !== window || window.isDestroyed()) return;
      window.showInactive();
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null;
        this.state = null;
        this.anchor = null;
        this.panelCursor = null;
        this.suppressResults = true;
      }
    });
    void window.loadFile(this.pagePath).catch((error) => {
      if (this.window === window) this.dismiss();
      console.error(`快速结果窗口加载失败：${error?.message || error}`);
    });
    return window;
  }

  recreateWindow(mode, bounds, theme) {
    this.dismiss();
    return this.createWindow(mode, bounds, theme);
  }

  setState(patch) {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    const window = this.getWindow();
    if (!window) return;
    try {
      window.webContents.send('quick:state', this.state);
      window.setBackgroundColor(this.state.theme === 'dark' ? '#23212f' : '#fbfaff');
    } catch {
      // The page may be navigating or closing; the next ready handshake repairs state.
    }
  }

  buildCaptureState(theme, patch) {
    return {
      mode: 'overlay',
      phase: 'loading',
      theme: this.themeFor(theme),
      title: '截图翻译',
      meta: '本地 OCR',
      message: '正在识别屏幕文字',
      progress: null,
      translation: '',
      sourceText: '',
      providerLabel: '',
      allowClipboardFallback: false,
      ...patch
    };
  }

  showCaptureLoading(anchor, { theme } = {}) {
    const safeAnchor = normalizeRect(anchor);
    const bounds = computeOverlayBounds(safeAnchor, this.getWorkArea(safeAnchor));
    this.suppressResults = false;
    const state = this.buildCaptureState(theme);
    if (this.window && this.state?.mode === 'overlay') {
      this.anchor = safeAnchor;
      this.window.setBounds(bounds);
      this.setState(state);
      return;
    }
    this.anchor = safeAnchor;
    this.state = state;
    this.createWindow('overlay', bounds, state.theme);
  }

  showCaptureProgress(anchor, { theme, progress, message } = {}) {
    if (this.suppressResults) return;
    if (!this.state || this.state.mode !== 'overlay' || !this.getWindow()) {
      this.showCaptureLoading(anchor, { theme });
      return;
    }
    this.setState({
      phase: 'loading',
      message: compactMessage(message) || '正在翻译',
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null
    });
  }

  showCaptureResult(anchor, { translation, sourceText, providerLabel, theme } = {}) {
    if (this.suppressResults) return;
    const safeAnchor = normalizeRect(anchor || this.anchor);
    const bounds = computeOverlayBounds(safeAnchor, this.getWorkArea(safeAnchor));
    const provider = compactText(providerLabel, 120);
    const state = this.buildCaptureState(theme, {
      phase: 'result',
      meta: provider ? `本地 OCR · ${provider}` : '本地 OCR',
      message: '',
      translation: compactText(translation),
      sourceText: compactText(sourceText),
      providerLabel: provider || '在线翻译'
    });
    this.anchor = safeAnchor;
    if (!this.window || this.state?.mode !== 'overlay') {
      this.state = state;
      this.createWindow('overlay', bounds, state.theme);
      return;
    }
    this.state = state;
    this.getWindow().setBounds(bounds);
    this.setState(state);
  }

  showCaptureError(anchor, error, { theme } = {}) {
    if (this.suppressResults) return;
    const safeAnchor = normalizeRect(anchor || this.anchor);
    const errorAnchor = { ...safeAnchor, height: Math.min(safeAnchor.height, 190) };
    const bounds = computeOverlayBounds(errorAnchor, this.getWorkArea(safeAnchor));
    const state = this.buildCaptureState(theme, {
      phase: 'error',
      meta: '处理失败',
      title: typeof error?.title === 'string' ? compactMessage(error.title) : '截图翻译失败',
      message: compactMessage(error?.message || String(error || '请重试。')),
      translation: ''
    });
    this.anchor = safeAnchor;
    if (!this.window || this.state?.mode !== 'overlay') {
      this.state = state;
      this.createWindow('overlay', bounds, state.theme);
      return;
    }
    this.state = state;
    this.getWindow().setBounds(bounds);
    this.setState(state);
  }

  buildPanelState(theme, patch) {
    return {
      mode: 'panel',
      phase: 'loading',
      theme: this.themeFor(theme),
      title: '选中文本',
      meta: '正在读取选区',
      message: '正在读取选中文本',
      progress: null,
      translation: '',
      sourceText: '',
      providerLabel: '',
      allowClipboardFallback: false,
      ...patch
    };
  }

  showPanelLoading(cursor, { theme, title = '选中文本', meta = '正在读取选区', message = '正在读取选中文本', allowClipboardFallback = false } = {}) {
    const point = normalizePoint(cursor || this.panelCursor);
    const bounds = computePanelBounds(point, this.getWorkArea(point), 160);
    this.suppressResults = false;
    const state = this.buildPanelState(theme, {
      title,
      meta,
      message,
      allowClipboardFallback
    });
    this.panelCursor = point;
    if (this.window && this.state?.mode === 'panel' && !this.window.isDestroyed()) {
      this.state = state;
      this.setState(state);
      return;
    }
    this.state = state;
    this.createWindow('panel', bounds, state.theme);
  }

  showPanelResult(cursor, { translation, sourceText, providerLabel, theme, title = '选中文本', meta } = {}) {
    if (this.suppressResults) return;
    const point = normalizePoint(cursor || this.panelCursor);
    const state = this.buildPanelState(theme, {
      phase: 'result',
      title,
      meta: compactText(meta, 120) || compactText(providerLabel, 120) || '在线翻译',
      message: '',
      translation: compactText(translation),
      sourceText: compactText(sourceText),
      providerLabel: compactText(providerLabel, 120)
    });
    this.panelCursor = point;
    if (!this.window || this.state?.mode !== 'panel') {
      this.state = state;
      const bounds = computePanelBounds(point, this.getWorkArea(point), 190);
      this.createWindow('panel', bounds, state.theme);
      return;
    }
    this.state = state;
    this.setState(state);
  }

  showPanelError(cursor, error, {
    theme,
    title = '选中文本翻译',
    allowClipboardFallback = false
  } = {}) {
    if (this.suppressResults) return;
    const point = normalizePoint(cursor || this.panelCursor);
    const state = this.buildPanelState(theme, {
      phase: 'error',
      title,
      meta: '未完成',
      message: compactMessage(error?.message || String(error || '请重试。')),
      allowClipboardFallback
    });
    this.panelCursor = point;
    if (!this.window || this.state?.mode !== 'panel') {
      this.state = state;
      const bounds = computePanelBounds(point, this.getWorkArea(point), 178);
      this.createWindow('panel', bounds, state.theme);
      return;
    }
    this.state = state;
    this.setState(state);
  }

  resizePanel(requestedHeight) {
    const window = this.getWindow();
    if (!window || this.state?.mode !== 'panel') return { ok: false, error: '当前窗口不可调整。' };
    const currentBounds = window.getBounds();
    const bounds = computePanelResize(
      currentBounds,
      requestedHeight,
      this.getWorkArea(currentBounds)
    );
    window.setBounds(bounds);
    this.anchor = bounds;
    return { ok: true };
  }

  async handleAction(action) {
    if (!action || typeof action !== 'object' || !VALID_ACTIONS.has(action.type)) {
      return { ok: false, error: '未知的窗口操作。' };
    }
    if (action.type === 'close') {
      this.dismiss();
      return { ok: true };
    }
    if (action.type === 'workspace') {
      this.dismiss();
      this.showWorkspace?.();
      return { ok: true };
    }
    if (action.type === 'copy') {
      const translation = this.state?.translation || '';
      if (!translation) return { ok: false, error: '没有可复制的译文。' };
      this.copyText?.(translation);
      return { ok: true };
    }
    if (action.type === 'translate-clipboard') {
      if (!this.state?.allowClipboardFallback) return { ok: false, error: '当前没有可用的剪贴板翻译入口。' };
      this.dismiss();
      this.translateClipboard?.();
      return { ok: true };
    }
    if (action.type === 'resize') {
      return this.resizePanel(action.height);
    }
    return { ok: false, error: '未知的窗口操作。' };
  }

  updateTheme(preferredTheme) {
    if (!this.state) return;
    const theme = resolveQuickTheme(this.resolveTheme(preferredTheme), false);
    this.state.theme = theme;
    const window = this.getWindow();
    if (!window) return;
    window.setBackgroundColor(theme === 'dark' ? '#23212f' : '#fbfaff');
    try {
      window.webContents.send('quick:state', this.state);
    } catch {
      // Ignore a closing renderer; the handshake will provide the latest state.
    }
  }

  dismiss() {
    const window = this.getWindow();
    this.suppressResults = true;
    this.window = null;
    this.state = null;
    this.anchor = null;
    this.panelCursor = null;
    if (window) window.destroy();
  }

  hideAll() {
    this.dismiss();
  }

  dispose() {
    this.dismiss();
  }
}

module.exports = {
  MAX_QUICK_MESSAGE_LENGTH,
  MAX_QUICK_TEXT_LENGTH,
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MAX_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_MIN_WIDTH,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_WIDTH,
  QuickResultService,
  computeOverlayBounds,
  computePanelBounds,
  computePanelResize,
  keepInside,
  normalizeRect,
  resolveQuickTheme
};

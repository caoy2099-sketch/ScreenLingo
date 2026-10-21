'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  QuickResultService,
  computeOverlayBounds,
  computePanelBounds,
  computePanelResize,
  resolveQuickTheme
} = require('../src/main/quick-result-service');

const WORK_AREA = { x: 0, y: 0, width: 1280, height: 720 };

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.openHandler = null;
  }

  setWindowOpenHandler(handler) {
    this.openHandler = handler;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }
}

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height
    };
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.shown = false;
    this.menu = undefined;
    this.alwaysOnTop = null;
    this.backgroundColor = options.backgroundColor;
  }

  setMenu(menu) {
    this.menu = menu;
  }

  setAlwaysOnTop(value, level) {
    this.alwaysOnTop = { value, level };
  }

  showInactive() {
    this.shown = true;
    this.emit('ready-to-show');
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }

  loadFile(filePath) {
    this.loadedFile = filePath;
    queueMicrotask(() => this.emit('ready-to-show'));
    return Promise.resolve();
  }

  setBounds(bounds) {
    this.bounds = { ...bounds };
  }

  getBounds() {
    return { ...this.bounds };
  }

  setBackgroundColor(color) {
    this.backgroundColor = color;
  }
}

function createHarness(overrides = {}) {
  const windows = [];
  function FakeBrowserWindow(options) {
    const window = new FakeWindow(options);
    windows.push(window);
    return window;
  }
  const screen = {
    getDisplayMatching: () => ({ bounds: WORK_AREA, workArea: WORK_AREA })
  };
  const calls = { copy: [], workspace: 0, clipboard: 0 };
  const service = new QuickResultService({
    BrowserWindow: FakeBrowserWindow,
    screen,
    preloadPath: 'quick-preload.js',
    pagePath: 'quick.html',
    copyText: (text) => calls.copy.push(text),
    showWorkspace: () => { calls.workspace += 1; },
    translateClipboard: () => { calls.clipboard += 1; },
    resolveTheme: (theme) => theme === 'dark' ? 'dark' : 'light',
    ...overrides
  });
  return { service, windows, screen, calls };
}

test('computeOverlayBounds covers the selection but clamps to the screen and minimum size', () => {
  assert.deepEqual(
    computeOverlayBounds({ x: 100, y: 80, width: 400, height: 200 }, WORK_AREA),
    { x: 100, y: 80, width: 400, height: 200 }
  );
  assert.deepEqual(
    computeOverlayBounds({ x: 100, y: 80, width: 20, height: 20 }, WORK_AREA),
    { x: 100, y: 80, width: 340, height: 148 }
  );
  assert.deepEqual(
    computeOverlayBounds({ x: 1200, y: 650, width: 20, height: 20 }, WORK_AREA),
    { x: 940, y: 572, width: 340, height: 148 }
  );
});

test('computePanelBounds places the panel beside the cursor and flips near screen edges', () => {
  assert.deepEqual(
    computePanelBounds({ x: 100, y: 100 }, WORK_AREA, 180),
    { x: 114, y: 116, width: 380, height: 180 }
  );
  assert.deepEqual(
    computePanelBounds({ x: 1200, y: 700 }, WORK_AREA, 180),
    { x: 806, y: 504, width: 380, height: 180 }
  );
});

test('computePanelResize respects minimum, maximum, and work-area bounds', () => {
  const bounds = { x: 900, y: 600, width: 380, height: 180 };
  assert.deepEqual(
    computePanelResize(bounds, 800, WORK_AREA),
    { x: 900, y: 300, width: 380, height: 420 }
  );
  assert.equal(computePanelResize(bounds, 10, WORK_AREA).height, 92);
});

test('resolveQuickTheme honors explicit themes and the system preference', () => {
  assert.equal(resolveQuickTheme('light', true), 'light');
  assert.equal(resolveQuickTheme('dark', false), 'dark');
  assert.equal(resolveQuickTheme('system', true), 'dark');
  assert.equal(resolveQuickTheme(undefined, false), 'light');
});

test('QuickResultService creates an overlay at the capture rect and updates it in place', () => {
  const { service, windows } = createHarness();
  service.showCaptureLoading({ x: 50, y: 60, width: 420, height: 180 }, { theme: 'light' });
  assert.equal(windows.length, 1);
  const window = windows[0];
  assert.equal(window.options.alwaysOnTop, true);
  assert.equal(window.options.skipTaskbar, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.deepEqual(window.bounds, { x: 50, y: 60, width: 420, height: 180 });
  assert.equal(service.ready(window.webContents).ok, true);
  assert.equal(service.ready(window.webContents).state.phase, 'loading');

  service.showCaptureResult(
    { x: 50, y: 60, width: 420, height: 180 },
    { translation: '类型错误', sourceText: 'TypeError', providerLabel: '必应', theme: 'dark' }
  );
  assert.equal(windows.length, 1);
  assert.equal(window.bounds.width, 420);
  assert.equal(window.backgroundColor, '#23212f');
  const state = service.ready(window.webContents).state;
  assert.equal(state.phase, 'result');
  assert.equal(state.translation, '类型错误');
  assert.equal(state.sourceText, 'TypeError');
  assert.equal(state.theme, 'dark');
});

test('QuickResultService rejects unknown senders and handles copy, resize, and workspace actions', async () => {
  const { service, windows, calls } = createHarness();
  service.showCaptureResult(
    { x: 10, y: 10, width: 360, height: 160 },
    { translation: '译文', sourceText: 'Source', providerLabel: '必应', theme: 'light' }
  );
  const window = windows[0];
  assert.equal(service.ready(new EventEmitter()).ok, false);
  assert.deepEqual(await service.handleAction({ type: 'copy' }), { ok: true });
  assert.deepEqual(calls.copy, ['译文']);
  assert.deepEqual(await service.handleAction({ type: 'unknown' }), { ok: false, error: '未知的窗口操作。' });
  assert.deepEqual(await service.handleAction({ type: 'resize', height: 500 }), { ok: false, error: '当前窗口不可调整。' });
  assert.deepEqual(await service.handleAction({ type: 'workspace' }), { ok: true });
  assert.equal(calls.workspace, 1);
  assert.equal(window.isDestroyed(), true);
});

test('QuickResultService panel loading and result share a compact window and support clipboard fallback', async () => {
  const { service, windows, calls } = createHarness();
  service.showPanelLoading({ x: 300, y: 200 }, { theme: 'light' });
  assert.equal(windows.length, 1);
  const window = windows[0];
  const loadingState = service.ready(window.webContents).state;
  assert.equal(loadingState.mode, 'panel');
  assert.equal(loadingState.phase, 'loading');

  service.showPanelResult(
    { x: 300, y: 200 },
    { title: '选中文本', translation: '中文译文', sourceText: 'Selected text', providerLabel: 'Google', theme: 'light' }
  );
  assert.equal(windows.length, 1);
  assert.equal(service.ready(window.webContents).state.phase, 'result');
  assert.deepEqual(await service.handleAction({ type: 'resize', height: 320 }), { ok: true });
  assert.equal(window.bounds.height, 320);

  service.showPanelError(
    { x: 300, y: 200 },
    { message: '没有选中文本' },
    { allowClipboardFallback: true, theme: 'light' }
  );
  assert.equal(service.ready(window.webContents).state.allowClipboardFallback, true);
  assert.deepEqual(await service.handleAction({ type: 'translate-clipboard' }), { ok: true });
  assert.equal(calls.clipboard, 1);
  assert.equal(service.getWindow(), null);
});

test('QuickResultService dismiss clears state and destroys the active window', () => {
  const { service, windows } = createHarness();
  service.showCaptureLoading({ x: 0, y: 0, width: 400, height: 200 }, { theme: 'light' });
  const window = windows[0];
  service.dismiss();
  assert.equal(window.isDestroyed(), true);
  assert.equal(service.getWindow(), null);
  assert.equal(service.ready(window.webContents).ok, false);
});

test('QuickResultService does not reopen a dismissed workflow when late results arrive', () => {
  const { service, windows } = createHarness();
  service.showPanelLoading({ x: 200, y: 200 }, { theme: 'light' });
  service.dismiss();
  service.showPanelResult(
    { x: 200, y: 200 },
    { translation: 'late', sourceText: 'late', providerLabel: '必应', theme: 'light' }
  );
  service.showCaptureError({ x: 0, y: 0, width: 400, height: 200 }, { message: 'late' }, { theme: 'light' });
  assert.equal(service.getWindow(), null);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].isDestroyed(), true);
});

test('QuickResultService can explicitly allow a new error presentation after dismissal', () => {
  const { service, windows } = createHarness();
  service.showPanelLoading({ x: 200, y: 200 }, { theme: 'light' });
  service.dismiss();
  service.resetSuppression();
  service.showPanelError(
    { x: 200, y: 200 },
    { message: '没有读取到选中文本' },
    { allowClipboardFallback: true, theme: 'light' }
  );
  assert.equal(windows.length, 2);
  assert.equal(service.ready(windows[1].webContents).state.allowClipboardFallback, true);
});

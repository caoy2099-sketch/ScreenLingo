'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  CaptureService,
  chooseScreenSource,
  fitSizeWithinPixelLimit,
  normalizeSelection
} = require('../src/main/capture-service');

test('normalizeSelection maps logical coordinates to physical pixels', () => {
  const result = normalizeSelection(
    { x: 100, y: 50, width: 400, height: 200, viewportWidth: 1000, viewportHeight: 500 },
    { width: 2000, height: 1000 }
  );
  assert.deepEqual(result, { x: 200, y: 100, width: 800, height: 400 });
});

test('normalizeSelection accepts a reverse drag and clamps to the viewport', () => {
  const result = normalizeSelection(
    { x: 900, y: 450, width: -950, height: -500, viewportWidth: 1000, viewportHeight: 500 },
    { width: 1000, height: 500 }
  );
  assert.deepEqual(result, { x: 0, y: 0, width: 900, height: 450 });
});

test('normalizeSelection rounds the far edge out for fractional display scaling', () => {
  const result = normalizeSelection(
    { x: 1, y: 1, width: 8, height: 8, viewportWidth: 10, viewportHeight: 10 },
    { width: 13, height: 13 }
  );
  assert.deepEqual(result, { x: 1, y: 1, width: 11, height: 11 });
});

test('normalizeSelection rejects tiny or invalid selections', () => {
  assert.throws(
    () => normalizeSelection(
      { x: 1, y: 1, width: 2, height: 2, viewportWidth: 100, viewportHeight: 100 },
      { width: 100, height: 100 }
    ),
    /选区太小/
  );
  assert.throws(() => normalizeSelection({}, { width: 100, height: 100 }), /坐标无效/);
});

test('chooseScreenSource matches Electron display_id before falling back', () => {
  const sources = [
    { id: 'screen:1:0', display_id: '1' },
    { id: 'screen:7:0', display_id: '7' }
  ];
  assert.equal(chooseScreenSource(sources, { id: 7 }), sources[1]);
  assert.equal(chooseScreenSource(sources, { id: 99 }), null);
  assert.equal(chooseScreenSource([sources[0]], { id: 99 }), sources[0]);
});

test('fitSizeWithinPixelLimit preserves aspect ratio and caps large displays', () => {
  assert.deepEqual(fitSizeWithinPixelLimit({ width: 3840, height: 2160 }), {
    width: 3840,
    height: 2160
  });
  const fitted = fitSizeWithinPixelLimit({ width: 7680, height: 4320 }, 16_000_000);
  assert.ok(fitted.width * fitted.height <= 16_000_000);
  assert.ok(Math.abs(fitted.width / fitted.height - 16 / 9) < 0.001);
});

class FakeWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    if (options.throwOnCreate) throw new Error('window create failed');
    this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.send = () => {};
  }

  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  show() {}
  focus() {}
  isDestroyed() { return this.destroyed; }
  loadFile() { return Promise.resolve(); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

function createCaptureHarness({ getSources, BrowserWindow = FakeWindow } = {}) {
  const thumbnail = {
    isEmpty: () => false,
    getSize: () => ({ width: 100, height: 60 }),
    toJPEG: () => Buffer.from('preview'),
    crop: () => ({ toDataURL: () => 'data:image/png;base64,crop' })
  };
  const display = {
    id: 7,
    scaleFactor: 1,
    size: { width: 100, height: 60 },
    bounds: { x: 0, y: 0, width: 100, height: 60 }
  };
  const service = new CaptureService({
    BrowserWindow,
    desktopCapturer: {
      getSources: getSources || (async () => [{ display_id: '7', thumbnail }])
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => display
    },
    preloadPath: 'preload.js',
    capturePagePath: 'capture.html'
  });
  return { service, thumbnail };
}

test('CaptureService locks concurrent requests before desktop capture resolves', async () => {
  let resolveSources;
  let calls = 0;
  const { service, thumbnail } = createCaptureHarness({
    getSources() {
      calls += 1;
      return new Promise((resolve) => { resolveSources = resolve; });
    }
  });

  const first = service.captureCurrentDisplay();
  const second = service.captureCurrentDisplay();
  assert.equal(calls, 1);
  resolveSources([{ display_id: '7', thumbnail }]);
  await new Promise((resolve) => setImmediate(resolve));
  service.cancel();
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(service.pending, null);
});

test('CaptureService clears request state when window loading fails', async () => {
  class FailingWindow extends FakeWindow {
    loadFile() { return Promise.reject(new Error('load failed')); }
  }
  const { service } = createCaptureHarness({ BrowserWindow: FailingWindow });

  await assert.rejects(service.captureCurrentDisplay(), /load failed/);
  assert.equal(service.pending, null);
  assert.equal(service.captureWindow, null);
  assert.equal(service.sourceImage, null);
});

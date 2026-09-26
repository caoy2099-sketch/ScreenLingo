'use strict';

const path = require('node:path');

const MIN_SELECTION_SIZE = 8;
const MAX_CAPTURE_PIXELS = 32_000_000;
const MAX_SCREENSHOT_PIXELS = 16_000_000;

function fitSizeWithinPixelLimit(size, maxPixels = MAX_SCREENSHOT_PIXELS) {
  const width = Math.max(1, Math.round(Number(size?.width) || 0));
  const height = Math.max(1, Math.round(Number(size?.height) || 0));
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) {
    throw new TypeError('截图像素上限无效。');
  }
  if (width * height <= maxPixels) return { width, height };

  const scale = Math.sqrt(maxPixels / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  };
}

function normalizeSelection(selection, imageSize) {
  if (!selection || !imageSize) {
    throw new TypeError('缺少截图选区数据。');
  }

  const viewportWidth = Number(selection.viewportWidth);
  const viewportHeight = Number(selection.viewportHeight);
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(selection[key]));

  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError('截图选区坐标无效。');
  }

  const [x, y, width, height] = values;
  const left = Math.max(0, Math.min(x, x + width));
  const top = Math.max(0, Math.min(y, y + height));
  const right = Math.min(viewportWidth, Math.max(x, x + width));
  const bottom = Math.min(viewportHeight, Math.max(y, y + height));

  if (right - left < MIN_SELECTION_SIZE || bottom - top < MIN_SELECTION_SIZE) {
    throw new RangeError('选区太小，请重新框选。');
  }

  const scaleX = imageSize.width / viewportWidth;
  const scaleY = imageSize.height / viewportHeight;
  const pixelLeft = Math.max(0, Math.floor(left * scaleX));
  const pixelTop = Math.max(0, Math.floor(top * scaleY));
  const pixelRight = Math.min(imageSize.width, Math.ceil(right * scaleX));
  const pixelBottom = Math.min(imageSize.height, Math.ceil(bottom * scaleY));
  const crop = {
    x: pixelLeft,
    y: pixelTop,
    width: Math.max(1, pixelRight - pixelLeft),
    height: Math.max(1, pixelBottom - pixelTop)
  };

  crop.width = Math.min(crop.width, imageSize.width - crop.x);
  crop.height = Math.min(crop.height, imageSize.height - crop.y);

  if (crop.width * crop.height > MAX_CAPTURE_PIXELS) {
    throw new RangeError('截图区域过大，请缩小选区。');
  }

  return crop;
}

function chooseScreenSource(sources, display) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return null;
  }

  const displayId = String(display.id);
  const exactMatch = sources.find((source) => String(source.display_id) === displayId);
  if (exactMatch) return exactMatch;
  return sources.length === 1 ? sources[0] : null;
}

class CaptureService {
  constructor({ BrowserWindow, desktopCapturer, screen, preloadPath, capturePagePath }) {
    this.BrowserWindow = BrowserWindow;
    this.desktopCapturer = desktopCapturer;
    this.screen = screen;
    this.preloadPath = preloadPath;
    this.capturePagePath = capturePagePath;
    this.captureWindow = null;
    this.sourceImage = null;
    this.pending = null;
  }

  async captureCurrentDisplay() {
    if (this.pending) {
      this.captureWindow?.focus();
      return this.pending.promise;
    }

    let resolvePending;
    let rejectPending;
    const promise = new Promise((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    const pending = {
      promise,
      resolve: resolvePending,
      reject: rejectPending,
      display: null
    };
    this.pending = pending;

    try {
      const cursor = this.screen.getCursorScreenPoint();
      const display = this.screen.getDisplayNearestPoint(cursor);
      pending.display = display;
      const scaleFactor = Math.max(1, Number(display.scaleFactor) || 1);
      const thumbnailSize = fitSizeWithinPixelLimit({
        width: display.size.width * scaleFactor,
        height: display.size.height * scaleFactor
      });

      const sources = await this.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
        fetchWindowIcons: false
      });
      if (this.pending !== pending) return promise;

      const source = chooseScreenSource(sources, display);
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error('无法匹配当前屏幕，请重试或将鼠标移到目标屏幕。');
      }

      this.sourceImage = source.thumbnail;
      const imageSize = this.sourceImage.getSize();
      const imageDataUrl = `data:image/jpeg;base64,${this.sourceImage.toJPEG(86).toString('base64')}`;

      const bounds = display.bounds;
      const captureWindow = new this.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#0c1114',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        enableLargerThanScreen: true,
        webPreferences: {
          preload: this.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          webSecurity: true
        }
      });

      if (this.pending !== pending) {
        captureWindow.destroy();
        return promise;
      }
      this.captureWindow = captureWindow;
      captureWindow.setAlwaysOnTop(true, 'screen-saver');
      captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      captureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      captureWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      captureWindow.on('closed', () => {
        if (this.captureWindow === captureWindow) {
          this.captureWindow = null;
        }
        if (this.pending === pending) {
          this.finish(null);
        }
      });
      captureWindow.once('ready-to-show', () => {
        if (
          captureWindow.isDestroyed()
          || this.captureWindow !== captureWindow
          || this.pending !== pending
        ) return;
        captureWindow.show();
        captureWindow.focus();
        captureWindow.webContents.send('capture:initialize', {
          imageDataUrl,
          imageWidth: imageSize.width,
          imageHeight: imageSize.height
        });
      });

      await captureWindow.loadFile(this.capturePagePath);
    } catch (error) {
      if (this.pending === pending) this.fail(error);
    }
    return promise;
  }

  acceptsSender(webContents) {
    return Boolean(this.captureWindow && !this.captureWindow.isDestroyed() && this.captureWindow.webContents === webContents);
  }

  complete(selection) {
    if (!this.pending || !this.sourceImage) {
      throw new Error('当前没有待完成的截图。');
    }

    const crop = normalizeSelection(selection, this.sourceImage.getSize());
    const cropped = this.sourceImage.crop(crop);
    const result = {
      dataUrl: cropped.toDataURL(),
      width: crop.width,
      height: crop.height,
      displayId: String(this.pending.display.id)
    };
    this.finish(result);
    return result;
  }

  cancel() {
    this.finish(null);
  }

  finish(result) {
    const pending = this.pending;
    this.pending = null;
    this.sourceImage = null;

    const captureWindow = this.captureWindow;
    this.captureWindow = null;
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.destroy();
    }

    pending?.resolve(result);
  }

  fail(error) {
    const pending = this.pending;
    this.pending = null;
    this.sourceImage = null;
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.destroy();
    }
    this.captureWindow = null;
    pending?.reject(error);
  }

  dispose() {
    this.cancel();
  }
}

module.exports = {
  CaptureService,
  MAX_CAPTURE_PIXELS,
  MAX_SCREENSHOT_PIXELS,
  MIN_SELECTION_SIZE,
  chooseScreenSource,
  fitSizeWithinPixelLimit,
  normalizeSelection
};

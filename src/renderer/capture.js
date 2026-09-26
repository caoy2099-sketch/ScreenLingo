'use strict';

const surface = document.querySelector('#capture-surface');
const image = document.querySelector('#screen-image');
const selection = document.querySelector('#selection');
const sizeLabel = document.querySelector('#selection-size');
const cursorX = document.querySelector('#cursor-x');
const cursorY = document.querySelector('#cursor-y');
const errorLabel = document.querySelector('#capture-error');

let startPoint = null;
let keyboardRect = null;
let initialized = false;
let submitting = false;
let errorAnnouncementTimer = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPoint(event) {
  return {
    x: clamp(event.clientX, 0, window.innerWidth),
    y: clamp(event.clientY, 0, window.innerHeight)
  };
}

function rectFromPoints(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function renderSelection(rect) {
  selection.hidden = false;
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
  sizeLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

function clearCaptureError() {
  window.clearTimeout(errorAnnouncementTimer);
  errorAnnouncementTimer = null;
  errorLabel.hidden = true;
  errorLabel.textContent = '';
}

function showCaptureError(error) {
  const detail = error?.message || String(error || '未知错误');
  const message = `截图提交失败：${detail} 请重新框选后重试。`;
  errorLabel.hidden = false;
  errorLabel.textContent = '';
  window.clearTimeout(errorAnnouncementTimer);
  errorAnnouncementTimer = window.setTimeout(() => {
    errorLabel.textContent = message;
    errorAnnouncementTimer = null;
  }, 0);
}

function createKeyboardSelection() {
  const width = Math.min(window.innerWidth, Math.max(120, Math.round(window.innerWidth * 0.5)));
  const height = Math.min(window.innerHeight, Math.max(80, Math.round(window.innerHeight * 0.35)));
  keyboardRect = {
    x: Math.round((window.innerWidth - width) / 2),
    y: Math.round((window.innerHeight - height) / 2),
    width,
    height
  };
  cursorX.style.display = 'none';
  cursorY.style.display = 'none';
  renderSelection(keyboardRect);
}

function updateKeyboardSelection(key, resize, fineAdjustment) {
  if (!keyboardRect) createKeyboardSelection();
  const step = fineAdjustment ? 1 : 10;
  const horizontal = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const vertical = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;

  if (resize) {
    keyboardRect.width = clamp(keyboardRect.width + horizontal, 8, window.innerWidth - keyboardRect.x);
    keyboardRect.height = clamp(keyboardRect.height + vertical, 8, window.innerHeight - keyboardRect.y);
  } else {
    keyboardRect.x = clamp(keyboardRect.x + horizontal, 0, window.innerWidth - keyboardRect.width);
    keyboardRect.y = clamp(keyboardRect.y + vertical, 0, window.innerHeight - keyboardRect.height);
  }
  renderSelection(keyboardRect);
}

async function submitSelection(rect) {
  if (!rect || submitting || rect.width < 8 || rect.height < 8) {
    selection.hidden = true;
    return;
  }
  submitting = true;
  clearCaptureError();
  try {
    const result = await window.screenLingo.completeCapture({
      ...rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });
    if (result?.ok === false) {
      throw new Error(result.error || '截图提交被拒绝。');
    }
    return result;
  } catch (error) {
    showCaptureError(error);
    return null;
  } finally {
    submitting = false;
  }
}

window.screenLingo.onCaptureInitialize((payload) => {
  if (!payload || typeof payload.imageDataUrl !== 'string') return;
  image.src = payload.imageDataUrl;
  initialized = true;
  surface.focus({ preventScroll: true });
});

surface.addEventListener('pointerdown', (event) => {
  if (!initialized || submitting || event.button !== 0) return;
  clearCaptureError();
  keyboardRect = null;
  startPoint = getPoint(event);
  surface.setPointerCapture(event.pointerId);
  renderSelection({ x: startPoint.x, y: startPoint.y, width: 0, height: 0 });
  cursorX.style.display = 'none';
  cursorY.style.display = 'none';
});

surface.addEventListener('pointermove', (event) => {
  const point = getPoint(event);
  if (startPoint) {
    renderSelection(rectFromPoints(startPoint, point));
    return;
  }
  cursorX.style.display = 'block';
  cursorY.style.display = 'block';
  cursorX.style.left = `${point.x}px`;
  cursorY.style.top = `${point.y}px`;
});

surface.addEventListener('pointerup', async (event) => {
  if (!startPoint || submitting || event.button !== 0) return;
  const endPoint = getPoint(event);
  const rect = rectFromPoints(startPoint, endPoint);
  startPoint = null;
  await submitSelection(rect);
});

window.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    window.screenLingo.cancelCapture();
    return;
  }
  if (!initialized || submitting) return;

  if (event.key.toLowerCase() === 'k') {
    event.preventDefault();
    clearCaptureError();
    createKeyboardSelection();
    return;
  }
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    updateKeyboardSelection(event.key, event.shiftKey, event.ctrlKey);
    return;
  }
  if (event.key === 'Enter' && keyboardRect) {
    event.preventDefault();
    await submitSelection(keyboardRect);
  }
});

window.addEventListener('blur', () => {
  startPoint = null;
});

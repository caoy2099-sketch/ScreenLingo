'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_QUEUE_SIZE = 4;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 60_000;
const DEFAULT_RECOGNITION_TIMEOUT_MS = 120_000;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
]);

class OcrInputError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'OcrInputError';
    this.code = 'OCR_INVALID_IMAGE';
  }
}

class OcrCancelledError extends Error {
  constructor(taskId, reason = 'cancelled') {
    super(`OCR task ${taskId} was ${reason}.`);
    this.name = 'OcrCancelledError';
    this.code = 'OCR_CANCELLED';
    this.taskId = taskId;
  }
}

class OcrWorkerError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OcrWorkerError';
    this.code = 'OCR_WORKER_ERROR';
  }
}

class OcrTimeoutError extends Error {
  constructor(taskId, phase, timeoutMs) {
    const phaseLabel = phase === 'recognition' ? '识别' : '初始化';
    super(`本地 OCR ${phaseLabel}超时，已重置识别引擎，请重试。`);
    this.name = 'OcrTimeoutError';
    this.code = 'OCR_TIMEOUT';
    this.taskId = taskId;
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

function requirePositiveTimeout(value, optionName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${optionName} must be a positive safe integer.`);
  }
  return value;
}

function resolveTessdataPath(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
  const isPackaged = options.isPackaged ?? __dirname.includes('app.asar');

  if (isPackaged) {
    const resourcesPath = options.resourcesPath || process.resourcesPath;
    if (!resourcesPath) {
      throw new Error('resourcesPath is required for a packaged OCR service.');
    }
    return path.join(resourcesPath, 'tessdata');
  }

  return path.join(
    projectRoot,
    'node_modules',
    '@tesseract.js-data',
    'eng',
    '4.0.0_best_int',
  );
}

function decodedBase64Size(payload) {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

function hasExpectedImageSignature(mimeType, payload) {
  const header = Buffer.from(payload.slice(0, 24), 'base64');

  if (mimeType === 'image/png') {
    return header.length >= 8
      && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return header.length >= 12
      && header.toString('ascii', 0, 4) === 'RIFF'
      && header.toString('ascii', 8, 12) === 'WEBP';
  }
  if (mimeType === 'image/bmp') {
    return header.length >= 2 && header.toString('ascii', 0, 2) === 'BM';
  }
  return false;
}

function validateImageDataUrl(dataUrl, options = {}) {
  const maxBytes = typeof options === 'number'
    ? options
    : options.maxBytes ?? MAX_IMAGE_BYTES;

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer.');
  }
  if (typeof dataUrl !== 'string') {
    throw new OcrInputError('OCR image must be a base64 image data URL.');
  }

  // Reject oversized input before running the more expensive full-string checks.
  const maximumEncodedLength = Math.ceil(maxBytes / 3) * 4 + 128;
  if (dataUrl.length > maximumEncodedLength) {
    throw new OcrInputError(`OCR image exceeds the ${maxBytes}-byte limit.`);
  }

  const separatorIndex = dataUrl.indexOf(',');
  if (separatorIndex < 0) {
    throw new OcrInputError('OCR image must be a base64 image data URL.');
  }

  const header = dataUrl.slice(0, separatorIndex);
  const payload = dataUrl.slice(separatorIndex + 1);
  const headerMatch = /^data:(image\/[a-z0-9.+-]+);base64$/i.exec(header);
  const mimeType = headerMatch?.[1].toLowerCase();

  if (!mimeType || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new OcrInputError('OCR accepts PNG, JPEG, WebP, or BMP image data URLs only.');
  }
  if (
    payload.length === 0
    || payload.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)
  ) {
    throw new OcrInputError('OCR image contains invalid base64 data.');
  }

  const byteLength = decodedBase64Size(payload);
  if (byteLength <= 0 || byteLength > maxBytes) {
    throw new OcrInputError(`OCR image exceeds the ${maxBytes}-byte limit.`);
  }
  if (!hasExpectedImageSignature(mimeType, payload)) {
    throw new OcrInputError('OCR image data does not match its declared image type.');
  }

  return { mimeType, byteLength };
}

function cleanOcrText(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000\u000b\u000c\u200b-\u200d\u2060\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));

  let firstLine = 0;
  let lastLine = lines.length;
  while (firstLine < lastLine && lines[firstLine] === '') firstLine += 1;
  while (lastLine > firstLine && lines[lastLine - 1] === '') lastLine -= 1;
  return lines.slice(firstLine, lastLine).join('\n');
}

function normalizeOcrResult(taskId, rawResult) {
  const rawConfidence = Number(rawResult?.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(100, Math.max(0, rawConfidence))
    : 0;
  return {
    taskId,
    text: cleanOcrText(rawResult?.text),
    confidence,
  };
}

function defaultWorkerFactory(workerPath, workerOptions) {
  return new Worker(workerPath, workerOptions);
}

class OcrService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workerPath = options.workerPath || path.join(__dirname, 'ocr-worker.js');
    this.langPath = options.langPath || resolveTessdataPath(options);
    this.maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES;
    this.maxQueueSize = options.maxQueueSize ?? MAX_QUEUE_SIZE;
    this.initializationTimeoutMs = requirePositiveTimeout(
      options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS,
      'initializationTimeoutMs',
    );
    this.recognitionTimeoutMs = requirePositiveTimeout(
      options.recognitionTimeoutMs ?? DEFAULT_RECOGNITION_TIMEOUT_MS,
      'recognitionTimeoutMs',
    );
    this._workerFactory = options.workerFactory || defaultWorkerFactory;
    this._worker = null;
    this._workerGeneration = 0;
    this._restartPromise = null;
    this._queue = [];
    this._activeTask = null;
    this._nextTaskId = 0;
    this._latestTaskId = null;
    this._closed = false;
  }

  get latestTaskId() {
    return this._latestTaskId;
  }

  get pendingCount() {
    return this._queue.length + (this._activeTask ? 1 : 0);
  }

  recognize(imageDataUrl, options = {}) {
    if (this._closed) {
      throw new Error('OCR service has been closed.');
    }

    const recognizeOptions = typeof options === 'function' ? { onProgress: options } : options;
    if (!recognizeOptions || typeof recognizeOptions !== 'object') {
      throw new TypeError('OCR options must be an object.');
    }
    const { onProgress, signal } = recognizeOptions;
    if (onProgress !== undefined && typeof onProgress !== 'function') {
      throw new TypeError('onProgress must be a function.');
    }
    if (
      signal !== undefined
      && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')
    ) {
      throw new TypeError('signal must be an AbortSignal.');
    }

    validateImageDataUrl(imageDataUrl, { maxBytes: this.maxImageBytes });

    if (signal?.aborted) {
      const taskId = ++this._nextTaskId;
      const promise = Promise.reject(new OcrCancelledError(taskId, 'aborted'));
      Object.defineProperties(promise, {
        taskId: { enumerable: true, value: taskId },
        cancel: { enumerable: false, value: () => false },
      });
      this._notify('cancelled', { taskId, reason: 'aborted' });
      return promise;
    }

    const supersede = recognizeOptions.supersede !== false;
    if (supersede) {
      this._cancelOutstanding('superseded');
    } else if (this.pendingCount >= this.maxQueueSize) {
      throw new Error(`OCR queue is full (maximum ${this.maxQueueSize} tasks).`);
    }

    const taskId = ++this._nextTaskId;
    let resolveTask;
    let rejectTask;
    const promise = new Promise((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    const task = {
      id: taskId,
      imageDataUrl,
      onProgress,
      signal,
      abortHandler: null,
      resolve: resolveTask,
      reject: rejectTask,
      settled: false,
      phase: 'initialization',
      watchdogTimer: null,
    };

    Object.defineProperties(promise, {
      taskId: { enumerable: true, value: taskId },
      cancel: { enumerable: false, value: () => this.cancel(taskId) },
    });

    this._latestTaskId = taskId;
    this._queue.push(task);
    if (signal) {
      task.abortHandler = () => this.cancel(taskId, 'aborted');
      signal.addEventListener('abort', task.abortHandler, { once: true });
    }

    if (signal?.aborted) {
      this.cancel(taskId, 'aborted');
    } else {
      this._notify('queued', { taskId, position: this._queue.length });
      this._pump();
    }
    return promise;
  }

  cancelLatest(reason = 'cancelled') {
    return this._latestTaskId === null ? false : this.cancel(this._latestTaskId, reason);
  }

  cancel(taskId, reason = 'cancelled') {
    if (this._activeTask?.id === taskId) {
      const task = this._activeTask;
      this._activeTask = null;
      this._settleTask(task, 'reject', new OcrCancelledError(task.id, reason));
      this._restartWorker();
      this._notify('cancelled', { taskId: task.id, reason });
      return true;
    }

    const queuedIndex = this._queue.findIndex((task) => task.id === taskId);
    if (queuedIndex < 0) return false;
    const [task] = this._queue.splice(queuedIndex, 1);
    this._settleTask(task, 'reject', new OcrCancelledError(task.id, reason));
    this._notify('cancelled', { taskId: task.id, reason });
    return true;
  }

  _cancelOutstanding(reason) {
    const queuedTasks = this._queue.splice(0);
    for (const task of queuedTasks) {
      this._settleTask(task, 'reject', new OcrCancelledError(task.id, reason));
      this._notify('cancelled', { taskId: task.id, reason });
    }
    if (this._activeTask) {
      const task = this._activeTask;
      this._activeTask = null;
      this._settleTask(task, 'reject', new OcrCancelledError(task.id, reason));
      this._restartWorker();
      this._notify('cancelled', { taskId: task.id, reason });
    }
  }

  _settleTask(task, method, value) {
    if (task.settled) return;
    task.settled = true;
    if (task.watchdogTimer) {
      clearTimeout(task.watchdogTimer);
      task.watchdogTimer = null;
    }
    if (task.signal && task.abortHandler && typeof task.signal.removeEventListener === 'function') {
      task.signal.removeEventListener('abort', task.abortHandler);
    }
    task[method](value);
  }

  _armWatchdog(task, phase) {
    if (task.watchdogTimer) clearTimeout(task.watchdogTimer);
    task.phase = phase;
    const timeoutMs = phase === 'recognition'
      ? this.recognitionTimeoutMs
      : this.initializationTimeoutMs;
    const timer = setTimeout(() => {
      if (task.settled || this._activeTask !== task || task.watchdogTimer !== timer) return;

      this._activeTask = null;
      const error = new OcrTimeoutError(task.id, phase, timeoutMs);
      this._settleTask(task, 'reject', error);
      this._restartWorker();
      this._notify('timeout', {
        taskId: task.id,
        phase,
        timeoutMs,
        error,
      });
    }, timeoutMs);
    timer.unref?.();
    task.watchdogTimer = timer;
  }

  _ensureWorker() {
    if (this._worker) return this._worker;

    const generation = ++this._workerGeneration;
    const worker = this._workerFactory(this.workerPath, {
      workerData: { langPath: this.langPath },
    });
    if (!worker || typeof worker.on !== 'function' || typeof worker.postMessage !== 'function') {
      throw new TypeError('workerFactory must return a Worker-compatible object.');
    }

    this._worker = worker;
    worker.on('message', (message) => this._handleWorkerMessage(message, worker, generation));
    worker.on('error', (error) => this._handleWorkerFailure(error, worker, generation));
    worker.on('exit', (code) => this._handleWorkerExit(code, worker, generation));
    return worker;
  }

  _pump() {
    if (this._closed || this._activeTask || this._restartPromise) return;

    let task = this._queue.shift();
    while (task?.signal?.aborted) {
      this._settleTask(task, 'reject', new OcrCancelledError(task.id, 'aborted'));
      task = this._queue.shift();
    }
    if (!task) return;

    let worker;
    try {
      worker = this._ensureWorker();
      this._activeTask = task;
      this._armWatchdog(task, 'initialization');
      worker.postMessage({
        type: 'recognize',
        taskId: task.id,
        imageDataUrl: task.imageDataUrl,
      });
      this._notify('started', { taskId: task.id });
    } catch (error) {
      this._activeTask = null;
      this._settleTask(
        task,
        'reject',
        error instanceof OcrWorkerError
          ? error
          : new OcrWorkerError('Unable to start the OCR worker.', error),
      );
      this._restartWorker();
    }
  }

  _handleWorkerMessage(message, worker, generation) {
    if (worker !== this._worker || generation !== this._workerGeneration) return;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'diagnostic') {
      this._notify('diagnostic', message.error);
      return;
    }

    const task = this._activeTask;
    if (!task || message.taskId !== task.id) return;

    if (message.type === 'phase' && message.phase === 'recognition') {
      this._armWatchdog(task, 'recognition');
      this._notify('phase', { taskId: task.id, phase: 'recognition' });
      return;
    }

    if (message.type === 'progress') {
      const numericProgress = Number(message.progress);
      const progress = Number.isFinite(numericProgress)
        ? Math.min(1, Math.max(0, numericProgress))
        : 0;
      const update = {
        taskId: task.id,
        status: typeof message.status === 'string' ? message.status : 'recognizing text',
        progress,
      };
      this._notify('progress', update);
      if (task.onProgress) {
        try {
          task.onProgress(update);
        } catch (error) {
          this._notify('progress-handler-error', { taskId: task.id, error });
        }
      }
      return;
    }

    this._activeTask = null;
    if (message.type === 'result') {
      const result = normalizeOcrResult(task.id, message.result);
      this._settleTask(task, 'resolve', result);
      this._notify('result', result);
    } else if (message.type === 'error') {
      const detail = message.error;
      const error = new OcrWorkerError(
        typeof detail?.message === 'string' ? detail.message : 'OCR worker failed.',
      );
      if (typeof detail?.stack === 'string') error.workerStack = detail.stack;
      this._settleTask(task, 'reject', error);
    } else {
      this._settleTask(task, 'reject', new OcrWorkerError('OCR worker returned an unknown response.'));
    }
    this._pump();
  }

  _handleWorkerFailure(error, worker, generation) {
    if (worker !== this._worker || generation !== this._workerGeneration) return;
    this._worker = null;
    this._workerGeneration += 1;

    const task = this._activeTask;
    this._activeTask = null;
    if (task) {
      this._settleTask(task, 'reject', new OcrWorkerError('OCR worker crashed.', error));
    }
    this._notify('worker-failure', error);
    this._pump();
  }

  _handleWorkerExit(code, worker, generation) {
    if (worker !== this._worker || generation !== this._workerGeneration) return;
    this._worker = null;
    this._workerGeneration += 1;

    const task = this._activeTask;
    this._activeTask = null;
    if (task) {
      this._settleTask(
        task,
        'reject',
        new OcrWorkerError(`OCR worker exited before completing task ${task.id} (code ${code}).`),
      );
    }
    this._pump();
  }

  _restartWorker() {
    if (this._restartPromise) return this._restartPromise;
    const worker = this._worker;
    if (!worker) {
      this._pump();
      return Promise.resolve();
    }

    this._worker = null;
    this._workerGeneration += 1;
    let termination;
    try {
      termination = typeof worker.terminate === 'function' ? worker.terminate() : undefined;
    } catch (error) {
      termination = Promise.reject(error);
    }

    const restartPromise = Promise.resolve(termination)
      .catch((error) => this._notify('diagnostic', error))
      .finally(() => {
        if (this._restartPromise === restartPromise) {
          this._restartPromise = null;
          this._pump();
        }
      });
    this._restartPromise = restartPromise;
    return restartPromise;
  }

  async destroy() {
    if (this._closed) return;
    this._closed = true;
    this._cancelOutstanding('cancelled');

    const pendingRestart = this._restartPromise;
    if (this._worker) {
      await this._restartWorker();
    } else if (pendingRestart) {
      await pendingRestart;
    }
    this.removeAllListeners();
  }

  close() {
    return this.destroy();
  }

  _notify(eventName, payload) {
    try {
      this.emit(eventName, payload);
    } catch (error) {
      if (eventName !== 'listener-error' && this.listenerCount('listener-error') > 0) {
        try {
          this.emit('listener-error', { eventName, error });
        } catch {
          // Listener failures must not alter OCR task state.
        }
      }
    }
  }
}

function createOcrService(options) {
  return new OcrService(options);
}

module.exports = {
  DEFAULT_INITIALIZATION_TIMEOUT_MS,
  DEFAULT_RECOGNITION_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_QUEUE_SIZE,
  OcrCancelledError,
  OcrInputError,
  OcrService,
  OcrTimeoutError,
  OcrWorkerError,
  cleanOcrText,
  createOcrService,
  normalizeOcrResult,
  resolveTessdataPath,
  validateImageDataUrl,
};

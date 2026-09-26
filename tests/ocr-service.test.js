'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');

const {
  OcrCancelledError,
  OcrInputError,
  OcrService,
  OcrTimeoutError,
  cleanOcrText,
  resolveTessdataPath,
  validateImageDataUrl,
} = require('../src/main/ocr-service');

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]).toString('base64')}`;

class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

function createHarness(options = {}) {
  const workers = [];
  const service = new OcrService({
    projectRoot: path.resolve('fixture-project'),
    workerFactory() {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    ...options,
  });
  return { service, workers };
}

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('resolveTessdataPath selects bundled and development language data', () => {
  const projectRoot = path.resolve('C:\\fixture\\screenlingo');
  const resourcesPath = path.resolve('C:\\fixture\\resources');

  assert.equal(
    resolveTessdataPath({ isPackaged: false, projectRoot }),
    path.join(
      projectRoot,
      'node_modules',
      '@tesseract.js-data',
      'eng',
      '4.0.0_best_int',
    ),
  );
  assert.equal(
    resolveTessdataPath({ isPackaged: true, resourcesPath }),
    path.join(resourcesPath, 'tessdata'),
  );
  assert.throws(
    () => resolveTessdataPath({ isPackaged: true, resourcesPath: '' }),
    /resourcesPath/,
  );
});

test('validateImageDataUrl validates format, signature, and decoded size', () => {
  assert.deepEqual(validateImageDataUrl(PNG_DATA_URL), {
    mimeType: 'image/png',
    byteLength: 8,
  });
  assert.throws(() => validateImageDataUrl(Buffer.alloc(8)), OcrInputError);
  assert.throws(
    () => validateImageDataUrl('data:text/plain;base64,SGVsbG8='),
    OcrInputError,
  );
  assert.throws(
    () => validateImageDataUrl('data:image/png;base64,not-base64'),
    OcrInputError,
  );
  assert.throws(
    () => validateImageDataUrl('data:image/png;base64,SGVsbG8='),
    /does not match/,
  );
  assert.throws(
    () => validateImageDataUrl(PNG_DATA_URL, { maxBytes: 7 }),
    /exceeds/,
  );
});

test('cleanOcrText removes OCR artifacts without changing paths or code symbols', () => {
  const source = [
    '',
    '  at C:\\repo\\src\\index.js:42:7  ',
    'const url = "https://localhost:3000/a?x=1&y=2";\u0000',
    'value = foo?.bar ?? left / right;\u00a0 ',
    '\u200b',
    '',
  ].join('\r\n');

  assert.equal(
    cleanOcrText(source),
    [
      '  at C:\\repo\\src\\index.js:42:7',
      'const url = "https://localhost:3000/a?x=1&y=2";',
      'value = foo?.bar ?? left / right;',
    ].join('\n'),
  );
  assert.equal(cleanOcrText(null), '');
});

test('worker queue runs one task at a time and ignores old responses', async (t) => {
  const { service, workers } = createHarness();
  t.after(() => service.destroy());

  const first = service.recognize(PNG_DATA_URL, { supersede: false });
  const second = service.recognize(PNG_DATA_URL, { supersede: false });
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].messages.map((message) => message.taskId), [first.taskId]);

  workers[0].emit('message', {
    type: 'result',
    taskId: first.taskId,
    result: { text: 'first', confidence: 81 },
  });
  assert.equal((await first).text, 'first');
  assert.deepEqual(
    workers[0].messages.map((message) => message.taskId),
    [first.taskId, second.taskId],
  );

  workers[0].emit('message', {
    type: 'result',
    taskId: first.taskId,
    result: { text: 'stale result', confidence: 100 },
  });
  workers[0].emit('message', {
    type: 'result',
    taskId: second.taskId,
    result: { text: '\r\nfresh result\u0000\r\n', confidence: 93, blocks: [{ text: 'fresh' }] },
  });

  assert.deepEqual(await second, {
    taskId: second.taskId,
    text: 'fresh result',
    confidence: 93,
  });
});

test('a new task cancels the previous worker and stale worker messages cannot win', async (t) => {
  const { service, workers } = createHarness();
  t.after(() => service.destroy());
  const progressUpdates = [];

  const first = service.recognize(PNG_DATA_URL);
  const oldWorker = workers[0];
  const second = service.recognize(PNG_DATA_URL, {
    onProgress(update) {
      progressUpdates.push(update);
    },
  });

  await assert.rejects(first, (error) => (
    error instanceof OcrCancelledError
    && error.code === 'OCR_CANCELLED'
    && error.taskId === first.taskId
  ));
  assert.equal(oldWorker.terminated, true);
  await flushTasks();
  assert.equal(workers.length, 2);

  oldWorker.emit('message', {
    type: 'result',
    taskId: second.taskId,
    result: { text: 'wrong worker', confidence: 100 },
  });
  workers[1].emit('message', {
    type: 'progress',
    taskId: second.taskId,
    status: 'recognizing text',
    progress: 0.55,
  });
  workers[1].emit('message', {
    type: 'result',
    taskId: second.taskId,
    result: { text: 'current worker', confidence: 88 },
  });

  assert.equal((await second).text, 'current worker');
  assert.deepEqual(progressUpdates, [{
    taskId: second.taskId,
    status: 'recognizing text',
    progress: 0.55,
  }]);
});

test('an already-aborted request does not supersede the active task', async (t) => {
  const { service, workers } = createHarness();
  t.after(() => service.destroy());

  const active = service.recognize(PNG_DATA_URL);
  const activeWorker = workers[0];
  const controller = new AbortController();
  controller.abort();
  const aborted = service.recognize(PNG_DATA_URL, { signal: controller.signal });

  await assert.rejects(aborted, (error) => (
    error instanceof OcrCancelledError
    && error.taskId === aborted.taskId
  ));
  assert.equal(aborted.cancel(), false);
  assert.equal(activeWorker.terminated, false);
  assert.equal(service.latestTaskId, active.taskId);
  assert.equal(service.pendingCount, 1);
  assert.deepEqual(activeWorker.messages.map((message) => message.taskId), [active.taskId]);

  activeWorker.emit('message', {
    type: 'result',
    taskId: active.taskId,
    result: { text: 'active task survived', confidence: 89 },
  });
  assert.equal((await active).text, 'active task survived');
});

test('AbortSignal and cancelLatest reject the current task', async (t) => {
  const { service, workers } = createHarness();
  t.after(() => service.destroy());

  const controller = new AbortController();
  const aborted = service.recognize(PNG_DATA_URL, { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, { name: 'OcrCancelledError', code: 'OCR_CANCELLED' });
  assert.equal(workers[0].terminated, true);
  assert.equal(service.cancelLatest(), false);

  await flushTasks();
  const cancelled = service.recognize(PNG_DATA_URL);
  assert.equal(service.cancelLatest(), true);
  await assert.rejects(cancelled, { code: 'OCR_CANCELLED' });
});

test('a missing-model diagnostic times out initialization and the queue recovers', async (t) => {
  const { service, workers } = createHarness({
    initializationTimeoutMs: 25,
    recognitionTimeoutMs: 100,
  });
  t.after(() => service.destroy());

  const timeoutEvent = once(service, 'timeout');
  const first = service.recognize(PNG_DATA_URL, { supersede: false });
  const firstRejection = assert.rejects(first, (error) => (
    error instanceof OcrTimeoutError
    && error.code === 'OCR_TIMEOUT'
    && error.taskId === first.taskId
    && error.phase === 'initialization'
    && error.timeoutMs === 25
  ));
  const second = service.recognize(PNG_DATA_URL, { supersede: false });

  workers[0].emit('message', {
    type: 'diagnostic',
    error: { code: 'ENOENT', message: 'eng.traineddata.gz was not found' },
  });
  const [timeout] = await timeoutEvent;
  await firstRejection;
  assert.deepEqual(
    { taskId: timeout.taskId, phase: timeout.phase, timeoutMs: timeout.timeoutMs },
    { taskId: first.taskId, phase: 'initialization', timeoutMs: 25 },
  );
  assert.equal(workers[0].terminated, true);

  await flushTasks();
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].messages.map((message) => message.taskId), [second.taskId]);
  workers[1].emit('message', {
    type: 'phase',
    taskId: second.taskId,
    phase: 'recognition',
  });
  workers[1].emit('message', {
    type: 'result',
    taskId: second.taskId,
    result: { text: 'queue recovered', confidence: 84 },
  });
  assert.equal((await second).text, 'queue recovered');
  assert.equal(service.pendingCount, 0);
});

test('recognition has a separate watchdog and recycles the worker', async (t) => {
  const { service, workers } = createHarness({
    initializationTimeoutMs: 100,
    recognitionTimeoutMs: 25,
  });
  t.after(() => service.destroy());

  const timeoutEvent = once(service, 'timeout');
  const task = service.recognize(PNG_DATA_URL);
  const rejection = assert.rejects(task, (error) => (
    error instanceof OcrTimeoutError
    && error.phase === 'recognition'
    && error.timeoutMs === 25
  ));
  workers[0].emit('message', {
    type: 'phase',
    taskId: task.taskId,
    phase: 'recognition',
  });

  const [timeout] = await timeoutEvent;
  await rejection;
  assert.equal(timeout.phase, 'recognition');
  assert.equal(workers[0].terminated, true);
  assert.equal(service.pendingCount, 0);
});

test('cancelling clears the watchdog and a later task still completes', async (t) => {
  const { service, workers } = createHarness({
    initializationTimeoutMs: 25,
    recognitionTimeoutMs: 25,
  });
  t.after(() => service.destroy());
  let timeoutCount = 0;
  service.on('timeout', () => { timeoutCount += 1; });

  const cancelled = service.recognize(PNG_DATA_URL);
  const cancellation = assert.rejects(cancelled, OcrCancelledError);
  workers[0].emit('message', {
    type: 'phase',
    taskId: cancelled.taskId,
    phase: 'recognition',
  });
  assert.equal(cancelled.cancel(), true);
  await cancellation;
  await flushTasks();
  await delay(50);
  assert.equal(timeoutCount, 0);

  const next = service.recognize(PNG_DATA_URL);
  assert.equal(workers.length, 2);
  workers[1].emit('message', {
    type: 'phase',
    taskId: next.taskId,
    phase: 'recognition',
  });
  workers[1].emit('message', {
    type: 'result',
    taskId: next.taskId,
    result: { text: 'after cancellation', confidence: 91 },
  });
  assert.equal((await next).text, 'after cancellation');
});

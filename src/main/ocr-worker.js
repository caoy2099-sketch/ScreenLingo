'use strict';

const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { createWorker, OEM, PSM } = require('tesseract.js');

let activeTaskId = null;
let enginePromise = null;
let shuttingDown = false;

function serializeError(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
    stack: typeof error?.stack === 'string' ? error.stack : undefined,
    code: error?.code,
  };
}

function post(message) {
  if (parentPort && !shuttingDown) parentPort.postMessage(message);
}

function resolveLocalTesseractPaths() {
  const tesseractDirectory = path.dirname(require.resolve('tesseract.js/package.json'));
  const coreDirectory = path.dirname(require.resolve('tesseract.js-core/package.json'));
  return {
    corePath: coreDirectory,
    workerPath: path.join(tesseractDirectory, 'src', 'worker-script', 'node', 'index.js'),
  };
}

async function getEngine() {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    const langPath = workerData?.langPath;
    if (typeof langPath !== 'string' || langPath.length === 0) {
      throw new Error('A local Tesseract language path is required.');
    }

    const localPaths = resolveLocalTesseractPaths();
    const engine = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath,
      corePath: localPaths.corePath,
      workerPath: localPaths.workerPath,
      cacheMethod: 'none',
      gzip: true,
      logger(update) {
        if (activeTaskId === null) return;
        post({
          type: 'progress',
          taskId: activeTaskId,
          status: update.status,
          progress: update.progress,
        });
      },
      errorHandler(error) {
        post({ type: 'diagnostic', error: serializeError(error) });
      },
    });

    await engine.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    return engine;
  })().catch((error) => {
    enginePromise = null;
    throw error;
  });

  return enginePromise;
}

async function recognize(message) {
  const { taskId, imageDataUrl } = message;
  activeTaskId = taskId;

  try {
    const engine = await getEngine();
    if (activeTaskId !== taskId || shuttingDown) return;
    post({ type: 'phase', taskId, phase: 'recognition' });
    const response = await engine.recognize(
      imageDataUrl,
      {},
      { text: true },
      `screenlingo-${taskId}`,
    );
    if (activeTaskId !== taskId || shuttingDown) return;

    post({
      type: 'result',
      taskId,
      result: {
        text: response.data?.text || '',
        confidence: response.data?.confidence,
      },
    });
  } catch (error) {
    if (activeTaskId === taskId && !shuttingDown) {
      post({ type: 'error', taskId, error: serializeError(error) });
    }
  } finally {
    if (activeTaskId === taskId) activeTaskId = null;
  }
}

async function shutdown() {
  shuttingDown = true;
  activeTaskId = null;
  try {
    const engine = enginePromise ? await enginePromise : null;
    if (engine) await engine.terminate();
  } finally {
    parentPort?.close();
  }
}

if (parentPort) {
  parentPort.on('message', (message) => {
    if (message?.type === 'recognize') {
      void recognize(message);
    } else if (message?.type === 'shutdown') {
      void shutdown();
    }
  });
}

module.exports = { resolveLocalTesseractPaths, serializeError };

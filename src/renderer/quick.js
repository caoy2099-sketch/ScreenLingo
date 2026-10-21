'use strict';

const elements = {
  shell: document.querySelector('#quick-shell'),
  title: document.querySelector('#quick-title'),
  meta: document.querySelector('#quick-meta'),
  close: document.querySelector('#quick-close'),
  loading: document.querySelector('#quick-loading'),
  loadingMessage: document.querySelector('#quick-loading-message'),
  progressTrack: document.querySelector('#quick-progress-track'),
  progress: document.querySelector('#quick-progress'),
  result: document.querySelector('#quick-result'),
  translation: document.querySelector('#quick-translation'),
  sourceBox: document.querySelector('#quick-source-box'),
  source: document.querySelector('#quick-source'),
  error: document.querySelector('#quick-error'),
  errorMessage: document.querySelector('#quick-error-message'),
  copy: document.querySelector('#quick-copy'),
  clipboard: document.querySelector('#quick-clipboard'),
  workspace: document.querySelector('#quick-workspace'),
  toast: document.querySelector('#quick-toast')
};

let state = null;
let toastTimer = null;
let copyTimer = null;
let resizeFrame = null;
let lastRequestedHeight = 0;

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
    toastTimer = null;
  }, 1800);
}

async function sendAction(action) {
  try {
    const result = await window.screenLingoQuick.action(action);
    if (result?.ok === false) showToast(result.error || '操作失败。');
    return result;
  } catch (error) {
    showToast(error?.message || '操作失败。');
    return null;
  }
}

function scheduleResize() {
  if (!state || state.mode !== 'panel') return;
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = null;
    const measured = Math.ceil(Math.max(elements.shell.scrollHeight, elements.shell.getBoundingClientRect().height));
    const height = Math.max(92, Math.min(420, measured));
    if (Math.abs(height - lastRequestedHeight) < 2) return;
    lastRequestedHeight = height;
    void window.screenLingoQuick.action({ type: 'resize', height });
  });
}

function applyState(next) {
  if (!next || typeof next !== 'object') return;
  const modeChanged = state?.mode !== next.mode;
  state = next;
  if (modeChanged) lastRequestedHeight = 0;
  document.documentElement.dataset.theme = next.theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.mode = next.mode === 'overlay' ? 'overlay' : 'panel';
  document.title = next.title ? `${next.title} · 截译` : '截译';

  elements.title.textContent = next.title || '截译';
  elements.meta.textContent = next.meta || '';
  elements.loading.hidden = next.phase !== 'loading';
  elements.result.hidden = next.phase !== 'result';
  elements.error.hidden = next.phase !== 'error';

  if (next.phase === 'loading') {
    elements.loadingMessage.textContent = next.message || '正在处理';
    const hasProgress = Number.isFinite(next.progress);
    elements.progressTrack.hidden = !hasProgress;
    if (hasProgress) elements.progress.style.width = `${Math.round(next.progress * 100)}%`;
  }

  if (next.phase === 'result') {
    elements.translation.textContent = next.translation || '';
    const hasSource = Boolean(next.sourceText);
    elements.sourceBox.hidden = !hasSource;
    elements.source.textContent = hasSource ? next.sourceText : '';
    elements.sourceBox.open = false;
  }

  if (next.phase === 'error') {
    elements.errorMessage.textContent = next.message || '请重试。';
  }

  elements.copy.hidden = next.phase !== 'result' || !next.translation;
  elements.clipboard.hidden = Boolean(next.phase !== 'error' || !next.allowClipboardFallback);
  elements.workspace.textContent = next.mode === 'overlay' ? '打开工作台' : '工作台';
  scheduleResize();
}

async function copyTranslation() {
  if (!state?.translation) return;
  const result = await sendAction({ type: 'copy' });
  if (!result?.ok) return;
  window.clearTimeout(copyTimer);
  elements.copy.textContent = '已复制';
  copyTimer = window.setTimeout(() => {
    elements.copy.textContent = '复制译文';
    copyTimer = null;
  }, 1400);
}

function bindActions() {
  elements.close.addEventListener('click', () => void sendAction({ type: 'close' }));
  elements.copy.addEventListener('click', () => void copyTranslation());
  elements.clipboard.addEventListener('click', () => void sendAction({ type: 'translate-clipboard' }));
  elements.workspace.addEventListener('click', () => void sendAction({ type: 'workspace' }));
  elements.sourceBox.addEventListener('toggle', scheduleResize);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void sendAction({ type: 'close' });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (window.getSelection()?.toString()) return;
      event.preventDefault();
      void copyTranslation();
    }
  });
}

async function initialize() {
  bindActions();
  window.screenLingoQuick.onState(applyState);
  const initial = await window.screenLingoQuick.ready();
  if (initial?.state) applyState(initial.state);
}

initialize().catch((error) => {
  showToast(error?.message || '快速窗口初始化失败。');
});

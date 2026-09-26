'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..', '..');
const artifactDir = path.join(root, 'artifacts', process.env.SCREENLINGO_EXE ? 'packaged' : 'development');
fs.mkdirSync(artifactDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifactDir, 'profile-'));
const sample = 'TypeError: Cannot read properties of undefined\n    at main (src/index.js:42:7)\nError: MODULE_NOT_FOUND';
const translation = '类型错误：无法读取 undefined 的属性\n    at main (src/index.js:42:7)\n错误：MODULE_NOT_FOUND';
const answer = '变量尚未初始化。请检查 src/index.js 第 42 行，并确认模块已安装。';
const cancelledQuestion = '取消后保留这个问题';
const requests = [];
const errors = [];
const checks = [];

async function captureScreenshot(page, filename) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = document.getAnimations().filter((animation) =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
  await page.screenshot({ path: path.join(artifactDir, filename), animations: 'disabled' });
}

async function resizeMainWindow(app, page, width, height) {
  const contentSize = await app.evaluate(({ BrowserWindow }, size) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(size.width, size.height);
    return mainWindow.getContentSize();
  }, { width, height });
  await page.waitForFunction(([contentWidth, contentHeight]) =>
    window.innerWidth === contentWidth && window.innerHeight === contentHeight, contentSize);
}

async function assertNoHorizontalOverflow(page, viewSelector) {
  const overflowing = await page.evaluate((selector) => {
    const containers = [document.documentElement, document.querySelector('#app-shell'),
      document.querySelector('.main-content'), document.querySelector(selector)];
    return containers.filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.id || element.className || element.tagName);
  }, viewSelector);
  assert.deepEqual(overflowing, [], `Horizontal overflow in ${viewSelector}`);
}

async function run() {
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    payload.__authorization = request.headers.authorization || '';
    requests.push(payload);
    const isImage = Array.isArray(payload.messages?.[1]?.content);
    if (body.includes(cancelledQuestion)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: isImage ? answer : translation } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const settings = {
    provider: 'openai', endpoint, model: 'fixture-text', visionModel: 'fixture-vision',
    screenshotHotkey: 'Alt+Shift+F9', clipboardHotkey: 'Alt+Shift+F10',
    autoTranslate: false, closeToTray: true, theme: 'light'
  };
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  const env = { ...process.env, SCREENLINGO_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = Boolean(process.env.SCREENLINGO_EXE);
  let app;
  try {
    app = await electron.launch({
      executablePath: packaged ? process.env.SCREENLINGO_EXE : require('electron'),
      args: packaged ? [`--user-data-dir=${profile}`] : [path.join(__dirname, 'launch.cjs')],
      env, timeout: 30000
    });
    app.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => typeof window.screenLingo === 'object' && document.querySelector('#settings-open svg'));
    const appInfo = await app.evaluate(({ app, nativeImage }, root) => ({
      userData: app.getPath('userData'), packaged: app.isPackaged,
      iconEmpty: nativeImage.createFromPath(`${app.isPackaged ? app.getAppPath() : root}/src/assets/icon.png`).isEmpty()
    }), root);
    assert.equal(path.resolve(appInfo.userData), path.resolve(profile));
    assert.equal(appInfo.iconEmpty, false);
    assert.equal(await page.locator('#empty-view').isVisible(), true);
    await page.waitForFunction(() =>
      document.querySelector('[data-shortcut="capture"]').textContent === 'Alt + Shift + F9');
    const captureShortcuts = await page.locator('[data-shortcut="capture"]').allTextContents();
    assert.deepEqual(captureShortcuts, Array(captureShortcuts.length).fill('Alt + Shift + F9'));
    await captureScreenshot(page, '01-empty.png');
    checks.push('Application starts with isolated settings, working preload, icons, and empty state');

    await page.locator('#theme-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('#theme-toggle').getAttribute('aria-label'), '切换至浅色主题');
    await captureScreenshot(page, '01-empty-dark.png');
    await resizeMainWindow(app, page, 720, 560);
    await captureScreenshot(page, '01-empty-compact.png');
    await assertNoHorizontalOverflow(page, '#empty-view');
    await page.locator('#settings-open').click();
    assert.equal(await page.locator('#page-title').textContent(), '偏好设置');
    assert.equal(await page.locator('#settings-open').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#workspace-open').getAttribute('aria-current'), null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-title');
    assert.equal(await page.locator('#actionbar').isVisible(), true);
    await captureScreenshot(page, '02-settings-compact.png');
    await assertNoHorizontalOverflow(page, '#settings-view');
    await page.locator('#workspace-open').click();
    assert.equal(await page.locator('#empty-view').isVisible(), true);
    assert.equal(await page.locator('#page-title').textContent(), '翻译工作台');
    assert.equal(await page.locator('#workspace-open').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#settings-open').getAttribute('aria-current'), null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-open');
    await page.locator('#theme-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await resizeMainWindow(app, page, 1280, 720);
    const headingIsReachable = await page.evaluate(() => {
      const emptyView = document.querySelector('#empty-view');
      emptyView.scrollTop = 0;
      return document.querySelector('.welcome-heading').getBoundingClientRect().top >=
        emptyView.getBoundingClientRect().top;
    });
    assert.equal(headingIsReachable, true, 'The empty-state heading remains reachable in a wide, short window');
    await resizeMainWindow(app, page, 1040, 720);
    checks.push('Configured shortcuts, settings navigation, focus, and compact empty/settings views remain usable');

    await page.locator('#settings-open').click();
    assert.equal(await page.locator('#endpoint-input').inputValue(), endpoint);
    await page.locator('#model-input').fill('fixture-text');
    await page.locator('#api-key-input').fill('fixture-secret');
    await page.locator('#api-key-toggle').click();
    assert.equal(await page.locator('#api-key-input').getAttribute('type'), 'text');
    assert.equal(await page.locator('#api-key-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#api-key-toggle').getAttribute('aria-label'), '隐藏 API Key');
    await page.locator('#api-key-toggle').click();
    assert.equal(await page.locator('#api-key-input').getAttribute('type'), 'password');
    assert.equal(await page.locator('#api-key-toggle').getAttribute('aria-pressed'), 'false');
    await captureScreenshot(page, '02-settings.png');
    await page.locator('input[name="networkMode"][value="direct"]').check();
    assert.equal(await page.locator('#proxy-field').isVisible(), false);
    await page.locator('#network-check').click();
    await page.waitForFunction(() => document.querySelector('#network-result').textContent.includes('直连'));
    await page.locator('input[name="networkMode"][value="manual"]').check();
    assert.equal(await page.locator('#proxy-field').isVisible(), true);
    await page.locator('#proxy-input').fill('socks5://127.0.0.1:10808');
    await page.locator('#settings-save').click();
    await page.waitForFunction(() => document.querySelector('#settings-view').hidden);
    const savedSettings = await page.evaluate(() => window.screenLingo.getSettings());
    assert.equal(savedSettings.networkMode, 'manual');
    assert.equal(savedSettings.hasApiKey, true);
    assert.doesNotMatch(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'), /fixture-secret/);
    checks.push('Network controls detect direct routes, toggle proxy fields, and persist manual mode');
    await page.locator('#settings-open').click();
    await page.locator('#settings-back').click();

    const oversizedImageChecks = await page.evaluate(async () => {
      const originalRead = FileReader.prototype.readAsDataURL;
      const workflowUpdates = [];
      const unsubscribe = window.screenLingo.onWorkflowUpdate((update) => workflowUpdates.push(update));
      let readCount = 0;
      FileReader.prototype.readAsDataURL = function blockedRead() {
        readCount += 1;
      };
      const oversizedFile = { type: 'image/png', size: 20 * 1024 * 1024 + 1 };
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: { items: [{ type: 'image/png', getAsFile: () => oversizedFile }] }
      });
      window.dispatchEvent(pasteEvent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const paste = {
        readCount,
        workflowUpdateCount: workflowUpdates.length,
        prevented: pasteEvent.defaultPrevented,
        status: document.querySelector('#status-text').textContent,
        toast: document.querySelector('#toast').textContent
      };

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [oversizedFile] } });
      window.dispatchEvent(dropEvent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const drop = {
        readCount,
        workflowUpdateCount: workflowUpdates.length,
        prevented: dropEvent.defaultPrevented,
        status: document.querySelector('#status-text').textContent,
        toast: document.querySelector('#toast').textContent
      };

      FileReader.prototype.readAsDataURL = function failedRead() {
        readCount += 1;
        this.dispatchEvent(new Event('error'));
      };
      const unreadableFile = { type: 'image/png', size: 1024 };
      const unreadableEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(unreadableEvent, 'dataTransfer', { value: { files: [unreadableFile] } });
      window.dispatchEvent(unreadableEvent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const unreadable = {
        readCount,
        workflowUpdateCount: workflowUpdates.length,
        toast: document.querySelector('#toast').textContent
      };

      FileReader.prototype.readAsDataURL = function acceptedRead() {
        readCount += 1;
        Object.defineProperty(this, 'result', {
          configurable: true,
          value: 'data:image/png;base64,fixture'
        });
        this.dispatchEvent(new Event('load'));
      };
      const boundaryFile = { type: 'image/png', size: 20 * 1024 * 1024 };
      const boundaryEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(boundaryEvent, 'dataTransfer', { value: { files: [boundaryFile] } });
      window.dispatchEvent(boundaryEvent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const boundary = {
        readCount: readCount - unreadable.readCount,
        workflowPhases: workflowUpdates.map((update) => update.phase).filter(Boolean),
        prevented: boundaryEvent.defaultPrevented,
        status: document.querySelector('#status-text').textContent
      };

      FileReader.prototype.readAsDataURL = originalRead;
      unsubscribe();
      return { paste, drop, unreadable, boundary };
    });
    for (const result of [oversizedImageChecks.paste, oversizedImageChecks.drop]) {
      assert.equal(result.readCount, 0, 'Oversized image must be rejected before FileReader');
      assert.equal(result.workflowUpdateCount, 0, 'Oversized image must be rejected before image IPC');
      assert.equal(result.prevented, true);
      assert.match(result.toast, /图片超过 20 MB/);
    }
    assert.equal(oversizedImageChecks.unreadable.readCount, 1);
    assert.equal(oversizedImageChecks.unreadable.workflowUpdateCount, 0);
    assert.match(oversizedImageChecks.unreadable.toast, /请确认图片可以正常打开/);
    assert.equal(oversizedImageChecks.boundary.readCount, 1, 'Exactly 20 MiB should reach FileReader');
    assert.ok(oversizedImageChecks.boundary.workflowPhases.includes('ocr'), 'Exactly 20 MiB should reach the image IPC path');
    assert.equal(oversizedImageChecks.boundary.prevented, true);
    checks.push('Oversized pasted and dropped images are announced and rejected before FileReader or image IPC; the 20 MiB boundary remains accepted');

    const dataUrl = await page.evaluate((text) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1100;
      canvas.height = 250;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#172027';
      context.font = '28px Consolas';
      text.split('\n').forEach((line, index) => context.fillText(line, 28, 55 + index * 55));
      return canvas.toDataURL('image/png');
    }, sample);
    fs.writeFileSync(path.join(artifactDir, 'error-fixture.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    const started = Date.now();
    const ocrResult = await page.evaluate((image) => window.screenLingo.submitImage(image), dataUrl);
    assert.equal(ocrResult.ok, true, JSON.stringify(ocrResult));
    const recognized = await page.locator('#source-text').inputValue();
    assert.match(recognized, /TypeError/);
    assert.match(recognized, /MODULE_NOT_FOUND/);
    assert.equal(requests.length, 0, 'OCR must not contact the translation provider');
    checks.push(`Real offline OCR completes in ${Date.now() - started} ms and recognizes error identifiers`);

    await page.locator('#image-tab').focus();
    for (const [key, selected, other] of [
      ['ArrowRight', 'text', 'image'], ['Home', 'image', 'text'],
      ['End', 'text', 'image'], ['ArrowLeft', 'image', 'text']
    ]) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.activeElement.id), `${selected}-tab`);
      assert.equal(await page.locator(`#${selected}-tab`).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator(`#${selected}-tab`).getAttribute('tabindex'), '0');
      assert.equal(await page.locator(`#${other}-tab`).getAttribute('aria-selected'), 'false');
      assert.equal(await page.locator(`#${other}-tab`).getAttribute('tabindex'), '-1');
      assert.equal(await page.locator(`#${selected}-panel`).isVisible(), true);
      assert.equal(await page.locator(`#${other}-panel`).isVisible(), false);
    }
    checks.push('Source tabs support arrow/Home/End navigation with matching focus, selection, and visible panels');

    await page.locator('#translate-button').click();
    await page.waitForFunction(() => document.querySelector('#translation-output').textContent.includes('类型错误'));
    await page.waitForFunction(() => document.querySelector('#result-announcer').textContent.includes('翻译结果'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'fixture-text');
    assert.equal(requests[0].__authorization, 'Bearer fixture-secret');
    assert.match(requests[0].messages[1].content, /TypeError/);
    await page.locator('#question-input').fill('这个错误的原因是什么？');
    await page.locator('#question-submit').click();
    await page.waitForFunction(() => !document.querySelector('#answer-output').hidden);
    assert.equal(await page.locator('#answer-output').textContent(), answer);
    await page.waitForFunction(() => document.querySelector('#result-announcer').textContent.includes('截图回答'));
    assert.equal(requests[1].messages[1].content[1].image_url.url, dataUrl);
    assert.equal(requests[1].__authorization, 'Bearer fixture-secret');
    await captureScreenshot(page, '03-workbench-light.png');
    checks.push('Translation and screenshot question use the configured provider with correct text/image payloads');

    await page.locator('#question-input').fill(cancelledQuestion);
    await page.locator('#question-submit').click();
    await page.waitForFunction(() => !document.querySelector('#cancel-button').hidden);
    await page.locator('#cancel-button').click();
    await page.waitForFunction(() => document.querySelector('#cancel-button').hidden);
    assert.equal(await page.locator('#question-input').inputValue(), cancelledQuestion);
    checks.push('Cancelling screenshot analysis preserves the unanswered question');

    await page.locator('#theme-toggle').click();
    await captureScreenshot(page, '04-workbench-dark.png');
    await resizeMainWindow(app, page, 720, 560);
    await captureScreenshot(page, '05-workbench-compact.png');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await resizeMainWindow(app, page, 1040, 720);
    checks.push('Light/dark themes and minimum desktop window render without page horizontal overflow');

    const captureWindow = app.waitForEvent('window');
    await page.locator('#capture-button').click();
    const overlay = await captureWindow;
    await overlay.waitForFunction(() => document.querySelector('#screen-image')?.naturalWidth > 0);
    await overlay.keyboard.press('Escape').catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    await page.waitForFunction(() => !document.querySelector('#cancel-button').offsetParent);
    assert.equal(await page.locator('#source-text').inputValue(), recognized);
    assert.equal(await page.locator('#translation-output').textContent(), translation);
    assert.equal(await page.locator('#answer-output').textContent(), answer);
    assert.equal(await page.locator('#result-error').isVisible(), false);
    checks.push('Real desktop capture opens and Escape preserves the previous OCR, translation, and answer');

    const fixtureReady = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow, screen }, image) => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const fixture = new BrowserWindow({ ...display.bounds, frame: false, alwaysOnTop: true,
        backgroundColor: '#ffffff', enableLargerThanScreen: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await fixture.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:white"><img src="${image}" style="position:absolute;left:40px;top:60px;width:650px;height:auto"></body>`)}`);
      fixture.setBounds(display.bounds);
      fixture.setAlwaysOnTop(true, 'pop-up-menu');
      fixture.show();
      fixture.focus();
      return fixture.id;
    }, dataUrl);
    const fixture = await fixtureReady;
    await fixture.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    await fixture.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const croppedWindow = app.waitForEvent('window');
    await page.evaluate(() => { window.captureTestResult = window.screenLingo.captureScreen(); });
    const cropOverlay = await croppedWindow;
    await cropOverlay.waitForFunction(() => document.querySelector('#screen-image')?.naturalWidth > 0);
    await cropOverlay.mouse.move(35, 50);
    await cropOverlay.mouse.down();
    await cropOverlay.mouse.move(700, 225, { steps: 12 });
    await captureScreenshot(cropOverlay, '07-capture-overlay.png');
    await cropOverlay.mouse.up().catch((error) => { if (!/closed/.test(error.message)) throw error; });
    const cropResult = await page.evaluate(() => window.captureTestResult);
    assert.equal(cropResult.ok, true, JSON.stringify(cropResult));
    assert.match(await page.locator('#source-text').inputValue(), /TypeError/);
    assert.match(await page.locator('#source-text').inputValue(), /MODULE_NOT_FOUND/);
    await fixture.evaluate(() => {
      const fixtureImage = document.querySelector('img');
      fixtureImage.style.left = `${Math.round((window.innerWidth - 650) / 2)}px`;
      fixtureImage.style.top = `${Math.round((window.innerHeight - 250) / 2)}px`;
    });
    await fixture.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const keyboardCaptureWindow = app.waitForEvent('window');
    const keyboardCapturePromise = page.evaluate(() => {
      window.keyboardCaptureTestResult = window.screenLingo.captureScreen();
      return true;
    });
    const keyboardOverlay = await keyboardCaptureWindow;
    await keyboardOverlay.waitForFunction(() => document.querySelector('#screen-image')?.naturalWidth > 0);
    await keyboardOverlay.keyboard.press('k');
    assert.equal(await keyboardOverlay.locator('#selection').isVisible(), true);
    const initialKeyboardRect = await keyboardOverlay.evaluate(() => ({
      width: Number.parseFloat(document.querySelector('#selection').style.width),
      height: Number.parseFloat(document.querySelector('#selection').style.height)
    }));
    const keyboardViewportWidth = await keyboardOverlay.evaluate(() => window.innerWidth);
    await keyboardOverlay.keyboard.press('ArrowLeft');
    await keyboardOverlay.keyboard.press('Shift+ArrowRight');
    const movedKeyboardRect = await keyboardOverlay.evaluate(() => ({
      x: Number.parseFloat(document.querySelector('#selection').style.left),
      width: Number.parseFloat(document.querySelector('#selection').style.width)
    }));
    assert.equal(movedKeyboardRect.x, Math.max(0, Math.round((keyboardViewportWidth - initialKeyboardRect.width) / 2) - 10));
    assert.equal(movedKeyboardRect.width, initialKeyboardRect.width + 10);
    await keyboardOverlay.keyboard.press('Enter').catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    await keyboardCapturePromise;
    const keyboardCaptureResult = await page.evaluate(() => window.keyboardCaptureTestResult);
    assert.equal(keyboardCaptureResult.ok, true, JSON.stringify(keyboardCaptureResult));
    await page.waitForFunction(() => document.querySelector('#source-text').value.includes('TypeError'));
    await captureScreenshot(page, '06-captured-fixture.png');
    checks.push('Real desktop drag selection crops a synthetic error window and completes offline OCR');

    const failedCaptureWindow = app.waitForEvent('window');
    const failedCapturePromise = page.evaluate(() => window.screenLingo.captureScreen());
    const failedOverlay = await failedCaptureWindow;
    await failedOverlay.waitForFunction(() => document.querySelector('#screen-image')?.naturalWidth > 0);
    await failedOverlay.keyboard.press('k');
    const viewportCanBeOverridden = await failedOverlay.evaluate(() => {
      window.captureTestViewportWidth = window.innerWidth;
      try {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
        return window.innerWidth === 0;
      } catch {
        return false;
      }
    });
    assert.equal(viewportCanBeOverridden, true, 'Capture test must be able to inject an invalid viewport');
    await failedOverlay.keyboard.press('Enter').catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    await failedOverlay.waitForFunction(() => {
      const error = document.querySelector('#capture-error');
      return error && !error.hidden && error.textContent.includes('截图提交失败');
    });
    assert.equal(await failedOverlay.locator('#capture-error').isVisible(), true);
    await failedOverlay.evaluate(() => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: window.captureTestViewportWidth
      });
    });
    await failedOverlay.keyboard.press('Enter').catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    const failedCaptureResult = await failedCapturePromise;
    assert.equal(failedCaptureResult.ok, true, JSON.stringify(failedCaptureResult));
    checks.push('Capture submission errors are announced, recoverable, and retry without an unhandled rejection');

    await page.evaluate(() => { document.querySelector('#source-text').value = 'x'.repeat(60_001); });
    await page.locator('#copy-source-button').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('复制内容为空或过长'));
    await page.evaluate((value) => { document.querySelector('#source-text').value = value; }, recognized);
    checks.push('Image-read and clipboard-write failures are reported without unhandled rejections');

    const conflict = await page.evaluate(() => window.screenLingo.saveSettings({ screenshotHotkey: 'Alt+Shift+F9', clipboardHotkey: 'Alt+Shift+F9' }));
    assert.equal(conflict.ok, false);
    const hotkeys = await app.evaluate(({ globalShortcut }) => [
      globalShortcut.isRegistered('Alt+Shift+F9'), globalShortcut.isRegistered('Alt+Shift+F10')
    ]);
    assert.deepEqual(hotkeys, [true, true]);
    checks.push('Hotkey conflicts preserve original settings and both registered shortcuts');

    await page.locator('#settings-open').click();
    assert.equal(await page.locator('#api-key-clear').isVisible(), true);
    await page.locator('#api-key-clear').click();
    assert.match(await page.locator('#api-key-state').textContent(), /保存后清除/);
    await page.locator('#settings-save').click();
    await page.waitForFunction(() => document.querySelector('#settings-view').hidden);
    assert.equal((await page.evaluate(() => window.screenLingo.getSettings())).hasApiKey, false);
    checks.push('Saved API keys can be explicitly removed from settings');

    assert.deepEqual(errors, []);
    fs.rmSync(path.join(artifactDir, 'failure.json'), { force: true });
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify({ appInfo, checks, errors, recognized }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', artifactDir, checks }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(artifactDir, 'failure.json'), JSON.stringify({ checks, errors, message: error.message, stack: error.stack }, null, 2));
    throw error;
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..', '..');
const artifactDir = path.join(root, 'artifacts', process.env.SCREENLINGO_EXE ? 'glass-packaged' : 'glass');
const sample = 'TypeError: Cannot read properties of undefined\n    at main (src/index.js:42:7)\nError: MODULE_NOT_FOUND';
const translation = '类型错误：无法读取未定义对象的属性\n    at main (src/index.js:42:7)\n错误：未找到模块';
const checks = [];
const errors = [];
const sizes = [];

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const finite = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
}

async function screenshot(page, name) {
  await settle(page);
  await page.screenshot({ path: path.join(artifactDir, name), animations: 'disabled' });
}

async function resize(app, page, width, height) {
  const contentSize = await app.evaluate(({ BrowserWindow }, size) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/index.html'));
    main.setSize(size.width, size.height);
    return main.getContentSize();
  }, { width, height });
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, contentSize);
  sizes.push({ requested: [width, height], content: contentSize });
}

async function noOverflow(page, selector) {
  await settle(page);
  const overflowing = await page.evaluate((selector) => {
    return [document.documentElement, document.querySelector('#app-shell'), document.querySelector('.main-content'), document.querySelector(selector)]
      .filter(Boolean).filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.id || element.tagName);
  }, selector);
  assert.deepEqual(overflowing, [], `Horizontal overflow in ${selector}`);
}

function watchErrors(page) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
}

async function run() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifactDir, 'profile-'));
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the synthetic translation request. */ }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: translation } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    provider: 'openai', endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    networkMode: 'direct', model: 'glass-fixture', visionModel: 'glass-fixture',
    screenshotHotkey: 'Ctrl+Alt+F9', clipboardHotkey: 'Ctrl+Alt+F10', selectionHotkey: 'Ctrl+Alt+F11',
    autoTranslate: false, closeToTray: false, shellIntegration: false, theme: 'light'
  }));
  const env = { ...process.env, SCREENLINGO_TEST_PROFILE: profile, SCREENLINGO_DISABLE_SHELL_INTEGRATION: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = Boolean(process.env.SCREENLINGO_EXE);
  let app;
  let page;
  try {
    app = await electron.launch({
      executablePath: packaged ? process.env.SCREENLINGO_EXE : require('electron'),
      args: packaged ? [`--user-data-dir=${profile}`] : [path.join(__dirname, 'launch.cjs')],
      env, timeout: 30000
    });
    app.on('window', watchErrors);
    page = await app.firstWindow();
    watchErrors(page);
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.screenLingo && document.querySelector('#settings-open svg') && document.documentElement.dataset.theme === 'light');
    const actualProfile = await app.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(path.resolve(actualProfile), path.resolve(profile));

    await page.locator('#settings-open').click();
    await page.locator('label').filter({ has: page.locator('input[name="theme"][value="glass"]') }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'glass');
    await page.locator('#settings-save').click();
    await page.waitForFunction(() => document.querySelector('#settings-view').hidden);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).theme, 'glass');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'glass' && document.querySelector('#settings-open svg'));
    checks.push('Glass selected through settings persists to disk and survives renderer reload');

    for (const [width, height] of [[1040, 720], [1440, 900], [720, 560]]) {
      await resize(app, page, width, height);
      await noOverflow(page, '#empty-view');
      await screenshot(page, `home-${width}x${height}.png`);
    }
    checks.push('Home has no horizontal overflow at 1040×720, 1440×900, and 720×560');

    await resize(app, page, 1040, 720);
    const card = page.locator('#empty-clipboard-button');
    await card.hover();
    await page.waitForFunction(() => document.querySelector('#empty-clipboard-button').classList.contains('glass-hover'));
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => !document.querySelector('#empty-clipboard-button').classList.contains('glass-hover'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card.hover();
    await settle(page);
    assert.equal(await card.evaluate((element) => element.classList.contains('glass-hover')), false);
    assert.equal(await card.evaluate((element) => getComputedStyle(element, '::after').display), 'none');
    assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.mouse.move(2, 2);
    await settle(page);
    assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity && animation.playState === 'running').length), 0);
    checks.push('Pointer glow responds on demand, stops on leave/reduced motion, and the idle UI has no continuous animation');

    await page.locator('#settings-open').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-title');
    await noOverflow(page, '#settings-view');
    await page.locator('section[aria-labelledby="theme-heading"]').scrollIntoViewIfNeeded();
    await screenshot(page, 'settings-1040x720.png');
    await page.locator('input[name="theme"][value="glass"]').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'glass');
    await resize(app, page, 720, 560);
    await noOverflow(page, '#settings-view');
    await page.locator('section[aria-labelledby="theme-heading"]').scrollIntoViewIfNeeded();
    await screenshot(page, 'settings-720x560.png');
    await page.locator('#settings-back').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-open');
    checks.push('Theme radios support keyboard arrows; settings focus and compact layout remain usable');

    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
    assert.equal(await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).backdropFilter), 'none');
    await screenshot(page, 'home-high-contrast.png');
    await page.emulateMedia({ forcedColors: 'none' });
    checks.push('Windows forced-colors mode removes glass blur and retains visible surfaces');

    // Use a synthetic screen through the normal capture-window lifecycle so
    // screenshots of this regression test cannot contain the user's desktop.
    const captureFixture = await page.evaluate((sample) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1440;
      canvas.height = 900;
      const context = canvas.getContext('2d');
      context.fillStyle = '#18222c';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#0d131b';
      context.fillRect(160, 140, 1120, 580);
      context.fillStyle = '#98abbc';
      context.font = '20px Consolas';
      context.fillText('Terminal · ScreenLingo test fixture', 200, 195);
      context.fillStyle = '#f1f7ff';
      context.font = '24px Consolas';
      sample.split('\n').forEach((line, index) => context.fillText(line, 200, 300 + index * 60));
      return canvas.toDataURL('image/png');
    }, sample);
    await app.evaluate(({ desktopCapturer, nativeImage, screen }, fixture) => {
      globalThis.__glassGetSources = desktopCapturer.getSources;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const thumbnail = nativeImage.createFromDataURL(fixture);
      desktopCapturer.getSources = async () => [{ display_id: String(display.id), thumbnail }];
    }, captureFixture);
    try {
      const captureReady = app.waitForEvent('window', { timeout: 15000 });
      await page.evaluate(() => { window.__glassCaptureResult = window.screenLingo.captureScreen(); });
      const capture = await captureReady;
      await capture.waitForURL(/\/capture\.html(?:\?|$)/);
      await capture.waitForFunction(() => document.querySelector('#screen-image')?.naturalWidth > 0);
      assert.equal(await capture.locator('html').getAttribute('data-theme'), 'glass');
      assert.equal(await capture.locator('#selection').evaluate((element) => getComputedStyle(element).borderTopColor), 'rgb(116, 232, 245)');
      const hintColor = await capture.locator('.capture-mark').evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.doesNotMatch(hintColor, /39, 36, 57/, 'Capture hint must not retain the old purple surface');
      await capture.mouse.move(220, 160);
      await capture.locator('#cursor-x').waitFor({ state: 'visible' });
      await screenshot(capture, 'capture-guides.png');
      await capture.keyboard.press('k');
      await capture.locator('#selection').waitFor({ state: 'visible' });
      const beforeMove = await capture.locator('#selection').boundingBox();
      await capture.keyboard.press('ArrowRight');
      const afterMove = await capture.locator('#selection').boundingBox();
      assert.equal(afterMove.x, beforeMove.x + 10);
      await screenshot(capture, 'capture-selection.png');
      await capture.emulateMedia({ forcedColors: 'active' });
      assert.equal(await capture.locator('.capture-mark').evaluate((element) => getComputedStyle(element).backdropFilter), 'none');
      await capture.keyboard.press('Escape').catch((error) => {
        if (!/closed/i.test(error.message)) throw error;
      });
      const cancelled = await page.evaluate(() => window.__glassCaptureResult);
      assert.equal(cancelled.cancelled, true, JSON.stringify(cancelled));
      checks.push('Capture inherits the saved glass theme, renders cyan guides and selection, and retains keyboard movement, cancellation, and forced-colors support');
    } finally {
      await app.evaluate(({ desktopCapturer }) => {
        desktopCapturer.getSources = globalThis.__glassGetSources;
        delete globalThis.__glassGetSources;
      });
    }

    await page.evaluate(({ sample, translation }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 880;
      canvas.height = 260;
      const context = canvas.getContext('2d');
      context.fillStyle = '#132538';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#e7f2ff';
      context.font = '22px Consolas';
      sample.split('\n').forEach((line, index) => context.fillText(line, 24, 65 + index * 55));
      window.applyWorkflowUpdate({
        phase: 'ready', imageDataUrl: canvas.toDataURL('image/png'), sourceText: sample,
        translation, providerLabel: '测试服务', statusMessage: '翻译完成'
      });
    }, { sample, translation });
    for (const [width, height] of [[1040, 720], [1440, 900], [720, 560]]) {
      await resize(app, page, width, height);
      await noOverflow(page, '#workbench');
      await screenshot(page, `workbench-${width}x${height}.png`);
    }
    await page.locator('#image-tab').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#text-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#source-text').inputValue(), sample);
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#image-tab').getAttribute('aria-selected'), 'true');
    checks.push('Synthetic screenshot/text results remain readable across all three window sizes and source tabs retain keyboard behavior');

    const [quick, dispatched] = await Promise.all([
      app.waitForEvent('window', { timeout: 15000 }),
      app.evaluate(({ app, clipboard }, sample) => {
        // Exercise the normal quick-action route with synthetic text, without
        // reading or overwriting the user's clipboard or importing internals.
        const readText = clipboard.readText;
        clipboard.readText = () => sample;
        try {
          return app.emit('second-instance', {}, ['--quick-action=clipboard']);
        } finally {
          clipboard.readText = readText;
        }
      }, sample)
    ]);
    assert.equal(dispatched, true, 'The quick-action handler must be registered');
    quick.setDefaultTimeout(15000);
    await quick.waitForURL(/\/quick\.html$/);
    await quick.waitForFunction(() => document.querySelector('#quick-translation')?.textContent.includes('类型错误'));
    assert.equal(await quick.locator('html').getAttribute('data-theme'), 'glass');
    await noOverflow(quick, '#quick-shell');
    await screenshot(quick, 'quick-result.png');
    await quick.emulateMedia({ reducedMotion: 'reduce' });
    await settle(quick);
    assert.equal(await quick.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0);
    await quick.locator('#quick-close').click().catch((error) => {
      if (!/closed/i.test(error.message)) throw error;
    });
    checks.push('Quick translation uses the saved glass theme with a local mock provider and honors reduced motion');

    assert.deepEqual(errors, [], 'Renderer errors or CSP violations');
    const report = { status: 'PASS', checks, sizes, boundaries: 'Synthetic images and local mock translation only; no system clipboard reads/writes and no third-party requests.' };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifactDir, 'failure.png'), animations: 'disabled' }).catch(() => {});
    fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify({ status: 'FAIL', checks, errors, message: error.stack }, null, 2)}\n`);
    throw error;
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '../..');
  const portablePath = process.env.SCREENLINGO_EXE
    ? path.resolve(process.env.SCREENLINGO_EXE)
    : path.join(root, 'dist/ScreenLingo-0.1.0-x64.exe');
  const artifactDir = path.join(root, 'artifacts/portable');
  fs.mkdirSync(artifactDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifactDir, 'profile-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    provider: 'bing', networkMode: 'auto', autoTranslate: false, closeToTray: false,
    screenshotHotkey: 'Alt+Shift+F9', clipboardHotkey: 'Alt+Shift+F10'
  }));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // The NSIS launcher does not forward inspector output to Electron's launcher API.
  const child = spawn(portablePath, [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1'
  ], { env, windowsHide: true, stdio: 'ignore' });
  let launchError;
  console.log(`Portable launcher PID: ${child.pid}`);
  child.on('error', (error) => { launchError = error; });
  let browser;
  try {
    let ready = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Portable launcher exited: ${child.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        ready = response.ok;
        await response.body?.cancel();
      } catch { /* The portable launcher is still extracting or starting. */ }
      if (ready) break;
      await delay(250);
    }
    assert.equal(ready, true, 'Portable application did not open its test connection');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await page.waitForFunction(() => window.screenLingo && document.querySelector('#settings-open svg'));
    assert.equal((await page.evaluate(() => window.screenLingo.getSettings())).closeToTray, false);
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 150;
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = 'white';
      drawing.fillRect(0, 0, 1000, 150);
      drawing.fillStyle = 'black';
      drawing.font = '28px Consolas';
      drawing.fillText('TypeError: Cannot read properties of undefined', 25, 60);
      return window.screenLingo.submitImage(canvas.toDataURL('image/png'));
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const recognized = await page.locator('#source-text').inputValue();
    assert.match(recognized, /TypeError/);
    const route = await page.evaluate(() => window.screenLingo.getNetworkStatus({ networkMode: 'direct' }));
    assert.equal(route.label, '直连');
    await page.screenshot({ path: path.join(artifactDir, 'portable-ocr.png') });
    const report = { status: 'PASS', recognized, checks: ['Portable extraction and startup', 'Isolated settings', 'Bundled offline OCR', 'Network settings IPC'] };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) {
      for (const page of browser.contexts()[0]?.pages() || []) {
        await page.evaluate(() => window.close()).catch(() => {});
      }
      await browser.close();
    }
    for (let attempt = 0; child.exitCode === null && attempt < 20; attempt += 1) await delay(250);
    if (child.exitCode === null && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already exited. */ }
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

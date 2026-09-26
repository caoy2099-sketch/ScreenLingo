'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

// This opt-in test sends only this synthetic error to public translation services.
const sample = 'TypeError: Cannot read properties of undefined';
const artifactDir = path.resolve(__dirname, '../../artifacts/network');
fs.mkdirSync(artifactDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifactDir, 'profile-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  provider: 'bing', networkMode: 'direct', screenshotHotkey: 'Alt+Shift+F9',
  clipboardHotkey: 'Alt+Shift+F10', closeToTray: false
}));

async function run() {
  const env = { ...process.env, SCREENLINGO_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.SCREENLINGO_EXE || require('electron'),
    args: process.env.SCREENLINGO_EXE ? [`--user-data-dir=${profile}`] : [path.join(__dirname, 'launch.cjs')],
    env, timeout: 30000
  });
  const results = [];
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.screenLingo));
    for (const settings of [
      { provider: 'bing', networkMode: 'direct' },
      { provider: 'bing', networkMode: 'auto' },
      { provider: 'bing', networkMode: 'manual', proxyUrl: 'socks5://127.0.0.1:10808' },
      { provider: 'google', networkMode: 'auto' }
    ]) {
      const saved = await page.evaluate((value) => window.screenLingo.saveSettings(value), settings);
      assert.equal(saved.ok, true);
      const route = await page.evaluate(() => window.screenLingo.getNetworkStatus());
      assert.equal(route.ok, true);
      const started = Date.now();
      const response = await page.evaluate((text) => window.screenLingo.translateText(text), sample);
      const output = await page.locator('#translation-output').textContent();
      const record = { ...settings, route: route.label, elapsedMs: Date.now() - started,
        ok: response.ok && /[\u4e00-\u9fff]/.test(output), output, error: response.error };
      results.push(record);
      console.log(JSON.stringify(record));
    }
    assert.equal(results.every((result) => result.ok), true, 'One or more live network routes failed');
  } finally {
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify({ sample, results }, null, 2));
    await app.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

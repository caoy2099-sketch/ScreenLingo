'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'assets');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'screenlingo-showcase-'));

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    provider: 'bing',
    networkMode: 'auto',
    proxyUrl: 'socks5://127.0.0.1:10808',
    screenshotHotkey: 'Alt+Shift+S',
    clipboardHotkey: 'Alt+Shift+T',
    autoTranslate: false,
    closeToTray: false,
    theme: 'light'
  }));

  const env = { ...process.env, SCREENLINGO_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'tests', 'e2e', 'launch.cjs')],
    env,
    timeout: 30000
  });

  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.screenLingo && document.querySelector('#settings-open svg'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await page.screenshot({ path: path.join(outputDir, 'screenlingo-home.png') });

    const fixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1100;
      canvas.height = 250;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#172027';
      context.font = '28px Consolas';
      [
        'TypeError: Cannot read properties of undefined',
        '    at main (src/index.js:42:7)',
        'Error: MODULE_NOT_FOUND'
      ].forEach((line, index) => context.fillText(line, 28, 55 + index * 55));
      return canvas.toDataURL('image/png');
    });
    const result = await page.evaluate((image) => window.screenLingo.submitImage(image), fixture);
    if (!result?.ok) throw new Error(result?.error || 'Showcase OCR failed.');
    await page.waitForFunction(() => document.querySelector('#source-text').value.includes('TypeError'));
    await page.evaluate(() => window.applyWorkflowUpdate({
      phase: 'ready',
      translation: '类型错误：无法读取未定义对象的属性\n    at main (src/index.js:42:7)\n错误：未找到模块',
      providerLabel: '必应',
      networkLabel: '自动网络',
      statusMessage: '翻译完成'
    }));
    await page.screenshot({ path: path.join(outputDir, 'screenlingo-workbench.png') });
    console.log(`README screenshots written to ${outputDir}`);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

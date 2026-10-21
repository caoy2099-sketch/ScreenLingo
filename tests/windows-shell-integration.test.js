'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHELL_ACTIONS,
  SHELL_INTEGRATION_ROOTS,
  WindowsShellIntegration,
  buildActionCommand,
  quoteWindowsArgument,
  resolveLaunchExecutable
} = require('../src/main/windows-shell-integration');

const baseOptions = {
  execPath: 'C:\\Program Files\\ScreenLingo\\ScreenLingo.exe',
  appPath: 'C:\\Projects\\ScreenLingo',
  isPackaged: true,
  portableExecutable: '',
  fileExists: () => false
};

test('buildActionCommand quotes packaged and development launch paths', () => {
  assert.equal(
    buildActionCommand({ ...baseOptions, action: '--quick-action=capture' }),
    '"C:\\Program Files\\ScreenLingo\\ScreenLingo.exe" --quick-action=capture'
  );
  assert.equal(
    buildActionCommand({
      ...baseOptions,
      action: '--quick-action=clipboard',
      isPackaged: false
    }),
    '"C:\\Program Files\\ScreenLingo\\ScreenLingo.exe" "C:\\Projects\\ScreenLingo" --quick-action=clipboard'
  );
  assert.throws(
    () => buildActionCommand({ ...baseOptions, action: '--quick-action=evil' }),
    /未知的 Windows 右键菜单操作/
  );
});

test('portable builds prefer the original portable executable when it exists', () => {
  assert.equal(
    resolveLaunchExecutable({
      execPath: 'C:\\Temp\\extracted\\ScreenLingo.exe',
      isPackaged: true,
      portableExecutable: 'D:\\Apps\\ScreenLingo.exe',
      fileExists: () => true
    }),
    'D:\\Apps\\ScreenLingo.exe'
  );
  assert.equal(
    resolveLaunchExecutable({
      execPath: 'C:\\Temp\\extracted\\ScreenLingo.exe',
      isPackaged: true,
      portableExecutable: 'D:\\Apps\\ScreenLingo.exe',
      fileExists: () => false
    }),
    'C:\\Temp\\extracted\\ScreenLingo.exe'
  );
});

test('quoteWindowsArgument rejects empty and quote-containing values', () => {
  assert.equal(quoteWindowsArgument('C:\\a b\\app.exe'), '"C:\\a b\\app.exe"');
  assert.throws(() => quoteWindowsArgument(''), /不能为空/);
  assert.throws(() => quoteWindowsArgument('C:\\bad"path'), /无效字符/);
});

test('WindowsShellIntegration writes only per-user shell verbs and reports success', async () => {
  const calls = [];
  const service = new WindowsShellIntegration({
    ...baseOptions,
    execFileImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: 'ok' };
    }
  });

  const result = await service.install();
  assert.deepEqual(result, { ok: true, installed: true });
  assert.equal(service.getStatus().installed, true);
  assert.equal(calls.length, SHELL_INTEGRATION_ROOTS.length * SHELL_ACTIONS.length * 3);
  for (const call of calls) {
    assert.match(call.file, /reg\.exe$/i);
    assert.equal(call.options.windowsHide, true);
    assert.ok(call.args.some((argument) => argument.startsWith('HKCU\\Software\\Classes\\')));
    assert.equal(call.args.some((argument) => /^HKLM/i.test(argument)), false);
  }
  assert.ok(calls.some((call) => call.args.includes('截译 · 截屏翻译')));
  assert.ok(calls.some((call) => call.args.some((argument) => argument.includes('--quick-action=capture'))));
  assert.ok(calls.some((call) => call.args.includes('截译 · 翻译剪贴板')));
});

test('WindowsShellIntegration removes entries and tolerates already-missing verbs', async () => {
  const calls = [];
  const service = new WindowsShellIntegration({
    ...baseOptions,
    execFileImpl: async (file, args) => {
      calls.push({ file, args });
      if (calls.length === 1) {
        const error = new Error('missing');
        error.code = 1;
        throw error;
      }
      return { stdout: 'ok' };
    }
  });

  const result = await service.remove();
  assert.deepEqual(result, { ok: true, installed: false });
  assert.equal(service.getStatus().installed, false);
  assert.equal(calls.length, SHELL_INTEGRATION_ROOTS.length * SHELL_ACTIONS.length);
  assert.ok(calls.every((call) => call.args[0] === 'delete' && call.args.includes('/f')));
});

test('WindowsShellIntegration reports a reversible failure without throwing', async () => {
  const service = new WindowsShellIntegration({
    ...baseOptions,
    execFileImpl: async () => {
      throw new Error('registry denied');
    }
  });
  const installResult = await service.install();
  assert.equal(installResult.ok, false);
  assert.equal(installResult.installed, false);
  assert.match(installResult.error, /无法写入/);
  assert.equal(service.getStatus().installed, false);
  assert.equal(service.getStatus().error, installResult.error);

  const removeResult = await service.remove();
  assert.equal(removeResult.ok, false);
  assert.match(removeResult.error, /无法移除/);
});

test('WindowsShellIntegration is a no-op on non-Windows platforms', async () => {
  const service = new WindowsShellIntegration({
    ...baseOptions,
    platform: 'linux',
    execFileImpl: async () => {
      throw new Error('must not run');
    }
  });
  assert.deepEqual(await service.install(), { ok: true, installed: false, skipped: true });
  assert.deepEqual(await service.remove(), { ok: true, installed: false, skipped: true });
});

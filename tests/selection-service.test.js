'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SELECTION_TEXT_LENGTH,
  SelectionService,
  parseSelectionOutput
} = require('../src/main/selection-service');

const marker = 'SCREENLINGO_SELECTION:';

function encodePayload(payload) {
  return marker + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

test('parseSelectionOutput reads the last marked JSON payload', () => {
  const stdout = [
    'noise from Windows PowerShell',
    encodePayload({ ok: true, text: '  selected text 你好  ', error: '' }),
    ''
  ].join('\r\n');
  assert.deepEqual(parseSelectionOutput(stdout), {
    ok: true,
    text: 'selected text 你好',
    error: '',
    code: ''
  });
});

test('parseSelectionOutput accepts the legacy plain JSON marker and rejects invalid base64', () => {
  assert.equal(
    parseSelectionOutput(`${marker}${JSON.stringify({ ok: true, text: 'legacy' })}`).text,
    'legacy'
  );
  assert.equal(parseSelectionOutput(`${marker}not-base64`).code, 'INVALID_OUTPUT');
});

test('parseSelectionOutput caps oversized selections', () => {
  const text = 'x'.repeat(MAX_SELECTION_TEXT_LENGTH + 100);
  const result = parseSelectionOutput(encodePayload({ ok: true, text }));
  assert.equal(result.ok, true);
  assert.equal(result.text.length, MAX_SELECTION_TEXT_LENGTH);
});

test('parseSelectionOutput reports missing, malformed, and protected selections', () => {
  assert.equal(parseSelectionOutput('').code, 'INVALID_OUTPUT');
  assert.equal(parseSelectionOutput(`${marker}{not-json`).code, 'INVALID_OUTPUT');
  const missing = parseSelectionOutput(encodePayload({ ok: false, error: 'No selected text' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'NO_SELECTION');
  assert.match(missing.error, /没有读取到选中文本/);

  const protectedResult = parseSelectionOutput(
    encodePayload({ ok: false, error: 'The active control is a password field.' })
  );
  assert.equal(protectedResult.code, 'PROTECTED_CONTROL');
  assert.match(protectedResult.error, /密码框/);
});

test('SelectionService invokes Windows PowerShell with the fixed reader script', async () => {
  const invocations = [];
  const service = new SelectionService({
    scriptPath: 'C:\\app\\selection-reader.ps1',
    systemRoot: 'C:\\Windows',
    execFileImpl: async (file, args, options) => {
      invocations.push({ file, args, options });
      return { stdout: encodePayload({ ok: true, text: 'From UI Automation 你好' }) };
    }
  });

  const result = await service.readSelectedText();
  assert.equal(result.ok, true);
  assert.equal(result.text, 'From UI Automation 你好');
  assert.equal(invocations.length, 1);
  assert.match(invocations[0].file, /powershell\.exe$/i);
  assert.deepEqual(invocations[0].args.slice(0, 7), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File'
  ]);
  assert.equal(invocations[0].args[7], 'C:\\app\\selection-reader.ps1');
  assert.equal(invocations[0].options.windowsHide, true);
  assert.equal(invocations[0].options.encoding, 'utf8');
});

test('SelectionService maps timeouts, reader failures, unsupported platforms, and missing scripts', async () => {
  const timeoutService = new SelectionService({
    scriptPath: 'reader.ps1',
    execFileImpl: async () => {
      const error = new Error('timed out');
      error.killed = true;
      throw error;
    }
  });
  assert.equal((await timeoutService.readSelectedText()).code, 'TIMEOUT');

  const failureService = new SelectionService({
    scriptPath: 'reader.ps1',
    execFileImpl: async () => {
      throw new Error('spawn failed');
    }
  });
  assert.equal((await failureService.readSelectedText()).code, 'READER_FAILED');

  const unsupportedService = new SelectionService({
    scriptPath: 'reader.ps1',
    platform: 'linux',
    execFileImpl: async () => {
      throw new Error('must not run');
    }
  });
  assert.equal((await unsupportedService.readSelectedText()).code, 'UNSUPPORTED_PLATFORM');

  const missingService = new SelectionService({ execFileImpl: async () => ({ stdout: '' }) });
  assert.equal((await missingService.readSelectedText()).code, 'MISSING_READER');
});

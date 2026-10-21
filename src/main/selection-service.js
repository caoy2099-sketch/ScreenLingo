'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SELECTION_MARKER = 'SCREENLINGO_SELECTION:';
const MAX_SELECTION_TEXT_LENGTH = 20_000;
const DEFAULT_TIMEOUT_MS = 2_500;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const POWERSHELL_RELATIVE_PATH = path.join(
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

function selectionError(message, code = 'SELECTION_UNAVAILABLE') {
  return { ok: false, text: '', error: message, code };
}

function parseSelectionOutput(stdout) {
  const output = typeof stdout === 'string' ? stdout : String(stdout || '');
  const lines = output.split(/\r?\n/).filter((line) => line.trim().startsWith(SELECTION_MARKER));
  if (lines.length === 0) {
    return selectionError('无法读取选中文本，请重试或使用剪贴板翻译。', 'INVALID_OUTPUT');
  }

  const line = lines[lines.length - 1].trim();
  const encoded = line.slice(SELECTION_MARKER.length).trim();
  let parsed;
  try {
    const json = encoded.startsWith('{')
      ? encoded
      : Buffer.from(encoded, 'base64').toString('utf8').trim();
    parsed = JSON.parse(json);
  } catch {
    return selectionError('选中文本读取结果无效，请重试。', 'INVALID_OUTPUT');
  }

  const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  if (parsed?.ok === true && text) {
    return {
      ok: true,
      text: text.slice(0, MAX_SELECTION_TEXT_LENGTH),
      error: '',
      code: ''
    };
  }

  if (parsed?.error === 'The active control is a password field.') {
    return selectionError('当前控件是密码框，不会读取其中的内容。', 'PROTECTED_CONTROL');
  }
  return selectionError(
    '没有读取到选中文本。请先选中文字，或复制后使用剪贴板翻译。',
    'NO_SELECTION'
  );
}

class SelectionService {
  constructor({
    scriptPath,
    execFileImpl = execFileAsync,
    platform = process.platform,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    systemRoot = process.env.SystemRoot || 'C:\\Windows'
  } = {}) {
    this.scriptPath = scriptPath;
    this.execFileImpl = execFileImpl;
    this.platform = platform;
    this.timeoutMs = timeoutMs;
    this.powershellPath = path.join(systemRoot, POWERSHELL_RELATIVE_PATH);
  }

  async readSelectedText() {
    if (this.platform !== 'win32') {
      return selectionError('选中文本读取仅支持 Windows。', 'UNSUPPORTED_PLATFORM');
    }
    if (typeof this.scriptPath !== 'string' || !this.scriptPath) {
      return selectionError('选中文本读取组件缺失。', 'MISSING_READER');
    }

    try {
      const result = await this.execFileImpl(
        this.powershellPath,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.scriptPath
        ],
        {
          encoding: 'utf8',
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: this.timeoutMs,
          windowsHide: true
        }
      );
      return parseSelectionOutput(result?.stdout);
    } catch (error) {
      if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
        return selectionError('读取选中文本超时，请重试或使用剪贴板翻译。', 'TIMEOUT');
      }
      return selectionError(
        '无法读取选中文本。请重试，或复制后使用剪贴板翻译。',
        'READER_FAILED'
      );
    }
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  MAX_SELECTION_TEXT_LENGTH,
  SelectionService,
  parseSelectionOutput
};

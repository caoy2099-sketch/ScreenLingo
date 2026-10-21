'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SHELL_INTEGRATION_ROOTS = Object.freeze([
  'HKCU\\Software\\Classes\\DesktopBackground\\shell',
  'HKCU\\Software\\Classes\\Directory\\Background\\shell'
]);
const SHELL_ACTIONS = Object.freeze([
  {
    key: 'ScreenLingoScreenshot',
    flag: '--quick-action=capture',
    label: '截译 · 截屏翻译'
  },
  {
    key: 'ScreenLingoClipboard',
    flag: '--quick-action=clipboard',
    label: '截译 · 翻译剪贴板'
  }
]);

function quoteWindowsArgument(value) {
  const normalized = String(value || '');
  if (!normalized) throw new TypeError('启动路径不能为空。');
  if (normalized.includes('"')) throw new TypeError('启动路径包含无效字符。');
  return `"${normalized}"`;
}

function resolveLaunchExecutable({
  execPath,
  isPackaged,
  portableExecutable,
  fileExists = fs.existsSync
}) {
  if (
    isPackaged
    && typeof portableExecutable === 'string'
    && portableExecutable.trim()
    && fileExists(portableExecutable)
  ) {
    return portableExecutable;
  }
  return execPath;
}

function buildActionCommand({
  action,
  execPath,
  appPath,
  isPackaged,
  portableExecutable,
  fileExists = fs.existsSync
}) {
  if (!SHELL_ACTIONS.some((entry) => entry.flag === action)) {
    throw new TypeError('未知的 Windows 右键菜单操作。');
  }
  const executable = resolveLaunchExecutable({
    execPath,
    isPackaged,
    portableExecutable,
    fileExists
  });
  const parts = [quoteWindowsArgument(executable)];
  if (!isPackaged) {
    parts.push(quoteWindowsArgument(appPath));
  }
  parts.push(action);
  return parts.join(' ');
}

function shellEntryPaths(root, key) {
  return [
    `${root}\\${key}`,
    `${root}\\${key}\\command`
  ];
}

class WindowsShellIntegration {
  constructor({
    execPath = process.execPath,
    appPath = process.cwd(),
    isPackaged = false,
    portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE,
    platform = process.platform,
    env = process.env,
    execFileImpl = execFileAsync,
    fileExists = fs.existsSync
  } = {}) {
    this.execPath = execPath;
    this.appPath = appPath;
    this.isPackaged = isPackaged;
    this.portableExecutable = portableExecutable;
    this.platform = platform;
    this.env = env;
    this.execFileImpl = execFileImpl;
    this.fileExists = fileExists;
    this.regPath = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    this.installed = false;
    this.lastError = '';
    this.operationQueue = Promise.resolve();
  }

  get supported() {
    return this.platform === 'win32';
  }

  commandFor(flag) {
    return buildActionCommand({
      action: flag,
      execPath: this.execPath,
      appPath: this.appPath,
      isPackaged: this.isPackaged,
      portableExecutable: this.portableExecutable,
      fileExists: this.fileExists
    });
  }

  iconValue() {
    const executable = resolveLaunchExecutable({
      execPath: this.execPath,
      isPackaged: this.isPackaged,
      portableExecutable: this.portableExecutable,
      fileExists: this.fileExists
    });
    return `"${executable}",0`;
  }

  async runReg(args) {
    return this.execFileImpl(this.regPath, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 128 * 1024
    });
  }

  async addValue(key, value) {
    await this.runReg(['add', key, '/ve', '/d', value, '/f']);
  }

  enqueue(operation) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => {});
    return result;
  }

  install() {
    return this.enqueue(() => this.performInstall());
  }

  async performInstall() {
    if (!this.supported) {
      this.installed = false;
      return { ok: true, installed: false, skipped: true };
    }
    try {
      for (const root of SHELL_INTEGRATION_ROOTS) {
        for (const action of SHELL_ACTIONS) {
          const [key, commandKey] = shellEntryPaths(root, action.key);
          await this.addValue(key, action.label);
          await this.addValue(commandKey, this.commandFor(action.flag));
          await this.runReg(['add', key, '/v', 'Icon', '/d', this.iconValue(), '/f']);
        }
      }
      this.installed = true;
      this.lastError = '';
      return { ok: true, installed: true };
    } catch {
      this.installed = false;
      this.lastError = '无法写入 Windows 右键菜单。';
      return { ok: false, installed: false, error: this.lastError };
    }
  }

  remove() {
    return this.enqueue(() => this.performRemove());
  }

  async performRemove() {
    if (!this.supported) {
      this.installed = false;
      return { ok: true, installed: false, skipped: true };
    }
    try {
      for (const root of SHELL_INTEGRATION_ROOTS) {
        for (const action of SHELL_ACTIONS) {
          const [key] = shellEntryPaths(root, action.key);
          await this.runReg(['delete', key, '/f']).catch((error) => {
            if (error?.code !== 1) throw error;
          });
        }
      }
      this.installed = false;
      this.lastError = '';
      return { ok: true, installed: false };
    } catch {
      this.installed = false;
      this.lastError = '无法移除 Windows 右键菜单。';
      return { ok: false, installed: false, error: this.lastError };
    }
  }

  async apply(enabled) {
    return enabled ? this.install() : this.remove();
  }

  getStatus() {
    return {
      supported: this.supported,
      installed: this.installed,
      error: this.lastError
    };
  }
}

module.exports = {
  SHELL_ACTIONS,
  SHELL_INTEGRATION_ROOTS,
  WindowsShellIntegration,
  buildActionCommand,
  quoteWindowsArgument,
  resolveLaunchExecutable,
  shellEntryPaths
};

'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');
const { DEFAULT_PROXY_URL, normalizeProxyUrl } = require('./network-service');

const DEFAULT_SETTINGS = Object.freeze({
  provider: 'bing',
  networkMode: 'auto',
  proxyUrl: DEFAULT_PROXY_URL,
  endpoint: 'http://127.0.0.1:11434/v1',
  model: 'qwen3:1.7b',
  visionModel: 'qwen3-vl:2b',
  screenshotHotkey: 'Alt+Shift+S',
  clipboardHotkey: 'Alt+Shift+T',
  autoTranslate: true,
  closeToTray: true,
  theme: 'system'
});

const PUBLIC_SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
const ALLOWED_PROVIDERS = new Set(['bing', 'google', 'openai']);
const ALLOWED_THEMES = new Set(['system', 'light', 'dark']);
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 200;
const MAX_HOTKEY_LENGTH = 100;
const MAX_API_KEY_LENGTH = 8_192;
let temporaryFileCounter = 0;

class SettingsError extends Error {
  constructor(message, { code = 'SETTINGS_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'SettingsError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneSettings(settings) {
  return Object.fromEntries(PUBLIC_SETTING_KEYS.map((key) => [key, settings[key]]));
}

function normalizeEnum(value, allowed, fallback, strict, label) {
  if (typeof value === 'string' && allowed.has(value.trim().toLowerCase())) {
    return value.trim().toLowerCase();
  }
  if (strict) throw new SettingsError(`${label}的值无效。`, { code: 'INVALID_SETTING' });
  return fallback;
}

function normalizeString(value, fallback, maxLength, strict, label) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized && normalized.length <= maxLength && !/[\r\n]/.test(normalized)) return normalized;
  }
  if (strict) {
    throw new SettingsError(`${label}必须是不超过 ${maxLength} 个字符的单行文本。`, {
      code: 'INVALID_SETTING'
    });
  }
  return fallback;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function normalizeEndpoint(value, fallback, strict) {
  const normalized = normalizeString(value, fallback, MAX_ENDPOINT_LENGTH, strict, '服务地址');
  let url;
  try {
    url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('invalid');
  } catch (error) {
    if (strict) {
      throw new SettingsError('服务地址必须是完整的 HTTP/HTTPS URL，且不能包含账号信息。', {
        code: 'INVALID_SETTING',
        cause: error
      });
    }
    return fallback;
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    if (strict) {
      throw new SettingsError('远程服务地址必须使用 HTTPS；HTTP 仅允许本机回环地址。', {
        code: 'INVALID_SETTING'
      });
    }
    return fallback;
  }
  url.hash = '';
  return url.toString().replace(/\/$/, normalized.endsWith('/') ? '/' : '');
}

function normalizeBoolean(value, fallback, strict, label) {
  if (typeof value === 'boolean') return value;
  if (strict) throw new SettingsError(`${label}必须是布尔值。`, { code: 'INVALID_SETTING' });
  return fallback;
}

function normalizeField(key, value, fallback, strict) {
  switch (key) {
    case 'provider':
      return normalizeEnum(value, ALLOWED_PROVIDERS, fallback, strict, '翻译服务');
    case 'networkMode':
      return normalizeEnum(value, new Set(['auto', 'system', 'direct', 'manual']), fallback, strict, '网络模式');
    case 'proxyUrl':
      try { return normalizeProxyUrl(value); } catch (error) {
        if (strict) throw new SettingsError(error.message, { code: 'INVALID_SETTING' });
        return fallback;
      }
    case 'endpoint':
      return normalizeEndpoint(value, fallback, strict);
    case 'model':
      return normalizeString(value, fallback, MAX_MODEL_LENGTH, strict, '文本模型');
    case 'visionModel':
      return normalizeString(value, fallback, MAX_MODEL_LENGTH, strict, '视觉模型');
    case 'screenshotHotkey':
      return normalizeString(value, fallback, MAX_HOTKEY_LENGTH, strict, '截图快捷键');
    case 'clipboardHotkey':
      return normalizeString(value, fallback, MAX_HOTKEY_LENGTH, strict, '剪贴板快捷键');
    case 'autoTranslate':
      return normalizeBoolean(value, fallback, strict, '自动翻译设置');
    case 'closeToTray':
      return normalizeBoolean(value, fallback, strict, '关闭到托盘设置');
    case 'theme':
      return normalizeEnum(value, ALLOWED_THEMES, fallback, strict, '主题');
    default:
      return undefined;
  }
}

function normalizeSettings(input, fallback = DEFAULT_SETTINGS) {
  const source = isPlainObject(input) ? input : {};
  const safeFallback = isPlainObject(fallback) ? fallback : DEFAULT_SETTINGS;
  const result = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    const fallbackValue = normalizeField(key, safeFallback[key], DEFAULT_SETTINGS[key], false);
    result[key] = Object.hasOwn(source, key)
      ? normalizeField(key, source[key], fallbackValue, false)
      : fallbackValue;
  }
  return result;
}

function normalizeSettingsPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new SettingsError('设置更新内容必须是对象。', { code: 'INVALID_SETTING' });
  }
  const result = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    if (Object.hasOwn(patch, key)) result[key] = normalizeField(key, patch[key], DEFAULT_SETTINGS[key], true);
  }
  return result;
}

function normalizeApiKey(apiKey) {
  if (typeof apiKey !== 'string') {
    throw new SettingsError('API Key 必须是文本。', { code: 'INVALID_API_KEY' });
  }
  const normalized = apiKey.trim();
  if (normalized.length > MAX_API_KEY_LENGTH || /[\r\n]/.test(normalized)) {
    throw new SettingsError(`API Key 必须是不超过 ${MAX_API_KEY_LENGTH} 个字符的单行文本。`, {
      code: 'INVALID_API_KEY'
    });
  }
  return normalized;
}

function isEncryptionAvailable(cryptoAdapter) {
  try {
    return Boolean(
      cryptoAdapter &&
      typeof cryptoAdapter.isEncryptionAvailable === 'function' &&
      cryptoAdapter.isEncryptionAvailable() &&
      typeof cryptoAdapter.encryptString === 'function' &&
      typeof cryptoAdapter.decryptString === 'function'
    );
  } catch {
    return false;
  }
}

function encryptApiKey(apiKey, cryptoAdapter) {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) return '';
  if (!isEncryptionAvailable(cryptoAdapter)) {
    throw new SettingsError('系统安全存储当前不可用。', { code: 'ENCRYPTION_UNAVAILABLE' });
  }
  try {
    const encrypted = cryptoAdapter.encryptString(normalized);
    if (!encrypted || (typeof encrypted !== 'string' && !ArrayBuffer.isView(encrypted))) {
      throw new Error('safeStorage returned invalid data');
    }
    return Buffer.from(encrypted).toString('base64');
  } catch (error) {
    throw new SettingsError('API Key 加密失败，未将密钥写入磁盘。', {
      code: 'ENCRYPTION_FAILED',
      cause: error
    });
  }
}

function decryptApiKey(encryptedBase64, cryptoAdapter) {
  if (typeof encryptedBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encryptedBase64)) {
    throw new SettingsError('加密的 API Key 数据已损坏。', { code: 'DECRYPTION_FAILED' });
  }
  if (!isEncryptionAvailable(cryptoAdapter)) {
    throw new SettingsError('系统安全存储当前不可用，无法读取 API Key。', {
      code: 'ENCRYPTION_UNAVAILABLE'
    });
  }
  try {
    return normalizeApiKey(cryptoAdapter.decryptString(Buffer.from(encryptedBase64, 'base64')));
  } catch (error) {
    if (error instanceof SettingsError && error.code === 'INVALID_API_KEY') throw error;
    throw new SettingsError('无法解密 API Key，可能是系统账户或安全存储已变更。', {
      code: 'DECRYPTION_FAILED',
      cause: error
    });
  }
}

function atomicWriteJson(filePath, value, { fsModule = nodeFs } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new SettingsError('设置文件路径无效。', { code: 'INVALID_PATH' });
  }
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${temporaryFileCounter += 1}.tmp`;
  const json = `${JSON.stringify(value, null, 2)}\n`;
  try {
    fsModule.mkdirSync(directory, { recursive: true });
    fsModule.writeFileSync(tempPath, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (typeof fsModule.chmodSync === 'function') {
      try { fsModule.chmodSync(tempPath, 0o600); } catch { /* Windows may not expose POSIX modes. */ }
    }
    fsModule.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fsModule.existsSync(tempPath)) fsModule.unlinkSync(tempPath);
    } catch {
      // Keep the original write error; stale temp files are harmless.
    }
    throw new SettingsError('设置保存失败，原设置文件未更改。', {
      code: 'WRITE_FAILED',
      cause: error
    });
  }
}

function resolveElectronSafeStorage() {
  try {
    // Requiring this module under plain Node returns no safeStorage; tests can inject an adapter.
    return require('electron')?.safeStorage ?? null;
  } catch {
    return null;
  }
}

class SettingsStore {
  constructor(filePathOrOptions, extraOptions = {}) {
    const options = typeof filePathOrOptions === 'string'
      ? { ...extraOptions, filePath: filePathOrOptions }
      : (filePathOrOptions ?? {});
    if (!isPlainObject(options) || typeof options.filePath !== 'string' || !options.filePath.trim()) {
      throw new SettingsError('创建设置存储时必须提供 filePath。', { code: 'INVALID_PATH' });
    }

    this.filePath = options.filePath;
    this.fs = options.fsModule ?? options.fs ?? nodeFs;
    this.cryptoAdapter = Object.hasOwn(options, 'cryptoAdapter')
      ? options.cryptoAdapter
      : (Object.hasOwn(options, 'safeStorage') ? options.safeStorage : resolveElectronSafeStorage());
    this.settings = cloneSettings(DEFAULT_SETTINGS);
    this.apiKey = '';
    this.storedEncryptedApiKey = '';
    this.secretError = null;
    this.apiKeyDirty = false;
    this.loadError = null;

    if (options.autoLoad !== false) this.load();
  }

  load() {
    this.settings = cloneSettings(DEFAULT_SETTINGS);
    this.apiKey = '';
    this.storedEncryptedApiKey = '';
    this.secretError = null;
    this.apiKeyDirty = false;
    this.loadError = null;

    let raw;
    try {
      raw = this.fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return this.getPublic();
      this.loadError = new SettingsError('设置文件无法读取，已使用默认设置。', {
        code: 'READ_FAILED',
        cause: error
      });
      return this.getPublic();
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) throw new Error('root is not an object');
    } catch (error) {
      this.loadError = new SettingsError('设置文件已损坏，已使用默认设置。', {
        code: 'INVALID_FILE',
        cause: error
      });
      return this.getPublic();
    }

    this.settings = normalizeSettings(parsed);
    if (typeof parsed.apiKeyEncrypted === 'string' && parsed.apiKeyEncrypted) {
      this.storedEncryptedApiKey = parsed.apiKeyEncrypted;
      try {
        this.apiKey = decryptApiKey(parsed.apiKeyEncrypted, this.cryptoAdapter);
      } catch (error) {
        this.secretError = error;
      }
    } else if (typeof parsed.apiKey === 'string') {
      let legacyApiKey = '';
      try {
        legacyApiKey = normalizeApiKey(parsed.apiKey);
      } catch (error) {
        this.secretError = error;
      }
      if (legacyApiKey) {
        if (isEncryptionAvailable(this.cryptoAdapter)) {
          this.apiKey = legacyApiKey;
          this.apiKeyDirty = true;
          this.save();
        } else {
          this.secretError = new SettingsError('检测到旧版明文 API Key，但系统安全存储不可用，已拒绝加载。', {
            code: 'ENCRYPTION_UNAVAILABLE'
          });
        }
      }
    }
    return this.getPublic();
  }

  get() {
    return { ...cloneSettings(this.settings), apiKey: this.apiKey };
  }

  getPublic() {
    return {
      ...cloneSettings(this.settings),
      hasApiKey: Boolean(this.apiKey || this.storedEncryptedApiKey)
    };
  }

  getApiKey() {
    if (
      this.secretError?.code === 'ENCRYPTION_UNAVAILABLE'
      && !this.apiKey
      && this.storedEncryptedApiKey
      && isEncryptionAvailable(this.cryptoAdapter)
    ) {
      try {
        this.apiKey = decryptApiKey(this.storedEncryptedApiKey, this.cryptoAdapter);
        this.secretError = null;
      } catch (error) {
        this.secretError = error;
      }
    }
    if (this.secretError && !this.apiKey) throw this.secretError;
    return this.apiKey;
  }

  update(patch) {
    if (!isPlainObject(patch)) {
      throw new SettingsError('设置更新内容必须是对象。', { code: 'INVALID_SETTING' });
    }
    const normalizedPatch = normalizeSettingsPatch(patch);
    const hasApiKey = Object.hasOwn(patch, 'apiKey');
    if (Object.keys(normalizedPatch).length === 0 && !hasApiKey) return this.getPublic();

    const nextSettings = { ...this.settings, ...normalizedPatch };
    const endpointOriginChanged = Object.hasOwn(normalizedPatch, 'endpoint')
      && new URL(nextSettings.endpoint).origin !== new URL(this.settings.endpoint).origin;
    let nextApiKey = this.apiKey;
    let nextStoredEncryptedApiKey = this.storedEncryptedApiKey;
    let nextSecretError = this.secretError;
    let nextApiKeyDirty = this.apiKeyDirty;

    if (hasApiKey) {
      nextApiKey = normalizeApiKey(patch.apiKey);
      nextStoredEncryptedApiKey = '';
      nextSecretError = null;
      nextApiKeyDirty = true;
    } else if (endpointOriginChanged) {
      nextApiKey = '';
      nextStoredEncryptedApiKey = '';
      nextSecretError = null;
      nextApiKeyDirty = true;
    }

    const persisted = this.persistState({
      settings: nextSettings,
      apiKey: nextApiKey,
      storedEncryptedApiKey: nextStoredEncryptedApiKey,
      secretError: nextSecretError,
      apiKeyDirty: nextApiKeyDirty
    });
    this.commitState(persisted);
    return this.getPublic();
  }

  setApiKey(apiKey) {
    return this.update({ apiKey });
  }

  persistState(state) {
    const serialized = cloneSettings(state.settings);
    let encryptedApiKey = '';
    if (state.apiKey) {
      encryptedApiKey = state.storedEncryptedApiKey && !state.apiKeyDirty
        ? state.storedEncryptedApiKey
        : encryptApiKey(state.apiKey, this.cryptoAdapter);
      serialized.apiKeyEncrypted = encryptedApiKey;
    } else if (state.storedEncryptedApiKey && !state.apiKeyDirty) {
      encryptedApiKey = state.storedEncryptedApiKey;
      serialized.apiKeyEncrypted = encryptedApiKey;
    }
    atomicWriteJson(this.filePath, serialized, { fsModule: this.fs });
    return {
      ...state,
      storedEncryptedApiKey: encryptedApiKey,
      secretError: encryptedApiKey ? state.secretError : null,
      apiKeyDirty: false
    };
  }

  commitState(state) {
    this.settings = state.settings;
    this.apiKey = state.apiKey;
    this.storedEncryptedApiKey = state.storedEncryptedApiKey;
    this.secretError = state.secretError;
    this.apiKeyDirty = state.apiKeyDirty;
  }

  save() {
    const persisted = this.persistState({
      settings: this.settings,
      apiKey: this.apiKey,
      storedEncryptedApiKey: this.storedEncryptedApiKey,
      secretError: this.secretError,
      apiKeyDirty: this.apiKeyDirty
    });
    this.commitState(persisted);
    return this.getPublic();
  }
}

module.exports = {
  ALLOWED_PROVIDERS,
  ALLOWED_THEMES,
  DEFAULT_SETTINGS,
  MAX_API_KEY_LENGTH,
  PUBLIC_SETTING_KEYS,
  SettingsError,
  SettingsStore,
  atomicWriteJson,
  decryptApiKey,
  encryptApiKey,
  isEncryptionAvailable,
  normalizeApiKey,
  normalizeSettings,
  normalizeSettingsPatch
};

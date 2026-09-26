'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SETTINGS,
  SettingsStore,
  atomicWriteJson,
  normalizeSettings,
  normalizeSettingsPatch
} = require('../src/main/settings-store');

function makeTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenlingo-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeCryptoAdapter() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => {
      const decoded = Buffer.from(value).toString('utf8');
      if (!decoded.startsWith('protected:')) throw new Error('invalid payload');
      return decoded.slice('protected:'.length);
    }
  };
}

test('设置 schema 只保留 allowlist 字段并规范化值', () => {
  const normalized = normalizeSettings({
    provider: ' OPENAI ',
    endpoint: 'https://example.test/v1',
    theme: 'DARK',
    autoTranslate: 'yes',
    unknown: 'must disappear'
  });
  assert.equal(normalized.provider, 'openai');
  assert.equal(normalized.theme, 'dark');
  assert.equal(normalized.autoTranslate, DEFAULT_SETTINGS.autoTranslate);
  assert.equal(Object.hasOwn(normalized, 'unknown'), false);
  assert.deepEqual(Object.keys(normalized), Object.keys(DEFAULT_SETTINGS));

  assert.deepEqual(normalizeSettingsPatch({ closeToTray: false, unknown: true }), { closeToTray: false });
  assert.throws(() => normalizeSettingsPatch({ provider: 'untrusted' }), { code: 'INVALID_SETTING' });
  assert.throws(() => normalizeSettingsPatch({ endpoint: 'http://example.test/v1' }), { code: 'INVALID_SETTING' });
});

test('safeStorage 可用时 API Key 加密落盘，getPublic 不泄露明文', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  const cryptoAdapter = makeCryptoAdapter();
  const store = new SettingsStore({ filePath, cryptoAdapter, fsModule: fs });

  const publicSettings = store.update({
    provider: 'openai',
    theme: 'dark',
    apiKey: 'sk-highly-secret',
    ignored: 'value'
  });
  const diskText = fs.readFileSync(filePath, 'utf8');
  const diskSettings = JSON.parse(diskText);

  assert.equal(publicSettings.hasApiKey, true);
  assert.equal(Object.hasOwn(publicSettings, 'apiKey'), false);
  assert.doesNotMatch(diskText, /sk-highly-secret/);
  assert.equal(typeof diskSettings.apiKeyEncrypted, 'string');
  assert.equal(Object.hasOwn(diskSettings, 'apiKey'), false);
  assert.equal(Object.hasOwn(diskSettings, 'ignored'), false);

  const reloaded = new SettingsStore({ filePath, cryptoAdapter, fsModule: fs });
  assert.equal(reloaded.getApiKey(), 'sk-highly-secret');
  assert.equal(reloaded.getPublic().hasApiKey, true);
  assert.equal(reloaded.getPublic().provider, 'openai');
});

test('安全存储不可用时拒绝保存 API Key，且不会改变内存状态', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  const unavailableCrypto = { isEncryptionAvailable: () => false };
  const store = new SettingsStore({ filePath, cryptoAdapter: unavailableCrypto, fsModule: fs });
  assert.throws(() => store.setApiKey('local-key'), { code: 'ENCRYPTION_UNAVAILABLE' });
  assert.equal(store.getApiKey(), '');
  assert.equal(store.getPublic().hasApiKey, false);

  store.update({ theme: 'dark' });
  const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(Object.hasOwn(disk, 'apiKey'), false);
  assert.equal(Object.hasOwn(disk, 'apiKeyEncrypted'), false);
  assert.equal(disk.endpoint, DEFAULT_SETTINGS.endpoint);
  assert.equal(disk.provider, DEFAULT_SETTINGS.provider);
});

test('加密能力临时不可用时保留已有密文，不会降级为明文', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  let available = true;
  const cryptoAdapter = makeCryptoAdapter();
  cryptoAdapter.isEncryptionAvailable = () => available;
  const store = new SettingsStore({ filePath, cryptoAdapter, fsModule: fs });
  store.setApiKey('protected-key');
  const encryptedBefore = JSON.parse(fs.readFileSync(filePath, 'utf8')).apiKeyEncrypted;

  available = false;
  store.update({ theme: 'dark' });
  const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(disk.apiKeyEncrypted, encryptedBefore);
  assert.equal(Object.hasOwn(disk, 'apiKey'), false);
  assert.equal(store.getApiKey(), 'protected-key');
});

test('加载密文时安全存储尚未就绪，可在就绪后重试解密', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  let available = true;
  const cryptoAdapter = makeCryptoAdapter();
  cryptoAdapter.isEncryptionAvailable = () => available;
  const writer = new SettingsStore({ filePath, cryptoAdapter, fsModule: fs });
  writer.setApiKey('retry-secret');

  available = false;
  const reader = new SettingsStore({ filePath, cryptoAdapter, fsModule: fs });
  assert.throws(() => reader.getApiKey(), { code: 'ENCRYPTION_UNAVAILABLE' });
  available = true;
  assert.equal(reader.getApiKey(), 'retry-secret');
});

test('load 只返回公开设置，不返回明文 API Key', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  const store = new SettingsStore({ filePath, cryptoAdapter: makeCryptoAdapter(), fsModule: fs });
  store.setApiKey('secret');

  const loaded = store.load();
  assert.equal(loaded.hasApiKey, true);
  assert.equal(Object.hasOwn(loaded, 'apiKey'), false);
  assert.equal(store.getApiKey(), 'secret');
});

test('切换 endpoint origin 时清除旧 API Key，同源路径变化保留', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  const store = new SettingsStore({ filePath, cryptoAdapter: makeCryptoAdapter(), fsModule: fs });
  store.update({ endpoint: 'https://one.example/v1', apiKey: 'origin-secret' });

  store.update({ endpoint: 'https://one.example/custom/v1' });
  assert.equal(store.getApiKey(), 'origin-secret');
  assert.equal(store.getPublic().hasApiKey, true);

  store.update({ endpoint: 'https://two.example/v1' });
  const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(store.getApiKey(), '');
  assert.equal(store.getPublic().hasApiKey, false);
  assert.equal(Object.hasOwn(disk, 'apiKey'), false);
  assert.equal(Object.hasOwn(disk, 'apiKeyEncrypted'), false);
});

test('损坏或包含无效值的 JSON 不会污染运行时设置', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  fs.writeFileSync(filePath, '{broken json', 'utf8');
  const corrupted = new SettingsStore({ filePath, cryptoAdapter: null, fsModule: fs });
  assert.deepEqual(corrupted.getPublic(), { ...DEFAULT_SETTINGS, hasApiKey: false });
  assert.equal(corrupted.loadError.code, 'INVALID_FILE');

  fs.writeFileSync(filePath, JSON.stringify({ provider: 'bad', theme: 123, closeToTray: false, extra: true }), 'utf8');
  const normalized = new SettingsStore({ filePath, cryptoAdapter: null, fsModule: fs });
  assert.equal(normalized.getPublic().provider, DEFAULT_SETTINGS.provider);
  assert.equal(normalized.getPublic().theme, DEFAULT_SETTINGS.theme);
  assert.equal(normalized.getPublic().closeToTray, false);
  assert.equal(Object.hasOwn(normalized.getPublic(), 'extra'), false);
});

test('旧的明文 API Key 在 safeStorage 可用时自动迁移为密文', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  fs.writeFileSync(filePath, JSON.stringify({ ...DEFAULT_SETTINGS, apiKey: 'legacy-key' }), 'utf8');

  const store = new SettingsStore({ filePath, cryptoAdapter: makeCryptoAdapter(), fsModule: fs });
  const diskText = fs.readFileSync(filePath, 'utf8');
  assert.equal(store.getApiKey(), 'legacy-key');
  assert.doesNotMatch(diskText, /legacy-key/);
  assert.equal(typeof JSON.parse(diskText).apiKeyEncrypted, 'string');
});

test('旧的明文 API Key 在安全存储不可用时不会加载或再次写入', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  fs.writeFileSync(filePath, JSON.stringify({ ...DEFAULT_SETTINGS, apiKey: 'legacy-key' }), 'utf8');
  const store = new SettingsStore({
    filePath,
    cryptoAdapter: { isEncryptionAvailable: () => false },
    fsModule: fs
  });

  assert.equal(store.getPublic().hasApiKey, false);
  assert.throws(() => store.getApiKey(), { code: 'ENCRYPTION_UNAVAILABLE' });
  store.update({ theme: 'dark' });
  const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(Object.hasOwn(disk, 'apiKey'), false);
  assert.equal(Object.hasOwn(disk, 'apiKeyEncrypted'), false);
  assert.equal(store.getApiKey(), '');
});

test('删除 API Key 后密文也从磁盘移除', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  const store = new SettingsStore({ filePath, cryptoAdapter: makeCryptoAdapter(), fsModule: fs });
  store.setApiKey('secret');
  store.setApiKey('');
  const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(Object.hasOwn(disk, 'apiKeyEncrypted'), false);
  assert.equal(Object.hasOwn(disk, 'apiKey'), false);
  assert.equal(store.getPublic().hasApiKey, false);
});

test('原子写在 rename 失败时保留旧文件并清理临时文件', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  fs.writeFileSync(filePath, '{"old":true}\n', 'utf8');
  const failingFs = Object.create(fs);
  failingFs.renameSync = () => {
    const error = new Error('simulated rename failure');
    error.code = 'EACCES';
    throw error;
  };

  assert.throws(
    () => atomicWriteJson(filePath, { old: false }, { fsModule: failingFs }),
    { code: 'WRITE_FAILED' }
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{"old":true}\n');
  assert.deepEqual(fs.readdirSync(directory), ['settings.json']);
});

test('SettingsStore 保存失败时同时回滚公开设置和 API Key 内存状态', (t) => {
  const directory = makeTempDir(t);
  const filePath = path.join(directory, 'settings.json');
  let failRename = false;
  const failingFs = Object.create(fs);
  failingFs.renameSync = (source, destination) => {
    if (failRename) {
      const error = new Error('simulated rename failure');
      error.code = 'EACCES';
      throw error;
    }
    return fs.renameSync(source, destination);
  };
  const store = new SettingsStore({ filePath, cryptoAdapter: makeCryptoAdapter(), fsModule: failingFs });
  store.update({ theme: 'dark', apiKey: 'old-secret' });
  const publicBefore = store.getPublic();
  const diskBefore = fs.readFileSync(filePath, 'utf8');

  failRename = true;
  assert.throws(
    () => store.update({ theme: 'light', apiKey: 'new-secret' }),
    { code: 'WRITE_FAILED' }
  );
  assert.deepEqual(store.getPublic(), publicBefore);
  assert.equal(store.getApiKey(), 'old-secret');
  assert.equal(fs.readFileSync(filePath, 'utf8'), diskBefore);
  assert.deepEqual(fs.readdirSync(directory), ['settings.json']);
});

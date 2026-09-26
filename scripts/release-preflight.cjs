'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const errors = [];
const requiredFiles = [
  'AGENTS.md',
  '.gitignore',
  '.gitattributes',
  'LICENSE',
  'README.md',
  'README.en.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'docs/assets/screenlingo-home.png',
  'docs/assets/screenlingo-workbench.png',
];
const forbiddenNames = new Set(['%systemdrive%', '%programdata%']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'release', 'artifacts', 'coverage']);
const sensitiveContainerExtensions = new Set(['.pfx', '.p12', '.jks', '.key', '.pem']);
const maxInspectableTextBytes = 4 * 1024 * 1024;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const gitSafeDirectory = root.replace(/\\/g, '/');
let gitFailureReported = false;

// Require token-shaped values so short examples in tests and documentation do not block a build.
const secretPatterns = [
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['AWS access key ID', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`缺少发布文件：${relativePath}`);
}

for (const name of forbiddenNames) {
  if (fs.existsSync(path.join(root, name))) errors.push(`发现不应进入仓库的本机目录：${name}`);
}

try {
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const expected of ['node_modules/', 'dist/', 'artifacts/', '%SystemDrive%/', '.env', '*.pfx']) {
    if (!gitignore.split(/\r?\n/).includes(expected)) errors.push(`.gitignore 缺少规则：${expected}`);
  }
} catch (error) {
  errors.push(`无法读取 .gitignore：${formatError(error)}`);
}

let packageJson;
let packageLock;
try {
  packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
} catch (error) {
  errors.push(`无法读取 package.json：${formatError(error)}`);
  packageJson = {};
}
try {
  packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
} catch (error) {
  errors.push(`无法读取 package-lock.json：${formatError(error)}`);
  packageLock = {};
}

if (packageJson.private !== true) errors.push('package.json 应保持 private=true，避免误发布到 npm。');
if (packageJson.license !== 'MIT') errors.push('package.json 的许可证应与 MIT LICENSE 一致。');
if (packageLock.name !== packageJson.name || packageLock.version !== packageJson.version) {
  errors.push('package-lock.json 的名称或版本与 package.json 不一致。');
}

for (const [packagePath, metadata] of Object.entries(packageLock.packages || {})) {
  if (!metadata || !metadata.resolved) continue;
  if (!isCanonicalNpmTarball(packagePath, metadata)) {
    errors.push(`package-lock.json 包含非 canonical npm HTTPS tarball 地址：${packagePath || '<root>'}`);
  }
}

for (const relativePath of readTrackedFiles()) {
  if (isIgnoredTrackedPath(relativePath)) {
    errors.push(`文件 ${relativePath} 同时被 Git 跟踪和 .gitignore 忽略，不能发布。`);
  }
}

scan(root);

if (errors.length) {
  console.error(`发布预检失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`发布预检通过：${requiredFiles.length} 个必需文件、仓库边界、普通文件和常见密钥模式均已检查。`);
}

function scan(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    const relativePath = path.relative(root, directory) || '.';
    errors.push(`${relativePath} 无法读取目录：${formatError(error)}`);
    return;
  }

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (entry.isDirectory() && ignoredDirectories.has(lowerName)) continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);
    if (entry.isDirectory()) {
      if (forbiddenNames.has(lowerName)) errors.push(`发现不应进入仓库的目录：${relativePath}`);
      else scan(absolutePath);
      continue;
    }

    // Release packaging does not follow non-regular entries. Every regular file, regardless
    // of extension, is inspected so secrets cannot hide in an unfamiliar filename.
    if (!entry.isFile()) continue;
    inspectFile(absolutePath, relativePath);
  }
}

function inspectFile(filePath, relativePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    errors.push(`${relativePath} 无法读取文件状态：${formatError(error)}`);
    return;
  }

  if (!stat.isFile()) return;

  const extension = path.extname(relativePath).toLowerCase();
  if (sensitiveContainerExtensions.has(extension)) {
    errors.push(`${relativePath} 是证书/私钥/密钥容器，不能进入公开仓库。`);
    return;
  }

  if (stat.size > maxInspectableTextBytes) {
    errors.push(`${relativePath} 超过 ${maxInspectableTextBytes} 字节的文本检查上限，已拒绝发布。`);
    return;
  }

  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    errors.push(`${relativePath} 无法读取文件内容：${formatError(error)}`);
    return;
  }

  // UTF-16 text contains NUL bytes by design, so decode a BOM before binary detection.
  const utf16Encoding = detectUtf16Encoding(bytes);
  if (utf16Encoding) {
    try {
      reportSecrets(relativePath, new TextDecoder(utf16Encoding, { fatal: true }).decode(bytes));
    } catch (error) {
      errors.push(`${relativePath} 无法解码为 UTF-16 文本，已拒绝发布：${formatError(error)}`);
    }
    return;
  }

  // Binary assets are intentionally skipped. For non-binary bytes, the ASCII projection
  // catches a token embedded next to an invalid UTF-8 sequence.
  if (looksBinary(bytes)) return;
  reportSecrets(relativePath, asciiProjection(bytes));

  try {
    utf8Decoder.decode(bytes);
  } catch (error) {
    errors.push(`${relativePath} 无法解码为 UTF-8 文本，已拒绝发布：${formatError(error)}`);
  }
}

function reportSecrets(relativePath, contents) {
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(contents)) errors.push(`${relativePath} 疑似包含 ${label}。`);
  }
}

function detectUtf16Encoding(bytes) {
  if (bytes.length < 2) return null;
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff
      ? 'utf-16be'
      : null;
}

function looksBinary(bytes) {
  if (bytes.includes(0)) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.length === 0) return false;
  let controls = 0;
  for (const byte of sample) {
    const allowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d;
    if (!allowedControl && (byte < 0x20 || byte === 0x7f)) controls += 1;
  }
  return controls / sample.length > 0.1;
}

function asciiProjection(bytes) {
  let result = '';
  for (const byte of bytes) {
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d) {
      result += String.fromCharCode(byte);
    } else {
      result += ' ';
    }
  }
  return result;
}

function isCanonicalNpmTarball(packagePath, metadata) {
  const resolved = metadata?.resolved;
  // The literal prefix rejects credentials, an explicit port (including :443), and mixed hosts.
  if (typeof resolved !== 'string' || !/^https:\/\/registry\.npmjs\.org\//.test(resolved)) return false;

  let parsed;
  try {
    parsed = new URL(resolved);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'registry.npmjs.org'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) return false;

  const packageName = typeof metadata.name === 'string' && metadata.name
    ? metadata.name
    : packageNameFromLockPath(packagePath);
  const version = typeof metadata.version === 'string' ? metadata.version : '';
  if (!packageName || !version) return false;

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  const tarballName = `${packageName.split('/').at(-1)}-${version}.tgz`;
  return pathname.endsWith(`/-/${tarballName}`)
    && pathname.startsWith('/')
    && !pathname.includes('//')
    && !/[?#]/.test(pathname);
}

function packageNameFromLockPath(packagePath) {
  const marker = 'node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  return markerIndex === -1 ? '' : packagePath.slice(markerIndex + marker.length);
}

function readTrackedFiles() {
  if (!fs.existsSync(path.join(root, '.git'))) return [];
  const result = spawnSync('git', ['-c', `safe.directory=${gitSafeDirectory}`, 'ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    reportGitFailure('无法读取 Git 跟踪文件', result);
    return [];
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function isIgnoredTrackedPath(relativePath) {
  const result = spawnSync('git', [
    '-c', `safe.directory=${gitSafeDirectory}`,
    'check-ignore', '--no-index', '-q', '--', relativePath,
  ], {
    cwd: root,
    windowsHide: true,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    reportGitFailure(`无法检查 Git ignore 状态：${relativePath}`, result);
    return false;
  }
  return result.status === 0;
}

function reportGitFailure(context, result) {
  if (gitFailureReported) return;
  gitFailureReported = true;
  const detail = result.error?.message || String(result.stderr || '').trim() || `exit ${result.status}`;
  errors.push(`${context}，已拒绝发布：${detail}`);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const releasePreflightPath = path.join(projectRoot, 'scripts', 'release-preflight.cjs');
const noticesGeneratorPath = path.join(projectRoot, 'scripts', 'generate-third-party-notices.cjs');
const tesseractLicensePath = path.join(projectRoot, 'node_modules', 'tesseract.js', 'LICENSE.md');
const temporaryRoots = new Set();

test.after(() => {
  for (const root of temporaryRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // The test result should not hide the assertion that created the fixture.
    }
  }
});

test('release preflight detects secrets in commonly overlooked text files', async (t) => {
  const cases = [
    ['.env', 'OPENAI_API_KEY'],
    ['.env.local', 'OPENAI_API_KEY'],
    ['service.config', 'api_key'],
    ['credentials', 'token'],
    ['bootstrap.ps1', '$ApiKey'],
  ];

  for (const [relativePath, variableName] of cases) {
    await t.test(relativePath, () => {
      const root = createPreflightFixture();
      const secret = ['sk', 'fixture_value_0123456789'].join('-');
      fs.writeFileSync(path.join(root, relativePath), `${variableName}=${secret}\n`, 'utf8');

      const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, new RegExp(escapeRegExp(relativePath)));
      assert.match(result.stderr, /OpenAI-style API key/);
    });
  }
});

test('release preflight scans arbitrary non-binary files for high-confidence secrets', async (t) => {
  const cases = [
    ['settings.unlisted', 'OpenAI-style API key', ['sk', 'fixture_value_0123456789'].join('-')],
    ['github.credential', 'GitHub fine-grained token', ['github', 'pat', 'A'.repeat(82)].join('_')],
    ['npm.credential', 'npm token', ['npm', 'B'.repeat(36)].join('_')],
    ['aws.credential', 'AWS access key ID', ['AK', 'IA', 'C'.repeat(16)].join('')],
    ['slack.credential', 'Slack token', `${['xox', 'b'].join('')}-${'1'.repeat(12)}-${'D'.repeat(24)}`],
    ['encrypted.container', 'private key', `-----BEGIN ${['ENCRYPTED', 'PRIVATE', 'KEY'].join(' ')}-----`],
  ];

  for (const [relativePath, label, secret] of cases) {
    await t.test(label, () => {
      const root = createPreflightFixture();
      writeFixtureFile(root, relativePath, `credential=${secret}\n`);

      const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, new RegExp(escapeRegExp(relativePath)));
      assert.match(result.stderr, new RegExp(escapeRegExp(label)));
    });
  }
});

test('release preflight finds ASCII secrets in undecodable raw bytes', () => {
  const root = createPreflightFixture();
  const secret = ['sk', 'raw_fixture_value_0123456789'].join('-');
  fs.writeFileSync(
    path.join(root, 'opaque.payload'),
    Buffer.concat([Buffer.from([0xc3]), Buffer.from(secret, 'ascii')]),
  );

  const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /opaque\.payload.*OpenAI-style API key/);
});

test('release preflight fails closed for uninspectable text candidates', async (t) => {
  await t.test('oversized file', () => {
    const root = createPreflightFixture();
    fs.writeFileSync(path.join(root, 'oversized.txt'), Buffer.alloc((4 * 1024 * 1024) + 1, 0x61));

    const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.match(result.stderr, /oversized\.txt.*(?:过大|上限)/);
  });

  await t.test('invalid UTF-8', () => {
    const root = createPreflightFixture();
    fs.writeFileSync(path.join(root, 'invalid.custom'), Buffer.from([0xc3, 0x28]));

    const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.match(result.stderr, /invalid\.custom.*(?:解码|文本)/);
  });

  for (const failure of ['stat', 'read']) {
    await t.test(`${failure} error`, () => {
      const root = createPreflightFixture();
      const targetPath = path.join(root, `${failure}-failure.txt`);
      writeFixtureFile(root, `${failure}-failure.txt`, 'ordinary text\n');
      const injectorPath = createFsFailureInjector(root);

      const result = runScript(
        path.join(root, 'scripts', 'release-preflight.cjs'),
        root,
        [],
        {
          nodeArgs: ['--require', injectorPath],
          env: {
            SCREENLINGO_TEST_FAILURE: failure,
            SCREENLINGO_TEST_TARGET: targetPath,
          },
        },
      );

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, new RegExp(`${failure}-failure\\.txt.*(?:读取|状态)`));
    });
  }
});

test('release preflight rejects tracked ignored files and sensitive key containers', async (t) => {
  await t.test('tracked ignored file', () => {
    const root = createPreflightFixture();
    writeFixtureFile(root, '.env', 'SAFE_PLACEHOLDER=true\n');
    runGit(root, ['init']);
    runGit(root, ['add', '-f', '.env']);

    const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.match(result.stderr, /\.env.*(?:Git|git).*ignore/i);
  });

  for (const relativePath of ['signing.pfx', 'signing.p12', 'signing.jks', 'private.key', 'private.pem']) {
    await t.test(relativePath, () => {
      const root = createPreflightFixture();
      fs.writeFileSync(path.join(root, relativePath), Buffer.from([0x00, 0xff, 0x10, 0x20]));

      const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, new RegExp(`${escapeRegExp(relativePath)}.*(?:证书|私钥|密钥)`));
    });
  }
});

test('release preflight fails closed when Git metadata cannot be inspected', () => {
  const root = createPreflightFixture();
  fs.mkdirSync(path.join(root, '.git'));

  const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /Git.*(?:跟踪|读取|检查).*拒绝发布/i);
});

test('release preflight accepts only canonical npm registry tarball URLs', async (t) => {
  for (const resolved of [
    'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
    'https://registry.npmjs.org/@scope/example/-/example-1.0.0.tgz',
  ]) {
    await t.test(`accepts ${resolved}`, () => {
      const root = createPreflightFixture();
      addResolvedPackage(root, resolved);

      const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

      assert.equal(result.status, 0, result.stdout || result.stderr);
    });
  }

  const rejected = [
    'https://user@registry.npmjs.org/example/-/example-1.0.0.tgz',
    'https://user:password@registry.npmjs.org/example/-/example-1.0.0.tgz',
    'https://registry.npmjs.org:443/example/-/example-1.0.0.tgz',
    'https://registry.npmjs.org/example/-/example-1.0.0.tgz?download=1',
    'https://registry.npmjs.org/example/-/example-1.0.0.tgz#sha256',
    'https://registry.npmjs.org/example/latest',
  ];
  for (const resolved of rejected) {
    await t.test(`rejects ${resolved}`, () => {
      const root = createPreflightFixture();
      addResolvedPackage(root, resolved);

      const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /package-lock\.json.*npm.*HTTPS.*tarball/i);
    });
  }
});

test('release preflight skips binary data and ignored build directories', () => {
  const root = createPreflightFixture();
  const secret = ['sk', 'fixture_value_0123456789'].join('-');
  fs.writeFileSync(path.join(root, 'binary.png'), Buffer.concat([
    Buffer.from([0x00, 0xff, 0x00, 0xfe]),
    Buffer.from(secret, 'utf8'),
  ]));
  writeFixtureFile(root, path.join('node_modules', 'ignored.env'), secret);
  writeFixtureFile(root, path.join('dist', 'ignored.ps1'), secret);
  writeFixtureFile(root, path.join('DIST', 'ignored-uppercase.config'), secret);
  writeFixtureFile(root, path.join('artifacts', 'ignored.config'), secret);

  const result = runScript(path.join(root, 'scripts', 'release-preflight.cjs'), root);

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /发布预检通过/);
});

test('third-party notices rejects truncated Apache license text', () => {
  const root = createNoticesFixture();
  writeFixtureFile(
    root,
    path.join('node_modules', 'tesseract.js', 'LICENSE.md'),
    'Apache License\nVersion 2.0, January 2004\n',
  );

  const result = runScript(path.join(root, 'scripts', 'generate-third-party-notices.cjs'), root);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /tesseract\.js.*LICENSE.*SHA-256/i);
});

test('third-party notices rejects production licenses outside the reviewed allowlist', () => {
  const root = createNoticesFixture();
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/unreviewed-license'] = {
    version: '1.0.0',
    license: 'GPL-3.0-only',
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock), 'utf8');

  const result = runScript(path.join(root, 'scripts', 'generate-third-party-notices.cjs'), root);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /unreviewed-license.*GPL-3\.0-only.*(?:review|allow)/i);
});

test('third-party notices requires the OCR wrapper exclusion rule', () => {
  const root = createNoticesFixture();
  const packagePath = path.join(root, 'package.json');
  const appPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  appPackage.build.files = [];
  fs.writeFileSync(packagePath, JSON.stringify(appPackage), 'utf8');

  const result = runScript(path.join(root, 'scripts', 'generate-third-party-notices.cjs'), root);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /@tesseract\.js-data\/eng.*(?:exclude|excluded)/i);
});

test('third-party notices --check rejects a missing output without creating it', () => {
  const root = createNoticesFixture();
  const outputPath = path.join(root, 'THIRD_PARTY_NOTICES.md');

  const result = runScript(path.join(root, 'scripts', 'generate-third-party-notices.cjs'), root, ['--check']);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /THIRD_PARTY_NOTICES\.md is stale/);
  assert.equal(fs.existsSync(outputPath), false);
});

test('third-party notices --check rejects stale content without overwriting it', () => {
  const root = createNoticesFixture();
  const scriptPath = path.join(root, 'scripts', 'generate-third-party-notices.cjs');
  const outputPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
  const generated = runScript(scriptPath, root);
  assert.equal(generated.status, 0, generated.stdout || generated.stderr);
  const staleContent = `${fs.readFileSync(outputPath, 'utf8')}\nlocal stale marker\n`;
  fs.writeFileSync(outputPath, staleContent, 'utf8');

  const result = runScript(scriptPath, root, ['--check']);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /THIRD_PARTY_NOTICES\.md is stale/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), staleContent);
});

test('third-party notices --check accepts current content without rewriting it', () => {
  const root = createNoticesFixture();
  const scriptPath = path.join(root, 'scripts', 'generate-third-party-notices.cjs');
  const outputPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
  const generated = runScript(scriptPath, root);
  assert.equal(generated.status, 0, generated.stdout || generated.stderr);
  const currentContent = fs.readFileSync(outputPath);
  assert.match(
    currentContent.toString('utf8'),
    /wrapper JavaScript and package metadata are excluded from the packaged application/i,
  );

  const result = runScript(scriptPath, root, ['--check']);

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /THIRD_PARTY_NOTICES\.md is current/);
  assert.deepEqual(fs.readFileSync(outputPath), currentContent);
});

test('release:check includes the read-only notices check', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.match(
    packageJson.scripts['release:check'],
    /generate-third-party-notices\.cjs --check/,
  );
});

function createPreflightFixture() {
  const root = createTemporaryRoot('screenlingo-preflight-');
  copyScript(releasePreflightPath, root);

  for (const relativePath of [
    'AGENTS.md',
    '.gitattributes',
    'LICENSE',
    'README.md',
    'README.en.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'CHANGELOG.md',
    'THIRD_PARTY_NOTICES.md',
    path.join('.github', 'workflows', 'ci.yml'),
    path.join('.github', 'workflows', 'release.yml'),
    path.join('docs', 'assets', 'screenlingo-home.png'),
    path.join('docs', 'assets', 'screenlingo-workbench.png'),
  ]) {
    writeFixtureFile(root, relativePath, 'fixture\n');
  }

  writeFixtureFile(root, '.gitignore', [
    'node_modules/',
    'dist/',
    'artifacts/',
    '%SystemDrive%/',
    '.env',
    '*.pfx',
    '',
  ].join('\n'));
  writeFixtureFile(root, 'package.json', JSON.stringify({
    name: 'screenlingo-fixture',
    version: '1.0.0',
    private: true,
    license: 'MIT',
  }));
  writeFixtureFile(root, 'package-lock.json', JSON.stringify({
    name: 'screenlingo-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {},
  }));

  return root;
}

function createNoticesFixture() {
  const root = createTemporaryRoot('screenlingo-notices-');
  copyScript(noticesGeneratorPath, root);

  const appPackage = {
    name: 'screenlingo-fixture',
    version: '1.0.0',
    devDependencies: { electron: '44.2.0' },
    build: {
      files: [
        '!node_modules/@tesseract.js-data/eng/**/*',
      ],
      extraResources: [
        {
          from: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
          to: 'tessdata/eng.traineddata.gz',
        },
        {
          from: 'node_modules/tesseract.js/LICENSE.md',
          to: 'tessdata/LICENSE-APACHE-2.0.txt',
        },
      ],
    },
  };
  const packages = {
    '': { name: appPackage.name, version: appPackage.version },
    'node_modules/@tesseract.js-data/eng': { version: '1.0.0', license: 'MIT' },
    'node_modules/tesseract.js': { version: '7.0.0', license: 'Apache-2.0' },
    'node_modules/tr46': { version: '0.0.3', license: 'MIT' },
    'node_modules/electron': { version: '44.2.0', license: 'MIT', dev: true },
  };

  writeFixtureFile(root, 'package.json', JSON.stringify(appPackage));
  writeFixtureFile(root, 'package-lock.json', JSON.stringify({
    name: appPackage.name,
    version: appPackage.version,
    lockfileVersion: 3,
    packages,
  }));
  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!packagePath) continue;
    writeFixtureFile(root, path.join(packagePath, 'package.json'), JSON.stringify({
      name: packagePath.split('node_modules/').at(-1),
      version: metadata.version,
      license: metadata.license,
      ...(packagePath === 'node_modules/@tesseract.js-data/eng'
        ? {
            author: 'Balearica <admin@scribeocr.com>',
            contributors: [{ name: 'Balearica' }, { name: 'jeromewu' }],
          }
        : {}),
    }));
  }
  writeFixtureFile(
    root,
    path.join('node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
    'fixture model',
  );
  fs.copyFileSync(
    tesseractLicensePath,
    path.join(root, 'node_modules', 'tesseract.js', 'LICENSE.md'),
  );

  return root;
}

function createTemporaryRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

function copyScript(sourcePath, root) {
  const destination = path.join(root, 'scripts', path.basename(sourcePath));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(sourcePath, destination);
}

function addResolvedPackage(root, resolved) {
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/example'] = {
    version: '1.0.0',
    resolved,
    integrity: 'sha512-fixture',
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock), 'utf8');
}

function createFsFailureInjector(root) {
  const injectorPath = path.join(root, 'scripts', 'fs-failure-injector.cjs');
  writeFixtureFile(root, path.join('scripts', 'fs-failure-injector.cjs'), `'use strict';
const fs = require('node:fs');
const target = process.env.SCREENLINGO_TEST_TARGET;
const failure = process.env.SCREENLINGO_TEST_FAILURE;
for (const method of ['statSync', 'readFileSync']) {
  const original = fs[method];
  fs[method] = function patched(filePath, ...args) {
    const shouldFail = (failure === 'stat' && method === 'statSync')
      || (failure === 'read' && method === 'readFileSync');
    if (shouldFail && String(filePath) === target) throw new Error('injected file-system failure');
    return original.call(this, filePath, ...args);
  };
}
`);
  return injectorPath;
}

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function writeFixtureFile(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function runScript(scriptPath, cwd, args = [], options = {}) {
  return spawnSync(process.execPath, [...(options.nodeArgs || []), scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    windowsHide: true,
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

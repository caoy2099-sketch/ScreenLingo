'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const lockPath = path.join(projectRoot, 'package-lock.json');
const packagePath = path.join(projectRoot, 'package.json');
const outputPath = path.join(projectRoot, 'THIRD_PARTY_NOTICES.md');

const reviewedPackages = [
  { name: '@tesseract.js-data/eng', version: '1.0.0', license: 'MIT' },
  { name: 'tesseract.js', version: '7.0.0', license: 'Apache-2.0' },
  { name: 'tr46', version: '0.0.3', license: 'MIT' },
];

// This is an explicit legal review boundary for production dependencies. A new license
// must be reviewed and added deliberately instead of silently appearing in a release.
const productionLicenseAllowlist = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
]);
const ocrWrapperExclusion = '!node_modules/@tesseract.js-data/eng/**/*';
const expectedApacheLicenseSha256 = 'B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1';

const requiredResources = [
  {
    from: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    to: 'tessdata/eng.traineddata.gz',
  },
  {
    from: 'node_modules/tesseract.js/LICENSE.md',
    to: 'tessdata/LICENSE-APACHE-2.0.txt',
  },
];

const tr46LicenseText = `MIT License

Copyright (c) Sebastian Mayr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const appPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (!lock.packages || lock.lockfileVersion < 2) {
  throw new Error('package-lock.json must use lockfileVersion 2 or newer.');
}

const reviewedMetadata = new Map(
  reviewedPackages.map((expected) => [expected.name, validateReviewedPackage(expected)]),
);
validatePackagedResources();

const packages = Object.entries(lock.packages)
  .filter(([packagePathInLock, metadata]) =>
    packagePathInLock.startsWith('node_modules/') && metadata.dev !== true,
  )
  .map(([packagePathInLock, metadata]) => {
    const name = packagePathInLock.split('node_modules/').at(-1);

    if (!metadata.version || !metadata.license) {
      throw new Error(`Missing version or license metadata for ${name}.`);
    }

    const license = normalizeLicense(metadata.license);
    if (!productionLicenseAllowlist.has(license)) {
      throw new Error(
        `Production package ${name}@${metadata.version} declares ${license}, outside the reviewed license allowlist.`,
      );
    }

    return {
      name,
      version: metadata.version,
      license,
    };
  })
  .sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    if (left.version < right.version) return -1;
    if (left.version > right.version) return 1;
    return 0;
  });

const electron = lock.packages['node_modules/electron'];
if (!appPackage.devDependencies?.electron || !electron?.version || !electron?.license) {
  throw new Error('Electron and its license metadata must be recorded in package-lock.json.');
}
const electronLicense = normalizeLicense(electron.license);
if (!productionLicenseAllowlist.has(electronLicense)) {
  throw new Error(
    `Bundled Electron ${electron.version} declares ${electronLicense}, outside the reviewed license allowlist.`,
  );
}

const rows = packages.map(({ name, version, license }) => {
  const packageUrl = `https://www.npmjs.com/package/${name}`;
  return `| [${escapeMarkdown(name)}](${packageUrl}) | ${escapeMarkdown(version)} | ${escapeMarkdown(license)} |`;
});

const content = `# Third-party notices

This file is generated from \`package-lock.json\` by \`npm run notices\`. Do not edit the dependency table by hand.

ScreenLingo is distributed under the MIT License. The packages below remain subject to their own licenses. This inventory contains every production package recorded by the current npm lockfile, including transitive dependencies.

## Production dependencies (${packages.length})

| Package | Locked version | Declared package license |
| --- | --- | --- |
${rows.join('\n')}

## Bundled application runtime

| Component | Locked version | License | Source |
| --- | --- | --- | --- |
| Electron | ${escapeMarkdown(electron.version)} | ${escapeMarkdown(electronLicense)} | [electron/electron](https://github.com/electron/electron) |

Electron includes Chromium, Node.js, and other third-party software. Their notices are shipped with the Electron distribution in \`LICENSES.chromium.html\`. License files supplied by npm packages remain in their installed package directories when included in a build.

## Bundled English OCR data

The English OCR asset has two distinct license layers:

1. The npm wrapper [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) at version ${reviewedMetadata.get('@tesseract.js-data/eng').version} declares MIT in its package metadata.
2. The actual \`4.0.0_best_int/eng.traineddata.gz\` model comes from [naptha/tessdata](https://github.com/naptha/tessdata). The upstream [\`gh-pages/LICENSE\`](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE) applies Apache License 2.0 to that model data.

The wrapper JavaScript and package metadata are excluded from the packaged application. Only the Apache-2.0 model payload is copied as an OCR asset via \`extraResources\`; the complete Apache License 2.0 text is copied beside it as \`resources/tessdata/LICENSE-APACHE-2.0.txt\` for compliance. That text comes from \`tesseract.js@${reviewedMetadata.get('tesseract.js').version}/LICENSE.md\`, which contains the standard Apache License 2.0 text.

## Preserved license text for tr46 ${reviewedMetadata.get('tr46').version}

The \`tr46@${reviewedMetadata.get('tr46').version}\` npm metadata declares MIT, but that published package does not contain a separate license file. The required copyright and permission notice is preserved here in full:

\`\`\`text
${tr46LicenseText}
\`\`\`

## Researched projects are not dependencies

The applications listed in [the open-source research notes](docs/OPEN_SOURCE_RESEARCH.md) were studied for product and architecture decisions. Their source code is not vendored into ScreenLingo, and they are not runtime dependencies of this project.
`;

// Keep the generated artifact aligned with .gitattributes (text/eol=lf) so
// checkout normalization cannot make the read-only freshness check fail.
const generatedContent = content;

if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== generatedContent) {
    throw new Error(`${path.basename(outputPath)} is stale. Run npm run notices and commit the result.`);
  }
  console.log(`${path.basename(outputPath)} is current (${packages.length} production dependencies).`);
} else {
  fs.writeFileSync(outputPath, generatedContent, 'utf8');
  console.log(`Wrote ${path.basename(outputPath)} with ${packages.length} production dependencies.`);
}

function normalizeLicense(license) {
  if (typeof license === 'string') return license;
  if (license && typeof license.type === 'string') return license.type;
  throw new Error(`Unsupported license metadata: ${JSON.stringify(license)}`);
}

function validateReviewedPackage(expected) {
  const packagePathInLock = `node_modules/${expected.name}`;
  const metadata = lock.packages[packagePathInLock];

  if (!metadata) {
    throw new Error(`Required reviewed package is missing from package-lock.json: ${expected.name}.`);
  }
  if (metadata.dev === true) {
    throw new Error(`Required reviewed package is no longer a production dependency: ${expected.name}.`);
  }
  if (metadata.version !== expected.version) {
    throw new Error(
      `License review required for ${expected.name}: expected ${expected.version}, found ${metadata.version || 'no version'}.`,
    );
  }

  const actualLicense = normalizeLicense(metadata.license);
  if (actualLicense !== expected.license) {
    throw new Error(
      `License review required for ${expected.name}@${expected.version}: expected ${expected.license}, found ${actualLicense}.`,
    );
  }

  const installedManifestPath = path.join(projectRoot, packagePathInLock, 'package.json');
  if (!fs.existsSync(installedManifestPath)) {
    throw new Error(`Installed package is missing for ${expected.name}. Run npm ci before generating notices.`);
  }

  const installedManifest = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'));
  if (installedManifest.version !== metadata.version) {
    throw new Error(
      `Installed ${expected.name} version ${installedManifest.version || 'unknown'} does not match package-lock.json ${metadata.version}.`,
    );
  }

  return metadata;
}

function validatePackagedResources() {
  const configuredFiles = appPackage.build?.files;
  if (!Array.isArray(configuredFiles) || !configuredFiles.includes(ocrWrapperExclusion)) {
    throw new Error(
      `@tesseract.js-data/eng OCR wrapper must be excluded from package.json build.files: ${ocrWrapperExclusion}`,
    );
  }

  const configuredResources = appPackage.build?.extraResources;
  if (!Array.isArray(configuredResources)) {
    throw new Error('package.json build.extraResources must be an array.');
  }

  for (const expected of requiredResources) {
    const configured = configuredResources.some(
      (resource) => resource?.from === expected.from && resource?.to === expected.to,
    );
    if (!configured) {
      throw new Error(`Required packaged resource is not configured: ${expected.from} -> ${expected.to}.`);
    }

    const sourcePath = path.join(projectRoot, ...expected.from.split('/'));
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Required packaged resource is missing: ${expected.from}. Run npm ci first.`);
    }
  }

  const apacheLicensePath = path.join(projectRoot, 'node_modules', 'tesseract.js', 'LICENSE.md');
  const apacheLicenseBytes = fs.readFileSync(apacheLicensePath);
  const apacheLicense = apacheLicenseBytes.toString('utf8');
  const actualSha256 = crypto.createHash('sha256').update(apacheLicenseBytes).digest('hex').toUpperCase();
  if (actualSha256 !== expectedApacheLicenseSha256) {
    throw new Error(
      `tesseract.js LICENSE SHA-256 mismatch: expected ${expectedApacheLicenseSha256}, found ${actualSha256}.`,
    );
  }
  if (!/Apache License\s+Version 2\.0, January 2004/.test(apacheLicense)) {
    throw new Error('The packaged tesseract.js license is not the reviewed Apache License 2.0 text.');
  }
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, '\\|');
}

# Third-party notices

This file is generated from `package-lock.json` by `npm run notices`. Do not edit the dependency table by hand.

ScreenLingo is distributed under the MIT License. The packages below remain subject to their own licenses. This inventory contains every production package recorded by the current npm lockfile, including transitive dependencies.

## Production dependencies (16)

| Package | Locked version | Declared package license |
| --- | --- | --- |
| [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) | 1.0.0 | MIT |
| [bmp-js](https://www.npmjs.com/package/bmp-js) | 0.1.0 | MIT |
| [idb-keyval](https://www.npmjs.com/package/idb-keyval) | 6.3.0 | Apache-2.0 |
| [image-size](https://www.npmjs.com/package/image-size) | 2.0.4 | MIT |
| [is-url](https://www.npmjs.com/package/is-url) | 1.2.4 | MIT |
| [lucide](https://www.npmjs.com/package/lucide) | 1.41.0 | ISC |
| [node-fetch](https://www.npmjs.com/package/node-fetch) | 2.7.0 | MIT |
| [opencollective-postinstall](https://www.npmjs.com/package/opencollective-postinstall) | 2.0.3 | MIT |
| [regenerator-runtime](https://www.npmjs.com/package/regenerator-runtime) | 0.13.11 | MIT |
| [tesseract.js](https://www.npmjs.com/package/tesseract.js) | 7.0.0 | Apache-2.0 |
| [tesseract.js-core](https://www.npmjs.com/package/tesseract.js-core) | 7.0.0 | Apache-2.0 |
| [tr46](https://www.npmjs.com/package/tr46) | 0.0.3 | MIT |
| [wasm-feature-detect](https://www.npmjs.com/package/wasm-feature-detect) | 1.9.0 | Apache-2.0 |
| [webidl-conversions](https://www.npmjs.com/package/webidl-conversions) | 3.0.1 | BSD-2-Clause |
| [whatwg-url](https://www.npmjs.com/package/whatwg-url) | 5.0.0 | MIT |
| [zlibjs](https://www.npmjs.com/package/zlibjs) | 0.3.1 | MIT |

## Bundled application runtime

| Component | Locked version | License | Source |
| --- | --- | --- | --- |
| Electron | 44.2.0 | MIT | [electron/electron](https://github.com/electron/electron) |

Electron includes Chromium, Node.js, and other third-party software. Their notices are shipped with the Electron distribution in `LICENSES.chromium.html`. License files supplied by npm packages remain in their installed package directories when included in a build.

## Bundled English OCR data

The English OCR asset has two distinct license layers:

1. The npm wrapper [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) at version 1.0.0 declares MIT in its package metadata.
2. The actual `4.0.0_best_int/eng.traineddata.gz` model comes from [naptha/tessdata](https://github.com/naptha/tessdata). The upstream [`gh-pages/LICENSE`](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE) applies Apache License 2.0 to that model data.

The wrapper JavaScript and package metadata are excluded from the packaged application. Only the Apache-2.0 model payload is copied as an OCR asset via `extraResources`; the complete Apache License 2.0 text is copied beside it as `resources/tessdata/LICENSE-APACHE-2.0.txt` for compliance. That text comes from `tesseract.js@7.0.0/LICENSE.md`, which contains the standard Apache License 2.0 text.

## Preserved license text for tr46 0.0.3

The `tr46@0.0.3` npm metadata declares MIT, but that published package does not contain a separate license file. The required copyright and permission notice is preserved here in full:

```text
MIT License

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
SOFTWARE.
```

## Researched projects are not dependencies

The applications listed in [the open-source research notes](docs/OPEN_SOURCE_RESEARCH.md) were studied for product and architecture decisions. Their source code is not vendored into ScreenLingo, and they are not runtime dependencies of this project.

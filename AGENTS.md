# ScreenLingo

**Version:** 0.1.0 | **Port:** N/A (Windows desktop app) | **Stack:** Electron 44, Node.js, vanilla HTML/CSS/JavaScript, Tesseract.js

## What

ScreenLingo is a Windows screenshot OCR, translation, and screenshot Q&A tool for developer errors. OCR runs locally; translation is online unless the user configures a local OpenAI-compatible model.

## Quick Start

```powershell
npm ci
npm run check
npm test
npm start
```

Requires Windows 10/11 x64 and Node.js 20 or newer. There is no `.env` file or fixed application port.

## Commands

```powershell
npm start              # Run the Electron app in development
npm run check          # Check JavaScript syntax
npm test               # Run unit tests
npm run test:e2e       # Run desktop E2E tests in an interactive Windows session
npm run test:network   # Optional live translation/network checks
npm run pack           # Build dist/win-unpacked
npm run dist           # Build the Windows portable executable
```

Use `npm ci` for a clean install. Use `npm install` only when intentionally changing dependencies and `package-lock.json`.

## Architecture

```text
src/
  main/       Electron lifecycle, IPC, capture, OCR, network, settings
  renderer/   Main window and capture overlay UI
  assets/     Application icons
tests/        Node unit tests
  e2e/        Playwright-driven Electron desktop tests
scripts/      Maintainer and asset-generation scripts
docs/         Privacy, open-source research, and supporting documentation
```

The main process owns privileged operations. A narrow preload bridge exposes approved IPC calls to the isolated renderer. A capture flows from desktop selection to the OCR worker, then through the selected network route and translation provider before results return to the UI.

## Key Files

```text
src/main/main.js                 Application entry point and IPC orchestration
src/main/preload.js              Renderer API allowlist
src/main/capture-service.js      Desktop capture lifecycle and crop selection
src/main/ocr-service.js          Local OCR worker queue, cancellation, watchdogs
src/main/network-service.js      Direct, system, and local-proxy routing
src/main/translation-service.js  Bing, Google, and OpenAI-compatible providers
src/main/settings-store.js       Validation and encrypted API key persistence
src/renderer/app.js              Main UI state and interactions
tests/e2e/smoke.cjs              Real Electron workflow coverage
package.json                     Scripts, dependencies, and electron-builder config
```

## Safety Boundaries

- Keep `contextIsolation` enabled and `nodeIntegration` disabled. Do not expose generic Node.js or IPC primitives to renderers.
- Validate IPC senders and all cross-process inputs. Preserve size limits, deadlines, cancellation, and explicit error reporting.
- Store API keys only through Electron `safeStorage`; never log secrets, proxy credentials, subscriptions, screenshots, or clipboard contents.
- Remote model endpoints require HTTPS. HTTP is allowed only for loopback hosts. Do not silently follow redirects or bypass the user's selected network mode.
- Keep screenshot OCR local. Upload images only after the user explicitly invokes screenshot Q&A.
- Preserve user cancellation as a non-error outcome and do not replace previous results on cancelled capture.

## Testing Expectations

- All changes: run `npm run check` and `npm test`.
- UI, capture, OCR, shortcut, tray, or IPC changes: also run `npm run test:e2e` on an interactive Windows desktop.
- Packaging, assets, dependencies, or OCR model changes: also run `npm run pack` and verify the packaged app.
- Network-provider changes: add deterministic unit coverage; run `npm run test:network` only when a live integration check is justified.

Follow the existing CommonJS style and two-space indentation. Keep changes focused and update user-facing documentation, privacy notes, and `CHANGELOG.md` when behavior changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

# Changelog

All notable changes to ScreenLingo will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [0.2.0] - 2026-10-22

### Added

- Lightweight Windows overlays: screenshot translations now cover the original capture region, while selected-text and clipboard translations appear in a compact panel beside the cursor with copy and workbench actions.
- `Alt+Shift+X` selected-text translation through Windows UI Automation, with a tray-menu entry and an explicit clipboard fallback when the active control does not expose its selection.
- Per-user Explorer context-menu entries for screenshot translation and clipboard translation on the desktop and folder backgrounds, plus a settings switch that installs or removes them under `HKCU` without administrator rights.
- Window-launch quick actions (`--quick-action=capture|clipboard|selection`) and a second-instance handoff so a running app can be invoked from Windows without opening the workbench.
- Windows integration documentation covering context-menu boundaries, registry locations, selected-text support, and overlay behavior.
- Android `0.1.0-alpha.1` source and local experience build: share text or screenshots, import a selected image, on-device Chinese/English OCR, word/sentence selection, translation, and optional model questions.
- Explicit text/image sharing controls, encrypted Android model settings, bounded cancellable requests, and mobile regression tests. Android device acceptance remains pending; this is separate from the Windows stable release.
- Added user-facing Android installation, build, release, source-research, and third-party license notes. The debug APK is a personal preview artifact and is not a store-signed release.

### Changed

- Screenshot translation from the global shortcut, tray, or Explorer menu now presents the translated result over the captured region instead of bringing the workbench forward.
- Clipboard and selected-text translations now open a compact cursor-side panel; the in-app workbench keeps its existing long-form workflow.
- Enabling the current-user Explorer menu is now the default; it can be disabled at any time from Settings and is removed on the next startup when disabled.
- Updated the release version and release-note source to `0.2.0`.

### Security

- Quick result windows run with context isolation, sandboxing, and a dedicated preload that exposes only state display, copy, resize, close, workbench, and explicit clipboard-fallback actions; screenshots and OCR images are never sent to them.
- Selected-text translation reads UI Automation text only after an explicit action, rejects password controls, and does not simulate copy or rewrite the clipboard.
- Windows shell integration is limited to two Explorer verbs under the current user's `HKCU`, with no `HKLM`, service, startup-entry, or file-association changes.

### Fixed

- Mobile default Bing now starts from the canonical `www.bing.com` host and Chinese locale path, avoiding the current `cn.bing.com` redirect that would otherwise be rejected by the no-redirect policy.
- Mobile OCR no longer fails just because an imported image cannot be compressed below the optional 2 MB vision-upload limit; text extraction remains available and the attachment checkbox explains when cropping is needed.
- Keep mocked OCR and translation timeout tests alive until their assertions finish on Node.js 22, matching the lifetime of real worker threads and network requests.
- Make the desktop E2E keyboard selection cover the synthetic error image on smaller displays and retain OCR assertions for both error identifiers.
- Attach failure diagnostics and synthetic test screenshots to failed desktop CI runs, excluding isolated browser profiles.
- Normalize clipboard reads so an unavailable or unexpected Windows clipboard value produces the normal empty-content message instead of an exception.

### Tests

- 127 Node test-runner checks pass, including quick-result geometry, late-result suppression, selected-text parsing/encoding, Windows shell menu command construction, and the existing OCR, translation, network, settings, and release-tool suites.
- Windows GitHub Actions CI passes the full development Electron E2E suite, including the new quick text panel, plus the unpacked build check.

## [0.1.0] - 2026-09-26

### Added

- Windows region capture with offline English OCR and Chinese translation.
- Clipboard translation through a global shortcut.
- Optional screenshot questions through OpenAI-compatible vision models.
- Bing, Google, and OpenAI-compatible translation providers.
- Automatic, system, direct, and manual network modes, including local v2rayN detection.
- Light and dark themes, system tray operation, encrypted API key storage, and cancellable workflows.
- Unit tests and packaged Electron end-to-end coverage.

### Changed

- Added explicit API Key removal in settings and preserved unanswered screenshot questions when a request is cancelled.
- Release preflight now scans arbitrary ordinary files and raw bytes for high-confidence credentials, fails closed on oversized or unreadable candidates, rejects tracked ignored files and private-key containers, and accepts only canonical npm registry tarball URLs.
- Third-party notices now enforce a reviewed production-license allowlist, verify the bundled Apache-2.0 license by SHA-256, and document that the OCR wrapper JavaScript and package metadata are excluded while only the model data is copied through `extraResources`.
- CI and release workflows run the full Electron E2E suite and the read-only third-party-notices freshness check before publishing.

### Tests

- 100 Node test-runner checks pass, including 44 release-tool subtests.
- Development and freshly packaged Electron builds each pass 15 desktop workflow checks; the portable executable passes 4 startup, isolated-settings, offline-OCR, and network-IPC checks.

### Security

- Bounded image, OCR, network response, and model output processing.
- Renderer rejects oversized pasted or dropped images before reading or sending them over IPC.
- Capture submission failures are announced in the overlay and allow the user to retry without reopening capture.
- HTTPS enforcement for remote model endpoints and redirect rejection.
- Renderer isolation, validated IPC senders, and Windows-backed API key encryption.
- Release builds use separate read-only build and write-only publish jobs, pinned GitHub Actions, official npm registry URLs, and verified SHA-256 assets.
- Third-party notices preserve the OCR model's Apache-2.0 text and the `tr46` copyright notice.
- Release checks scan ordinary and commonly overlooked files for high-confidence secrets, fail closed when candidates cannot be inspected, reject sensitive key containers and tracked ignored files, and reject stale third-party notices.
- The packaged OCR footprint excludes the npm wrapper JavaScript and metadata; only the English model and its verified Apache-2.0 license text are copied as extra resources.

# Changelog

All notable changes to ScreenLingo will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Android `0.1.0-alpha.1` source and local experience build: share text or screenshots, import a selected image, on-device Chinese/English OCR, word/sentence selection, translation, and optional model questions.
- Explicit text/image sharing controls, encrypted Android model settings, bounded cancellable requests, and mobile regression tests. Android device acceptance remains pending; this is separate from the Windows stable release.
- Added user-facing Android installation, build, release, source-research, and third-party license notes. The debug APK is a personal preview artifact and is not a store-signed release.

### Fixed

- Mobile default Bing now starts from the canonical `www.bing.com` host and Chinese locale path, avoiding the current `cn.bing.com` redirect that would otherwise be rejected by the no-redirect policy.
- Mobile OCR no longer fails just because an imported image cannot be compressed below the optional 2 MB vision-upload limit; text extraction remains available and the attachment checkbox explains when cropping is needed.
- Keep mocked OCR and translation timeout tests alive until their assertions finish on Node.js 22, matching the lifetime of real worker threads and network requests.
- Make the desktop E2E keyboard selection cover the synthetic error image on smaller displays and retain OCR assertions for both error identifiers.
- Attach failure diagnostics and synthetic test screenshots to failed desktop CI runs, excluding isolated browser profiles.

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

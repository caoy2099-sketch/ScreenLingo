# ScreenLingo

English | [简体中文](README.md)

A Windows utility for local screenshot OCR, developer-error translation, and visual questions about the current screenshot.

![ScreenLingo home screen](docs/assets/screenlingo-home.png)

## Download

Download the [latest Release](https://github.com/caoy2099-sketch/ScreenLingo/releases/latest), or download the current v0.1.0 assets directly:

| File | Recommended use |
| --- | --- |
| [ScreenLingo-0.1.0-win-x64.zip](https://github.com/caoy2099-sketch/ScreenLingo/releases/download/v0.1.0/ScreenLingo-0.1.0-win-x64.zip) | Recommended. Extract the archive and run `win-unpacked/截译 ScreenLingo.exe`; keep the folder together. |
| [ScreenLingo-0.1.0-x64.exe](https://github.com/caoy2099-sketch/ScreenLingo/releases/download/v0.1.0/ScreenLingo-0.1.0-x64.exe) | Single-file portable build. It extracts itself on every launch, so startup is slower. |
| [SHA256SUMS.txt](https://github.com/caoy2099-sketch/ScreenLingo/releases/download/v0.1.0/SHA256SUMS.txt) | Verify downloaded files. |

The executable is currently unsigned. Windows SmartScreen may show an “Unknown publisher” warning on first launch. Download builds only from this repository's Releases page.

## Android mobile preview

The Android preview turns “share a screenshot or text → local OCR → select words or sentences → translate, ask, copy, or search” into a mobile workflow. It supports Photo Picker, system sharing, compatible text-selection menus, and explicit paste. A screenshot is sent to a vision model only when you actively enable the attachment in a question.

Version `0.1.0-alpha.1` is available as a personal preview package from the [Android alpha Release](https://github.com/caoy2099-sketch/ScreenLingo/releases/tag/mobile-v0.1.0-alpha.1), but compatibility testing across real Android devices is still pending. Default translation uses Bing's web endpoint; Android's current VPN or proxy routing is respected, and the app does not scan v2rayN on a computer. See the [Android mobile guide](mobile/README.md) for installation, privacy boundaries, build verification, and limitations.

## Start in three steps

1. Download and start the app. Choose a translation provider in Settings if needed.
2. In any window, press `Alt+Shift+S` and drag over the English error.
3. Release the mouse and wait for local OCR and translation. Press `Esc` to cancel a selection.

You can also copy text and press `Alt+Shift+T` to translate the clipboard.

## Common shortcuts

| Action | Default shortcut |
| --- | --- |
| Screenshot translation | `Alt+Shift+S` |
| Translate clipboard | `Alt+Shift+T` |
| Cancel screenshot selection | `Esc` |

Shortcuts can be changed in Settings. Closing the main window keeps the app in the system tray by default; this behavior can be disabled in Settings.

## Visual questions

The workbench can answer a follow-up question about the current screenshot, such as asking why an error occurred or how to fix it. Configure an OpenAI-compatible vision model that accepts images (for example, a local Ollama vision model) in Settings. Text-only models and Bing or Google translation cannot answer screenshot questions. The current image is uploaded to your configured model endpoint only when you explicitly send a question.

## Network settings

The default Automatic mode works whether v2rayN is running or stopped:

- When v2rayN is running, ScreenLingo prefers the system proxy or an available local proxy listener.
- When v2rayN is stopped or no local proxy is available, it tries a direct connection.
- Settings can force System proxy, Direct, or Manual proxy mode. Enter the actual v2rayN listener port when needed.

ScreenLingo does not start, stop, inspect, or modify v2rayN subscriptions or nodes, and it does not change the Windows system proxy.

## Privacy and limitations

- OCR runs locally. The bundled model currently recognizes English only.
- Standard translation sends recognized text only; a screenshot is sent only when you explicitly use Visual questions.
- Screenshots and OCR results stay in memory by default and are not written to a history database.
- API keys are encrypted with Windows secure storage. The app does not fall back to plaintext when secure storage is unavailable.
- Bing and Google modes use web endpoints and may be affected by network conditions, rate limits, or provider changes. For a controlled service, configure an OpenAI-compatible endpoint you trust.
- The default translation providers require a network connection. Fully offline use requires a local model.

See the [privacy notes](docs/PRIVACY.md) for data flows. Report security issues privately through [SECURITY.md](SECURITY.md); use [Issues](https://github.com/caoy2099-sketch/ScreenLingo/issues) for regular feedback.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request guidance.

ScreenLingo is available under the [MIT License](LICENSE). Dependency licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

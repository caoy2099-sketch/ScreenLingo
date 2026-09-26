# ScreenLingo

English | [简体中文](README.md)

A Windows utility for local OCR, Chinese translation, and visual troubleshooting of developer errors.

> The current release is a **v0.1 public beta** intended for personal use and community testing. It is not commercially code-signed, so Windows SmartScreen may show an "Unknown publisher" warning on first launch.

![ScreenLingo home screen](docs/assets/screenlingo-home.png)

## Download

Get the latest version from [GitHub Releases](../../releases/latest). Two Windows x64 packages are provided:

| Package | Best for | How to use it |
| --- | --- | --- |
| **`ScreenLingo-<version>-win-x64.zip` (recommended)** | Everyday use and faster startup | Extract the whole archive, then run `截译 ScreenLingo.exe`. Keep the accompanying files together. |
| **`ScreenLingo-<version>-x64.exe`** | Carrying a single file | Run it directly. It extracts itself on every launch, so startup is slower than the ZIP build. |

Check the SHA-256 value published with the release. Because beta builds are currently unsigned, download them only from this project's Releases page.

## What it does

- Press `Alt+Shift+S` to select an English error in a terminal, editor, or log window, recognize it locally, and translate it into Chinese.
- Copy text and press `Alt+Shift+T` to translate the current clipboard contents.
- Open, paste, or drop PNG, JPEG, WebP, and BMP images, then correct the recognized text before translating again.
- Configure an OpenAI-compatible vision model to ask follow-up questions about the current screenshot.
- Work with v2rayN running or stopped through automatic routing, with explicit system proxy, direct, and local proxy modes available.

![ScreenLingo translation workspace](docs/assets/screenlingo-workbench.png)

## Quick start

1. Download and start ScreenLingo from Releases.
2. In any application, press `Alt+Shift+S` and drag over the error message.
3. Release the mouse. ScreenLingo recognizes the English text locally and displays a Chinese translation using the selected provider.

Press `Esc` to cancel a selection. If another application owns a shortcut, ScreenLingo keeps the previous setting and reports the conflict so you can choose another shortcut. Closing the main window keeps the app in the system tray by default; this can be disabled in Settings.

### Why there is no global context-menu injection

Windows does not provide one reliable context-menu extension point for every editor, terminal, and desktop application. A universal implementation would require global mouse hooks, simulated copying, or process injection, which can conflict with terminal shortcuts, security software, and applications running at different privilege levels.

ScreenLingo therefore provides two predictable entry points: a screenshot shortcut and a copy-then-translate shortcut. A native right-click action for web pages is better implemented as a separate browser extension.

## Translation and networking

### Keyless online translation

Bing is the default. It receives recognized text, not the screenshot, and does not require an API key. Google can be selected in Settings.

**The Bing and Google modes use unofficial web endpoints, not supported commercial APIs with stability guarantees.** They can be affected by rate limits, CAPTCHAs, regional restrictions, endpoint changes, and the providers' terms of service. For controlled or production use, configure an OpenAI-compatible endpoint that you trust.

### With or without v2rayN

The default network mode is Automatic. Routing is checked for each request, so restarting ScreenLingo is not required:

- With v2rayN running: ScreenLingo first honors an active system proxy. If the system proxy is disabled, it tries the configured local proxy and the common SOCKS5 `127.0.0.1:10808` and HTTP `127.0.0.1:10809` listeners.
- Without v2rayN: when no local proxy is listening, ScreenLingo connects directly. Bing is generally reachable from mainland China; Google usually requires a working proxy.
- Settings can force System proxy, Direct, or Manual proxy mode. Enter the actual loopback listener if v2rayN uses a different port.
- Proxy detection confirms the selected route, not the availability of a remote translation provider. If an active proxy cannot complete a request, ScreenLingo reports the failure instead of silently resending content outside that route.
- Loopback services such as local Ollama always connect directly. ScreenLingo does not start, stop, inspect, or modify v2rayN, and it does not modify the Windows system proxy.

Some proxy exits redirect Bing's China site to its international site. ScreenLingo only tries fixed Bing China and international addresses and rejects arbitrary cross-origin redirects. User text is not sent until a valid session has been established.

### OpenAI-compatible services and visual questions

OpenAI APIs, compatible gateways, and local Ollama servers are supported. Remote endpoints must use HTTPS. HTTP is accepted only for `localhost`, `127.0.0.1`, and `::1`.

A typical local Ollama setup is:

```text
Endpoint: http://127.0.0.1:11434/v1
Text model: an installed text model
Vision model: an installed model that accepts images
API key: usually blank for local Ollama
```

The current image is sent to the configured vision endpoint only when you explicitly use the visual question feature. Changing to an endpoint with a different origin clears the stored API key so an old credential cannot be sent to a new service.

## Privacy and security

- OCR runs in a local worker with the bundled English Tesseract model and does not use a CDN.
- The clipboard is read once only after an explicit user action; it is not monitored continuously.
- Screenshots stay in memory by default and are not automatically written to disk.
- Standard translation uploads recognized text only. Images are uploaded only for an explicit visual question.
- API keys are encrypted through Electron `safeStorage` and Windows. If secure storage is unavailable, ScreenLingo refuses to save the key instead of falling back to plaintext.
- Network requests reject cross-origin redirects and enforce response-size limits.
- Compressed size, format, dimensions, and total pixels are checked before an image enters OCR.

See the [privacy notes](docs/PRIVACY.md) for the complete data flow. Report vulnerabilities privately using the process in [SECURITY.md](SECURITY.md), rather than opening a public issue first.

## Current limitations

- The bundled OCR model recognizes English only and is tuned for English developer errors. Text that does not need OCR can be pasted directly.
- The default translation providers still require a network connection. Fully offline translation requires a separately installed local model exposed through an OpenAI-compatible endpoint.
- Very small, blurred, translucent, or heavily compressed text can reduce OCR accuracy. Selecting a tighter region often helps.
- The beta does not include automatic updates. New builds must be downloaded manually from Releases.

## Run from source

You need Windows 10/11 x64, Git, and Node.js 20 or newer.

After cloning the repository, open the `ScreenLingo` directory and run:

```powershell
npm ci
npm test
npm run check
npm run test:e2e
npm start
```

Build the unpacked directory and single-file portable executable with:

```powershell
npm run pack
npm run dist
```

Build output is written to `dist/`. The English OCR model is copied to `resources/tessdata/`, so it is not downloaded at runtime.

`npm run test:network` is an optional live-network test. It sends only hard-coded sample errors and checks Bing direct routing, automatic proxy routing, and Google automatic proxy routing. It never reads the clipboard or sends a desktop screenshot.

Release maintainers can refresh and validate public artifacts with:

```powershell
npm run notices
npm run screenshots
npm run release:check
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code. Please describe the user scenario in an issue before starting a substantial feature. Changes to translation providers should document both their privacy boundary and failure behavior.

Before implementation and again during public-release preparation, the project studied Pot, CopyTranslator, STranslate, eSearch, Umi-OCR, PaddleOCR, Tesseract, and Argos Translate. No GPL application code was copied. See the [open-source research notes](docs/OPEN_SOURCE_RESEARCH.md).

ScreenLingo is available under the [MIT License](LICENSE). The complete production dependency inventory is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

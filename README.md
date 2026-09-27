# 截译 ScreenLingo

[English](README.en.md) | 简体中文

Windows 上的本地截图 OCR、报错翻译和截图提问工具，适合把英文代码报错快速看懂。

![截译主界面](docs/assets/screenlingo-home.png)

## 下载

直接下载 [最新 Release](https://github.com/caoy2099-sketch/ScreenLingo/releases/latest)，或下载当前版本 v0.1.0：

| 文件 | 推荐场景 |
| --- | --- |
| [ScreenLingo-0.1.0-win-x64.zip](https://github.com/caoy2099-sketch/ScreenLingo/releases/download/v0.1.0/ScreenLingo-0.1.0-win-x64.zip) | 推荐。解压后运行 `win-unpacked/截译 ScreenLingo.exe`，请保留整个文件夹。 |
| [ScreenLingo-0.1.0-x64.exe](https://github.com/caoy2099-sketch/ScreenLingo/releases/download/v0.1.0/ScreenLingo-0.1.0-x64.exe) | 便携单文件。每次启动会先解压，启动速度较慢。 |
| [SHA256SUMS.txt](https://github.com/caoy2099-sketch/ScreenLingo/releases/download/v0.1.0/SHA256SUMS.txt) | 校验下载文件完整性。 |

程序暂未进行商业代码签名，首次启动时 Windows SmartScreen 可能显示“未知发布者”。请只从本仓库的 Releases 下载。

## 三步开始

1. 下载并启动程序；首次使用可在“设置”中选择翻译服务。
2. 在任意窗口按 `Alt+Shift+S`，拖动框选英文报错。
3. 松开鼠标，等待本地 OCR 和翻译结果；按 `Esc` 可取消框选。

也可以先复制文字，再按 `Alt+Shift+T` 翻译剪贴板内容。

## 常用快捷键

| 操作 | 默认快捷键 |
| --- | --- |
| 截图翻译 | `Alt+Shift+S` |
| 翻译剪贴板 | `Alt+Shift+T` |
| 取消截图框选 | `Esc` |

快捷键可在设置中修改。关闭主窗口后程序默认驻留系统托盘，可在设置中关闭此行为。

## 截图提问

翻译工作区可以针对当前截图继续提问，例如询问错误原因或修复方向。此功能需要在设置中配置支持图片输入的 OpenAI 兼容视觉模型（例如本机 Ollama 的视觉模型）；普通文字模型或必应、Google 翻译不能处理截图提问。只有主动发送问题时，当前图片才会上传到你配置的模型端点。

## 网络设置

默认“自动”模式同时适用于 v2rayN 已开启和未开启的情况：

- v2rayN 开启时，优先使用系统代理或可用的本机代理端口。
- v2rayN 未开启或本机代理不可用时，自动尝试直连。
- 也可以在设置中明确选择系统代理、直连或手动代理，并填写 v2rayN 的实际端口。

程序不会启动、关闭或读取 v2rayN 的节点和订阅，也不会修改 Windows 系统代理。

## 隐私与限制

- OCR 在本机运行，随程序提供的模型目前只识别英文。
- 普通翻译只发送识别出的文字；截图只在主动使用“截图提问”时发送。
- 截图和识别结果默认只保存在内存中，不自动写入历史记录。
- API Key 通过 Windows 安全存储加密保存；安全存储不可用时不会改用明文。
- 必应和 Google 模式依赖其网页接口，可能受到网络、限流或服务变化影响；需要稳定服务时请配置自己信任的 OpenAI 兼容端点。
- 默认翻译需要网络；完全离线使用需要本机模型。

更多数据流说明见[隐私说明](docs/PRIVACY.md)。发现安全问题请按[安全策略](SECURITY.md)私下报告；普通问题或建议请提交 [Issue](https://github.com/caoy2099-sketch/ScreenLingo/issues)。

## 参与项目

开发和 Pull Request 流程见[贡献指南](CONTRIBUTING.md)。

ScreenLingo 采用 [MIT License](LICENSE)，依赖许可见[第三方声明](THIRD_PARTY_NOTICES.md)。

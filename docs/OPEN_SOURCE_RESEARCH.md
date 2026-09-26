# 开源项目调研与取舍

首次调研日期：2026-09-04。公开发布前复核日期：2026-09-22。

下表星标数、许可证标识和归档状态来自 2026-09-22 的 GitHub REST API，仅用于记录当时的社区规模与项目状态；这些数据会随时间变化。对项目的研究用于理解产品边界和常见架构，不代表 ScreenLingo 使用或再分发了这些应用的源代码。

| 项目 | 复核星标 | 许可证 | GitHub 状态 | 审阅范围 | 对 ScreenLingo 的启发 |
| --- | ---: | --- | --- | --- | --- |
| [pot-app/pot-desktop](https://github.com/pot-app/pot-desktop) | 19,421 | GPL-3.0 | 已归档 | `hotkey.rs`、`screenshot.rs`、`system_ocr.rs`、OpenAI/Ollama 服务 | 每个工作流使用独立热键；OCR 和翻译提供方可替换 |
| [CopyTranslator/CopyTranslator](https://github.com/CopyTranslator/CopyTranslator) | 18,083 | GPL-2.0 | 未归档 | `shortcut.ts`、`ocr.ts`、`pp-ocr.ts`、`translate-controller.ts` | OCR 放入后台队列；翻译服务与界面状态分离 |
| [STranslate/STranslate](https://github.com/STranslate/STranslate) | 8,085 | MIT | 未归档 | `MouseHookService.cs`、`ClipboardHelper.cs`、`Screenshot.cs`、`TranslationResultCoordinator.cs` | 使用系统拖动阈值；只让最新请求更新结果 |
| [xushengfeng/eSearch](https://github.com/xushengfeng/eSearch) | 7,198 | GPL-3.0 | 未归档 | 截图、OCR、翻译、热键和发布流程的源码与文档 | 截图工作台可以整合多种输入，但开发报错场景应保持操作路径短 |
| [hiroi-sora/Umi-OCR](https://github.com/hiroi-sora/Umi-OCR) | 47,434 | MIT | 未归档 | OCR 引擎、截图识别、批量任务和本地接口的源码与文档 | OCR 可保持本地化，并通过清晰的引擎边界为后续替换留空间 |
| [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 89,968 | Apache-2.0 | 未归档 | 项目结构、模型组合和部署策略 | 更高精度 OCR 可作为后续可选组件，不塞进首版安装包 |
| [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) | 76,612 | Apache-2.0 | 未归档 | OCR 引擎及语言数据组织 | 首版随包提供英文模型，使 OCR 安装后即可离线工作 |
| [argosopentech/argos-translate](https://github.com/argosopentech/argos-translate) | 6,493 | MIT | 未归档 | 离线翻译模型及按语言安装机制 | 离线翻译模型适合按需安装，避免强制增加主程序体积 |

## 形成的产品取舍

- 聚焦“开发报错”而不是做完整截图工具箱。默认路径只有框选、OCR、翻译，结果区再承接可选的截图提问。
- 不持续轮询剪贴板。只有用户主动触发剪贴板快捷键时才读取一次，减少隐私风险和后台开销。
- 不默认上传截图。OCR 在本机执行；免密在线翻译只发送识别文字；只有用户主动提问并配置视觉模型时才发送图片。
- OCR 在独立 Worker 中运行，并设置初始化、识别和输入尺寸上限，避免大图或异常任务拖垮主界面。
- 每次新任务会取消旧任务，并使用任务编号阻止较慢的旧响应覆盖新结果。
- 网络路由独立于翻译提供方。自动模式能够在系统代理、本机 v2rayN 常见端口和直连之间作出明确选择，同时允许用户强制指定路由。
- Windows 没有覆盖所有应用的稳定统一右键接口，因此主入口采用截图热键；文字入口采用用户先复制、再触发热键，避免在终端中模拟 `Ctrl+C` 而中断进程。

## 与相近项目的边界

eSearch 和 Umi-OCR 已经覆盖广泛的截图与 OCR 工作流，STranslate 和 Pot 也提供更通用的翻译能力。ScreenLingo 不以功能数量与它们竞争，而是保持一个更窄的定位：中文 Windows 开发者处理英文错误信息时，能够快速框选、校对、翻译，并在需要时继续询问错误原因。

这一边界也决定了首版不内置大体积 PaddleOCR 模型、不持续监听剪贴板、不提供截图编辑器和历史资料库。后续功能应以是否缩短开发报错处理路径、是否保持隐私边界清楚作为取舍依据。

## 代码与许可证边界

- ScreenLingo 没有复制 Pot、CopyTranslator、eSearch 等 GPL 项目的应用代码；截图、热键、任务取消、网络路由和服务边界均为独立实现。
- 许可证较宽松的项目也只用于设计和架构研究，没有把它们的应用源码直接合并进本仓库。
- 实际随 ScreenLingo 分发的 npm 生产依赖由锁文件生成清单，见 [第三方声明](../THIRD_PARTY_NOTICES.md)。研究对象与运行时依赖是两组不同的项目。
- 新增依赖前需要核对许可证、维护状态、安装体积和是否会扩大截图或文字的网络传输范围。

## 可继续优化

- 以可选下载的方式增加 PaddleOCR/ONNX 提供方，提高小字号、等宽代码和标点识别率。
- 为浏览器单独提供扩展，获得可靠的网页原生右键翻译入口。
- 为离线翻译建立按需模型安装与磁盘占用提示，而不是将数百 MB 模型捆绑进基础包。
- 使用可信代码签名证书发布，减少 Windows SmartScreen 对个人发布程序的提示。

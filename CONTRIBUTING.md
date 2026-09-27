# 参与贡献

感谢你帮助改进 ScreenLingo。这个项目会处理屏幕、剪贴板和网络请求，因此功能正确之外，也特别看重隐私边界、失败提示和可复现的验证。

## 开发环境

- Windows 10/11 x64
- Node.js 20 或更新版本（CI 使用 Node.js 22）
- npm（随 Node.js 提供）

首次安装：

```powershell
npm ci
```

如果你有意更新依赖及 `package-lock.json`，才使用 `npm install`。

常用命令：

```powershell
npm start          # 启动开发版
npm run check      # 检查 JavaScript 语法
npm test           # 运行单元测试
npm run pack       # 生成 Windows 解包版本
npm run dist       # 生成单文件便携版
```

`npm run test:e2e` 会启动真实 Electron 窗口，需要交互式 Windows 桌面。请在涉及界面、OCR、快捷键、截图或打包运行时执行。`npm run test:network` 会访问真实翻译服务，只使用测试脚本内固定的示例文本；它不是普通提交的必跑项。

## 提交问题

请先搜索已有 Issue，再使用对应模板。Bug 报告应包含最小复现步骤、ScreenLingo 与 Windows 版本、网络模式、是否运行 v2rayN，以及所用翻译服务。

不要上传 API Key、代理凭据、订阅地址、包含私有代码的截图或完整用户目录。安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开披露利用细节。

## 分支与 Pull Request

1. 从默认分支创建聚焦单一问题的分支。
2. 保持改动小而清楚；不要顺手格式化或重构无关文件。
3. 为行为变化补充测试，并运行 `npm run check` 与 `npm test`。
4. 界面变化需附浅色、深色和窄窗口截图，并说明键盘与无障碍行为。
5. 更新受影响的 README、隐私说明和 `CHANGELOG.md`。
6. 提交 Pull Request，并完整填写检查清单。

建议使用清晰的提交消息，例如 `fix: preserve results when capture is cancelled`。项目不强制某种分支命名或提交数量，合并前可能会整理提交历史。

## 代码约定

- 遵循现有 CommonJS 与两空格缩进风格。
- 保持主进程、预加载脚本和渲染进程的权限边界；不要向渲染进程暴露通用 Node.js 能力。
- 所有跨进程输入都应验证并设置合理的大小或时间上限。
- 远程请求不得悄悄更换目标、降级安全连接或绕过用户选择的网络模式。
- 用户取消操作不应显示为失败，后台异常也不能被静默吞掉。
- 不要把真实用户数据写进测试固定数据、截图或日志。

## 使用 Codex

仓库根目录的 `AGENTS.md` 包含项目结构、命令和安全约束。使用 Codex 参与开发时，请让它先读取该文件，并在提交前检查实际差异与测试结果。生成的代码仍需由提交者理解和负责。

## 发布

维护者在发布前应更新版本号和 `CHANGELOG.md`，完成本地桌面端验证，然后推送与 `package.json` 版本完全一致的标签，例如 `v0.1.0`。GitHub Actions 会重新测试并生成以下 Release 文件：`ScreenLingo-<版本>-x64.exe`、`ScreenLingo-<版本>-win-x64.zip` 和 `SHA256SUMS.txt`。发布完成后，请检查 Release 页面中的下载链接与校验文件，再同步更新 README 中的版本链接。

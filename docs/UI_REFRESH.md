# 截译界面更新 · 2026-09-21（发布前复核：2026-09-23）

本次更新采用柔雾紫与冷白色的工作台风格，围绕“框选英文、读取中文”组织界面。

## 变更

- 常驻侧边工具栏：截图、剪贴板、图片与设置入口；窄窗口收为图标栏。
- 首页：明确的截图按钮、与当前设置同步的快捷键、英文与中文对照示例。
- 工作台：统一原文与译文阅读区域、截图提问、加载及错误状态。
- 设置：按翻译服务、网络、快捷键、主题和隐私分组，保存按钮保持可见。
- 深色主题、键盘焦点、标签页方向键与 Home / End 导航、减少动态效果偏好。
- 截图选区：淡紫边框与尺寸标签，提示拖动框选和 Esc 取消。

## 验证

运行模块语法检查和 100 项 Node 自动化测试通过（其中发布工具回归子测试 44 项）。开发版与最新打包版分别通过 15 项 Electron 桌面流程检查，涵盖真实离线 OCR、合成屏幕拖框截图、截图提交失败后的恢复、翻译与截图提问、取消提问后的问题保留、导航与焦点、快捷键、主题、API Key 删除、剪贴板/读图失败提示、超大图片前置拒绝与 20 MiB 边界，以及 720×560 和 1280×720 窗口。单文件便携版实际启动后通过 4 项隔离设置、离线 OCR 和网络接口检查。

翻译和视觉问答测试使用本机模拟服务；本轮未重测真实第三方服务。

报告与截图：`artifacts/development/`、`artifacts/packaged/`、`artifacts/portable/`。打包程序中的六个 UI 文件（含 `capture.js`）已逐字节核对，与最终源码一致；独立重建验证产物位于 `artifacts/docs-build-verify/` 和 `artifacts/docs-release-verify/`。

## 运行与构建

从项目根目录运行 `npm start`。最终 Windows 程序位于 `dist/win-unpacked/截译 ScreenLingo.exe`，该目录需整体保留；单文件便携版位于 `dist/ScreenLingo-0.1.0-x64.exe`。

构建命令（会复用 `node_modules` 中锁定的 Electron）：

```powershell
npm.cmd run pack
npm.cmd run dist -- --publish never
```

界面文件：`src/renderer/index.html`、`styles.css`、`app.js`、`capture.html`、`capture.css`、`capture.js`。新增交互回归检查位于 `tests/e2e/smoke.cjs`。

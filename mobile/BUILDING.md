# Android 开发与验证

普通使用说明见 [README](README.md)。这个工程与 Windows Electron 应用独立，移动版目前是 `0.1.0-alpha.1` 本地体验版。

## 构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0。Gradle Wrapper 固定为 8.10.2，下载包含 SHA-256 校验；首次构建需要能访问 Google Maven、Maven Central 和 Gradle 分发服务。设置 `JAVA_HOME` 和 `ANDROID_SDK_ROOT` 为本机安装目录，不提交 `local.properties` 或签名密钥。

在 `mobile/android` 目录运行：

```powershell
.\gradlew.bat --project-cache-dir ../../artifacts/android/gradle-cache --no-daemon testDebugUnitTest assembleDebug lintDebug
```

macOS / Linux 对应使用 `sh ./gradlew`。生成文件位于仓库根目录的 `artifacts/android/`，不需要改变桌面版的发布扫描边界。

APK 默认位置：`artifacts/android/app/outputs/apk/debug/app-debug.apk`。这是 Android 工具链自动生成的开发签名包，用于个人试用，不是应用商店正式发行包。正式发行前须配置并妥善备份独立发布签名，使用不同签名升级时 Android 会拒绝覆盖安装。

Windows 中文目录说明：当前纯 Kotlin/Compose 工程允许非 ASCII 项目路径，不含 CMake/NDK 编译步骤。JDK 17 在中文 Windows 上用系统编码读取 Java 启动参数文件；不要仅强制 Gradle daemon 为 UTF-8，否则测试可能找不到中文路径下已编译的类。Java 源码编译单独设置 UTF-8，Kotlin 源码保留 UTF-8。

## 模块

- `core/`：原文分段、按原顺序拼接、模型配置验证。
- `data/`：ML Kit 本地 OCR、输入上限和取消、Bing/模型请求、Keystore 设置。
- `MobileViewModel`：独立的设置初始化/保存与可取消内容任务。初始化失败时禁止联网，不静默切换服务。
- `MainActivity`：系统分享、Photo Picker、文字选择菜单和剪贴板边界。
- `ui/`：Compose 浅色/深色界面、选择工作台、显式图片附送同意。

默认翻译使用必应网页接口，不是稳定性有保障的官方付费 API。确定性网络测试使用本机 MockWebServer，不发送用户内容或实际调用收费模型。

## 验证范围

JVM 测试覆盖分段与标点保留、URL/密钥验证、请求结构、图片 opt-in、重定向拒绝、输入及响应上限、HTTP 取消、图片提供方阻塞、内部超时与用户取消、冷启动分享时的服务选择及设置保存隔离，以及默认必应入口。

静态审查和 JVM 测试不能代替真实 Android 上的分享授权、Keystore、ML Kit 推理与界面布局验证。无 Android 手机或模拟器连接时，不将 `assembleDebug` 的成功当成运行成功。

建议设备验收顺序：

1. 飞行模式安装后首次打开，导入含中英文的清晰截图，确认 OCR、按词/句选择及复制可用。
2. 相册分享图片、浏览器分享文字、兼容 App 的文字选择菜单各执行一次；取消图片选择保留原内容。
3. 直连、系统 VPN 和 Wi-Fi HTTP 代理下分别翻译；失败后原文和选择仍保留。
4. 配置模型后完全关闭应用，从分享冷启动；确认文字发送到配置的服务，没有切回必应。
5. 提问不勾选图片时仅发文字，主动勾选后才发送整张导入图片；分享新图片使旧弹窗关闭。
6. 导入一张能识别但无法压缩到 2 MB 的大图，确认 OCR、选择和文字翻译仍可用，附图选项被禁用并提示裁剪。
7. 错误地址保存后草稿保留；重启后密钥可解锁；清空密钥后保存不再发送旧密钥。
8. 检查 Android 8 与新系统、无 GMS 手机、深色模式、大字体、横屏、小屏和 TalkBack。

图片提供方可能不响应 Android 取消请求。应用隔离阻塞读取并限制后台读取/清理线程数量，防止反复导入形成无界线程；不能强行终止第三方提供方或原生解码，所以不宣称整个识别过程具有严格硬性 30 秒截止。

## 开源与后续发布

项目代码遵循根目录 MIT 许可证；Google ML Kit SDK/模型和依赖各自遵循其条款，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。实际阅读的参考代码及独立实现取舍见 [源码研究记录](../docs/mobile/RESEARCH.md)。

公开 Android Release 前还需完成设备验收、正式签名和完整依赖许可证分发核对。当前不修改 Windows 稳定版的下载入口。

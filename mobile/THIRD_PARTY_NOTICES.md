# ScreenLingo Android 第三方组件说明

核对日期：2026-09-28。ScreenLingo 自己编写的源码采用仓库根目录的 [MIT License](../LICENSE)。下面的第三方库、SDK、模型和外部服务仍受各自许可证或服务条款约束，不能因与本项目一同使用而被重新标记为 MIT。

本说明根据 [Android 依赖声明](android/app/build.gradle.kts)、[构建插件声明](android/build.gradle.kts)、所列组件的 Maven POM，以及本地已获取的 ML Kit AAR 许可文件整理。它说明组件来源与授权边界，不宣称覆盖未来构建引入的所有传递依赖。

## 开源库与工具

| 组件 | 当前声明版本 | 许可与来源 |
| --- | --- | --- |
| AndroidX Activity Compose | 1.9.3 | Apache-2.0；[POM](https://dl.google.com/dl/android/maven2/androidx/activity/activity-compose/1.9.3/activity-compose-1.9.3.pom) |
| AndroidX Lifecycle ViewModel / Runtime Compose | 2.8.7 | Apache-2.0；[Runtime Compose Android POM](https://dl.google.com/dl/android/maven2/androidx/lifecycle/lifecycle-runtime-compose-android/2.8.7/lifecycle-runtime-compose-android-2.8.7.pom) |
| AndroidX Compose UI、Material 3、Material Icons、预览与调试工具 | BOM 2024.12.01 管理 | Apache-2.0；[BOM POM](https://dl.google.com/dl/android/maven2/androidx/compose/compose-bom/2024.12.01/compose-bom-2024.12.01.pom)、[UI 1.7.6 POM](https://dl.google.com/dl/android/maven2/androidx/compose/ui/ui-android/1.7.6/ui-android-1.7.6.pom) |
| AndroidX ExifInterface | 1.3.7 | Apache-2.0；[POM](https://dl.google.com/dl/android/maven2/androidx/exifinterface/exifinterface/1.3.7/exifinterface-1.3.7.pom) |
| Kotlin / Kotlin Compose 编译插件与标准库 | 插件 2.0.21；标准库版本由依赖解析确定 | Apache-2.0；[Kotlin 标准库 POM](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.pom) |
| kotlinx.coroutines Android / Play Services 适配 | 1.9.0 | Apache-2.0；[Android POM](https://repo.maven.apache.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-android/1.9.0/kotlinx-coroutines-android-1.9.0.pom) |
| OkHttp | 4.12.0 | Apache-2.0；[POM](https://repo.maven.apache.org/maven2/com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0.pom) |
| Okio（OkHttp 的传递依赖） | 已获取组件为 3.6.0 | Apache-2.0；[POM](https://repo.maven.apache.org/maven2/com/squareup/okio/okio-jvm/3.6.0/okio-jvm-3.6.0.pom) |

Apache-2.0 完整条款：[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)。版权与附加 NOTICE 仍归各自权利人，应保留实际分发组件携带的声明。

测试使用 JUnit 4.13.2（EPL-1.0）、JSON-java `20240303`（该版本 POM 标明 Public Domain）、MockWebServer 4.12.0 与 kotlinx-coroutines-test 1.9.0（Apache-2.0）。这些由 `testImplementation` 声明，不作为正常运行时依赖加入应用。`ui-tooling` 是调试构建依赖。

## Google ML Kit 与 Google 运行时组件

本应用使用 `com.google.mlkit:text-recognition-chinese:16.0.1` 随包进行设备端中英文文字识别。其 [POM](https://dl.google.com/dl/android/maven2/com/google/mlkit/text-recognition-chinese/16.0.1/text-recognition-chinese-16.0.1.pom) 标明的是 **ML Kit Terms of Service**，不是 Apache-2.0 或 MIT。

ML Kit 是 Google 提供的闭源 SDK，随包识别模型也不属于 ScreenLingo 的开源源码。使用与分发须遵守 [ML Kit Terms & Privacy](https://developers.google.com/ml-kit/terms)，以及其中引用的 [Google APIs Terms of Service](https://developers.google.com/terms)。该条款把机器学习模型视为相关软件；本项目不重新授权、提取或发布其模型源代码。

本轮实际查看的 ML Kit AAR 包括：

- `text-recognition-chinese:16.0.1`
- `text-recognition-bundled-common:17.0.0`
- `common:18.11.0`
- `vision-common:17.3.0`
- `vision-interfaces:16.3.0`

这些 AAR 自带 `third_party_licenses.json` 索引与 `third_party_licenses.txt` 正文。其中索引可见 AndroidX、Kotlin、Abseil、ICU、TensorFlow 等第三方条目；这些开放组件的存在不意味着整个 ML Kit SDK 或随包识别模型采用同一开源许可证。分发时应保留供应方完整声明，不能用本文件的概述替代。

Google Play Services 运行时组件也有不同于 AndroidX 的授权。例如本轮检查的 `play-services-basement:18.4.0`、`play-services-base:18.5.0`、`play-services-tasks:18.2.0` POM 标为 [Android Software Development Kit License](https://developer.android.com/studio/terms.html)。`play-services-mlkit-text-recognition-chinese:16.0.1` 的 POM 标为 ML Kit Terms of Service。不能将所有 `com.google.*` 组件统一描述成 Apache-2.0。

## ML Kit 的数据行为

依据本轮读取的 Google 官方条款（页面标注最后修订日期为 2025-05-14）：

- 输入图片、视频或文字的处理在设备端完成，ML Kit 不把这些输入及处理结果发送到 Google 服务器。
- ML Kit 可能联系 Google 服务器以取得修复、模型更新或硬件加速兼容信息。
- SDK 会向 Google 发送 API 性能与使用指标，适用 [Google 隐私政策](https://policies.google.com/privacy)。Google 要求应用开发者向用户告知此类指标处理。

因此，“截图识字在本机运行”不等于“SDK 永不联网或完全没有指标上报”。用户主动翻译、模型提问、查找和分享产生的数据发送则属于各自独立的应用功能，应按相应接收方告知。

## 服务与学习参考

必应在线翻译、自定义模型服务、系统搜索与用户选择的分享应用不是被本项目重新许可的软件。它们的可用性、费用和数据处理适用各自服务条款；ScreenLingo 不承诺必应网页接口永久可用。

RTranslator 与 OSS Document Scanner 只作为本轮源码学习参考，没有复制其代码或打包为本项目依赖。具体读取的提交、文件和实现取舍见[源码学习记录](../docs/mobile/RESEARCH.md)。

## 二进制分发核对

公开分发 APK 时，需按该 APK 的实际依赖解析结果保留相应版权、许可证正文和 NOTICE，包括 Google SDK 自带的第三方许可文件；本概览不能代替完整许可材料。当前文档的存在本身不代表已完成某个 APK 的二进制许可文件核验。依赖升级后应同步复核版本、许可与 SDK 数据行为。

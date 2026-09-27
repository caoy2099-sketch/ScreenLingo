# 移动版源码学习记录

记录日期：2026-09-28。以下为实际读取 GitHub 固定提交中的相关源码后的观察，不是对整个仓库的安全审计。星标来自当日 GitHub API 快照，只作为筛选参考；没有复制这些项目的代码、图片或模型到 ScreenLingo。

前一轮[产品方案](PRODUCT.md)记录了仓库元数据与官方平台能力；本记录补充本轮实际源码阅读的范围与具体取舍。

## 1. RTranslator：图片来源、授权与方向校正

- 仓库：[niedev/RTranslator](https://github.com/niedev/RTranslator)，10,462 星。
- 固定提交：`a040a3d62c8da9a2b28b8a3d58936a98ed2591cd`。
- 仓库标识为 Apache-2.0；所读文件带有 `Copyright 2016 Luca Martino` 和 Apache-2.0 文件头。
- 阅读文件：[GalleryImageSelector.java](https://github.com/niedev/RTranslator/blob/a040a3d62c8da9a2b28b8a3d58936a98ed2591cd/app/src/main/java/nie/translator/rtranslator/tools/GalleryImageSelector.java)。这是用户头像的图库选择、裁剪和保存工具，不是该项目的 OCR 或翻译实现。

实际看到的实现：

1. 构造器给头像控件挂接点击菜单，以 `android.intent.action.PICK` 选择 `image/*`，通过旧式 `onActivityResult` 接收结果。
2. `onActivityResult` 先把收到的 URI 复制到缓存，再调用 `com.android.camera.action.CROP`。它通过 `FileProvider` 提供缓存图片 URI，同时使用读写授权标记与 `ClipData` 交给裁剪应用。
3. 裁剪结束后读取输出文件；备用路径通过 `MediaStore.Images.Media.DATA` 获取路径再解码。结果被显示为圆形头像，可保存为应用内部的 `user_image`。
4. `modifyOrientation` 用 ExifInterface 读取方向，覆盖 90°/180°/270° 旋转以及水平、垂直翻转。
5. `copyImageUriIntoFile` 的读取循环没有使用本次 `read` 的返回字节数，而是每次写入整个缓冲区。该局部实现提醒我们：高星项目仍须逐段判断，不能把工具函数直接搬入新项目。

ScreenLingo 的选择与差异：

- 采用 AndroidX Photo Picker / Activity Result，以及显式系统分享授权。只处理授权的 `content://` URI，不依赖图片的真实文件路径，也不把外部裁剪应用作为导入前提。
- 当前需求是一次性识字和问答，保留会话内预览即可；不套用头像的内部持久化与圆形裁剪流程。
- 使用独立的有界读取与图片解码流程，限制输入字节和像素，读失败明确反馈给用户。处理 EXIF 时也覆盖转置、横向转置方向。
- 可以借鉴“先处理图片来源和方向，再进入后续动作”的顺序，但现代 Android 的 URI、权限和生命周期必须按当前 API 独立实现。

本轮没有阅读 RTranslator 的离线翻译模型执行代码，因此不以它为依据声称 ScreenLingo 已具备离线翻译能力。

## 2. OSS Document Scanner：解码前控制图片内存

- 仓库：[ossappscollective/OSS-DocumentScanner](https://github.com/ossappscollective/OSS-DocumentScanner)，2,486 星。
- 固定提交：`feb2d428ec6491c3d6de63be54ef5302c75dbf22`。
- 已读[仓库许可证](https://github.com/ossappscollective/OSS-DocumentScanner/blob/feb2d428ec6491c3d6de63be54ef5302c75dbf22/LICENSE)：MIT，`Copyright (c) 2022 Martin Guillon`。
- 阅读文件：[ImageUtils.kt](https://github.com/ossappscollective/OSS-DocumentScanner/blob/feb2d428ec6491c3d6de63be54ef5302c75dbf22/plugin-nativeprocessor/platforms/android/java/com/akylas/documentscanner/utils/ImageUtils.kt)，主要阅读 `calculateInSampleSize`、尺寸计算、EXIF 角度与 `readBitmapFromFile`。

实际看到的实现：

1. `getImageSizeSync` 使用 `inJustDecodeBounds` 获取尺寸；`content://` 路径通过 `ContentResolver.openFileDescriptor` 读取，普通路径走文件解码。
2. `calculateInSampleSize` 按 2 的幂递增采样倍率，并额外比较采样后的总像素与目标像素预算，考虑长宽比例特别悬殊的图片。
3. `readBitmapFromFile` 根据目标尺寸与宽高比生成解码参数，先采样解码，再根据 EXIF 执行方向变换；文件描述符在 `finally` 中关闭。
4. `calculateAngleFromFile` 和 `calculateAngleFromFileDescriptor` 返回旋转角度。本轮所读这两个函数没有处理 EXIF 镜像方向，不能把它们描述为覆盖所有方向的完整方案。

ScreenLingo 的选择与差异：

- 沿用 Android 的“先读边界、再采样解码”通用思路，自己实现适合单张截图的流程；先限制输入到 20 MiB、最大单边 20,000 像素和总计 4,000 万像素，再把处理图控制到最长边 2,048 像素。
- 先限制原始总像素可避免仅按宽度缩小的长截图陷阱；乘积计算使用 `Long`。这些限制仍需结合真机 OCR 质量测试调整，不代表已测得最佳参数。
- 会话预览和问答使用同一份校正方向后的图片，附图问答时再限制 JPEG 到 2 MiB；不引入文档页管理、扫描裁边或同步系统。
- 保留描述符和流的可靠关闭，并针对用户取消与识字失败分别处理。OCR 原生任务尚在使用的位图不能提前回收。

额外核对了 [ImagePicker.kt](https://github.com/ossappscollective/OSS-DocumentScanner/blob/feb2d428ec6491c3d6de63be54ef5302c75dbf22/plugin-nativeprocessor/platforms/android/java/com/akylas/documentscanner/ImagePicker.kt)：该提交中类与选择器代码全部被注释。因此本记录不把它当作项目正在使用 Photo Picker 的证据。

## 学习结论

移动工具的价值在于“把内容带进来、选出需要的部分、马上执行下一步”。源码学习主要帮助检查图片授权、内存预算与资源生命周期，没有改变首版以分享和主动导入为入口的范围。

ScreenLingo 的界面、选择片段模型、模型服务配置与网络流程为本项目独立实现。参考仓库的许可证不覆盖它们使用的全部模型或 SDK；本项目的 MIT 也不覆盖引入的 Google ML Kit SDK 与模型。实际依赖说明见[移动版第三方说明](../../mobile/THIRD_PARTY_NOTICES.md)。

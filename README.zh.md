<p align="center">
  <a href="https://droneclean.app/zh/"><img src="https://droneclean.app/media/studio-demo.webp" alt="右侧的 Claude Code 通过 MCP 服务器在 DroneClean Studio 中剪辑六段无人机素材，以 47 倍速播放" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="README.it.md">Italiano</a> &nbsp;·&nbsp;
  <a href="README.es.md">Español</a> &nbsp;·&nbsp;
  <a href="README.fr.md">Français</a> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português (Brasil)</a> &nbsp;·&nbsp;
  <a href="README.tr.md">Türkçe</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <strong>简体中文</strong>
</p>

<p align="center">
  <strong>为 FPV 和无人机飞手打造的免费、本地优先的视频编辑器。</strong><br>
  陀螺仪防抖、D-Log M 调色、带光流慢动作的平滑变速，以及面向 AI 代理的 MCP 服务器。
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="许可证：GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS（Apple 芯片）、Windows 和网页版" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>下载 Mac 版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>下载 Windows 版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/zh/studio/"><strong>在浏览器中打开</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/zh/">droneclean.app</a>
</p>

上面的视频是 Claude Code 通过编辑器的 MCP 服务器剪辑六段 DJI Avata 2 素材的过程，全程没有人碰鼠标。它读取歌曲的节拍，从每段素材中挑出几秒并卡点剪切，根据陀螺仪数据防抖，转换 D-Log M 色彩，给每个镜头加上带光流慢动作和运动模糊的变速，还会查看画面，把人和汽车剪掉。它用了 19 分钟，视频以 47 倍速展示。它做的每一处改动都是编辑器里的普通步骤，你可以撤销，也可以接着手动编辑。

## 前后对比

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="同一条无人机短片的左右对比：左边是拍摄原样，画面灰平且抖动；右边是在 DroneClean Studio 中完成防抖、调色和变速后的效果" width="488">
</p>

这是用同一次飞行的素材在 DroneClean Studio 中剪出的短片的前 24 秒。左边是拍摄原样的镜头：灰平的 D-Log M 色彩、无人机的抖动、真实速度。右边是完成的剪辑：根据陀螺仪数据防抖，D-Log M 经转换并调色，加入了变速、光流慢动作和运动模糊。

## 功能

- **陀螺仪防抖。** DJI 和 GoPro 的文件里带有相机的运动数据；Studio 用编译为 WebAssembly 的 [Gyroflow](https://github.com/gyroflow/gyroflow) 引擎来稳定画面，无需单独的分析步骤。9:16 项目中的 4:3 素材会自动填满竖屏画面，还有可用关键帧控制的取景，让主体始终在画面内。
- **为无人机素材准备的色彩。** DJI D-Log M 和 D-Log 转 Rec.709，来自 `.cube` 文件的创意风格、色轮、曲线、二级限定器、动力窗口，以及用于灰蒙蒙天空的天空渐变。
- **速度。** 带缓动分段的速度曲线，以及一键“平滑变速 + 缩放”。运动模糊沿光流跟随每个像素的运动，慢动作则根据光流生成新帧，而不是重复已有的帧。还有来自歌曲的节拍标记。
- 每个属性和效果参数都支持**关键帧**，提供贝塞尔和弹簧缓动。
- **导出。** 提供 YouTube 4K 和 Instagram Reels 预设，桌面版还支持 10 位母版（ProRes 422 HQ、HEVC Main 10）。
- **AI 代理。** 本地 MCP 服务器：Claude 或其他 MCP 客户端可以通过编辑器自己使用的同一套 SDK 来搭建、调色和导出项目，每一处改动都是一个可撤销的步骤。
- **无人机阴影去除**是唯一的付费效果，通过 DroneClean 云服务完成。
- **本地优先。** 项目和媒体都保存在你选择的文件夹中；只有当你为了去除阴影而发送一小段素材时，画面才会离开你的电脑。

<p align="center">
  <img src=".github/assets/studio.webp" alt="DroneClean Studio 编辑器，时间线上有一段海滩素材，画面上标出了无人机的阴影" width="820">
</p>

## 安装

**Mac（Apple 芯片）：** 从[最新版本](../../releases/latest)下载磁盘映像，把 DroneClean Studio 拖到“应用程序”。此版本尚未获得 Apple 签名，所以 macOS 第一次会拦截：先打开一次，然后前往 系统设置 › 隐私与安全性，点按**仍要打开**。

**Windows 10 和 11（x64）：** 从[最新版本](../../releases/latest)下载 `DroneClean-Studio-x64.exe` 并运行；它按当前用户安装，不会弹出管理员权限提示。它尚未签名，所以 SmartScreen 第一次会拦截：选择**更多信息 › 仍要运行**。它自带 FFmpeg，包含 NVIDIA、Intel 和 AMD 编码器。

**浏览器：** [droneclean.app/studio](https://droneclean.app/zh/studio/) 可以在电脑上的 Chrome 或 Edge 中运行同一个编辑器（需要 File System Access API）。

## 配合 AI 代理使用

桌面版默认开启代理访问（只有你的用户能访问；**设置 › 代理访问 › 允许 AI 代理**可以将其关闭），该面板会显示具体命令。在 Mac 上使用 Claude Code：

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

在 Windows 上，命令指向
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd`（面板中会显示你的用户路径）。

服务器有四个工具：`search`（SDK 参考、用户指南和功能地图）、`run`（针对编辑器 SDK 运行的脚本）、`frame`（渲染的画面或联系表）和 `export`。然后像上面的视频那样，用你自己的话提出剪辑要求：“用打开的项目里的六段素材做一个平滑的无人机剪辑，卡着歌曲的节拍剪。”

## 从源码构建

Apple 芯片上的 macOS、Node 24、带 `wasm32-unknown-unknown` 目标的 Rust、`wasm-bindgen-cli` 0.2.130 和 `wasm-opt`（Binaryen）。

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # 构建编辑器、Gyroflow 的 wasm 和 FFmpeg，然后在 dist/mac-arm64 生成应用
```

在 `studio/` 中，`npm run check:quick` 运行快速检查，`npm run verify` 运行完整测试套件（需要 Google Chrome 和 FFmpeg）。

## 仓库结构

| 路径 | 说明 |
| --- | --- |
| `studio/` | 编辑器，是 [FreeCut](https://github.com/walterlow/freecut)（MIT）的分支。DroneClean 自己的代码在 `studio/src/studio/`。 |
| `studio/desktop/` | Electron 应用、它的 FFmpeg 构建和发布脚本。 |
| `studio/mcp/` | 代理启动的 MCP 启动器。 |
| `studio/web/` | 网页版编辑器的静态服务器。 |
| `gyroflow/` | [Gyroflow](https://github.com/gyroflow/gyroflow)（GPL-3.0）的分支；`gyroflow/wasm/` 为编辑器构建它的引擎。 |

本仓库由发布流程发布：每个版本是一次提交，这个版本的标签是 `v0.1.10`。

## 贡献与安全

欢迎提交 bug 报告和想法：[提交 issue](../../issues/new/choose)。[CONTRIBUTING.md](CONTRIBUTING.md) 说明了改动如何进入发布版本。请按 [SECURITY.md](SECURITY.md) 的说明私下报告漏洞，不要发在公开的 issue 里。

## 许可证与致谢

GPL-3.0-or-later（见 [LICENSE](LICENSE)）。DroneClean Studio 包含 FreeCut（MIT）和 Gyroflow（GPL-3.0）；桌面应用包含 FFmpeg（LGPL-2.1），由官方源码通过 `studio/desktop/scripts/build-ffmpeg.sh` 构建。截图使用的是 Pexels 视频 39579103，遵循 [Pexels 许可](https://www.pexels.com/license/)。演示和前后对比使用的是作者自己拍摄的 DJI Avata 2 素材，由 droneclean.app 提供，不属于本仓库及其许可证。

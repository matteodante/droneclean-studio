<p align="center">
  <a href="https://droneclean.app/ko/"><img src="https://droneclean.app/media/studio-demo.webp" alt="오른쪽의 Claude Code가 MCP 서버를 통해 DroneClean Studio에서 드론 클립 여섯 개를 편집하는 모습, 47배속으로 표시" width="100%"></a>
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
  <strong>한국어</strong> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>FPV 및 드론 파일럿을 위한 무료 로컬 우선 동영상 편집기.</strong><br>
  자이로 손떨림 보정, D-Log M 색상, 옵티컬 플로 슬로 모션을 쓰는 부드러운 속도 램프, 그리고 AI 에이전트를 위한 MCP 서버.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="최신 릴리스" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="라이선스: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS(Apple silicon), Windows, 웹" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Mac용 다운로드</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Windows용 다운로드</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/ko/studio/"><strong>브라우저에서 열기</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/ko/">droneclean.app</a>
</p>

위 영상은 Claude Code가 편집기의 MCP 서버를 통해 DJI Avata 2 클립 여섯 개를 편집하는 모습입니다. 마우스에는 손도 대지 않습니다. 노래의 비트를 읽고, 각 클립에서 몇 초씩 골라 비트에 맞춰 자르고, 자이로 데이터로 손떨림을 보정하고, D-Log M 색상을 변환하고, 각 샷에 옵티컬 플로 슬로 모션과 모션 블러를 쓴 속도 램프를 주고, 프레임을 살펴 사람과 자동차는 빼 줍니다. 걸린 19분은 47배속으로 보여 드립니다. Claude Code가 하는 모든 변경은 편집기의 평범한 단계로 남기 때문에, 되돌리거나 직접 이어서 편집할 수 있습니다.

## 비포 & 애프터

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="같은 드론 릴을 나란히 비교한 화면: 왼쪽은 촬영 그대로의 밋밋하고 흔들리는 영상, 오른쪽은 DroneClean Studio에서 손떨림 보정, 색 보정, 속도 램프를 적용한 영상" width="488">
</p>

같은 비행에서 찍은 클립으로 DroneClean Studio에서 편집한 릴의 첫 24초입니다. 왼쪽은 촬영 그대로의 컷으로, 밋밋한 D-Log M 색상, 드론의 떨림, 실제 속도입니다. 오른쪽은 완성된 편집으로, 자이로 데이터로 손떨림을 보정하고 D-Log M을 변환해 색 보정했으며 속도 램프, 옵티컬 플로 슬로 모션, 모션 블러를 적용했습니다.

## 기능

- **자이로 손떨림 보정.** DJI와 GoPro 파일에는 카메라의 움직임이 담겨 있습니다. Studio는 WebAssembly로 컴파일한 [Gyroflow](https://github.com/gyroflow/gyroflow) 엔진으로 별도의 분석 과정 없이 이를 안정화합니다. 9:16 프로젝트에 놓은 4:3 클립은 세로 프레임을 저절로 채우고, 키프레임으로 움직일 수 있는 프레이밍이 피사체를 화면 안에 유지합니다.
- **드론 영상을 위한 색상.** DJI D-Log M과 D-Log에서 Rec.709로 변환, `.cube` 파일의 창의적인 룩, 컬러 휠, 커브, 보조 퀄리파이어, 파워 윈도, 색이 바랜 하늘을 위한 하늘 그라디언트.
- **속도.** 이징이 들어간 구간이 있는 속도 곡선과 원클릭 "부드러운 램프 + 줌". 모션 블러는 옵티컬 플로를 따라 각 픽셀의 움직임을 추적하고, 슬로 모션은 기존 프레임을 반복하는 대신 그로부터 새 프레임을 만듭니다. 노래에서 가져온 비트 마커.
- 모든 속성과 이펙트 매개변수에 **키프레임**. 베지어와 스프링 이징 지원.
- **내보내기.** YouTube 4K와 Instagram 릴용 프리셋, 데스크톱 앱에서는 10비트 마스터(ProRes 422 HQ, HEVC Main 10).
- **AI 에이전트.** 로컬 MCP 서버: Claude 또는 다른 MCP 클라이언트가 편집기가 쓰는 것과 같은 SDK로 프로젝트를 만들고, 색 보정하고, 내보낼 수 있으며, 모든 변경은 되돌릴 수 있는 단계입니다.
- **드론 그림자 제거**는 유일한 유료 이펙트이며, DroneClean 클라우드 서비스를 통해 처리합니다.
- **로컬 우선.** 프로젝트와 미디어는 직접 고른 폴더에 남습니다. 그림자를 지우려고 일부를 보낼 때만 영상이 컴퓨터를 떠납니다.

<p align="center">
  <img src=".github/assets/studio.webp" alt="타임라인에 해변 클립이 놓여 있고 화면에 드론의 그림자가 표시된 DroneClean Studio 편집기" width="820">
</p>

## 설치

**Mac(Apple silicon):** [최신 릴리스](../../releases/latest)에서 디스크 이미지를 내려받아 DroneClean Studio를 응용 프로그램으로 끌어다 놓으세요. 이 빌드는 아직 Apple 서명이 되어 있지 않아 처음에는 macOS가 실행을 막습니다. 한 번 열어 본 다음 시스템 설정 › 개인정보 보호 및 보안으로 이동해 **그래도 열기**를 누르세요.

**Windows 10 및 11(x64):** [최신 릴리스](../../releases/latest)에서 `DroneClean-Studio-x64.exe`를 내려받아 실행하세요. 사용자 계정 단위로 설치되며 관리자 권한 요청이 없습니다. 아직 서명되지 않아 처음에는 SmartScreen이 막습니다. **추가 정보 › 실행**을 선택하세요. NVIDIA, Intel, AMD 인코더가 들어 있는 자체 FFmpeg가 함께 설치됩니다.

**브라우저:** [droneclean.app/studio](https://droneclean.app/ko/studio/)에서는 컴퓨터의 Chrome 또는 Edge로 같은 편집기를 실행할 수 있습니다(File System Access API가 필요합니다).

## AI 에이전트와 함께 쓰기

데스크톱 앱에서는 에이전트 액세스가 기본으로 켜져 있습니다(사용자 본인만 접근할 수 있으며, **설정 › 에이전트 액세스 › AI 에이전트 허용**으로 끌 수 있습니다). 이 패널에 정확한 명령이 표시됩니다. Mac에서 Claude Code를 쓰려면:

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

Windows에서는 명령이
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd`를 가리킵니다(패널에는 사용자의 경로로 표시됩니다).

서버에는 네 가지 도구가 있습니다. `search`(SDK 레퍼런스, 사용자 가이드, 기능 지도), `run`(편집기의 SDK에 대해 실행하는 스크립트), `frame`(렌더링한 프레임 또는 컨택트 시트), 그리고 `export`입니다. 그런 다음 위 영상처럼 자기 말로 편집을 요청하세요: "열려 있는 프로젝트의 클립 여섯 개로, 노래 비트에 맞춰 자른 부드러운 드론 편집을 만들어 줘".

## 소스에서 빌드

Apple silicon의 macOS, Node 24, `wasm32-unknown-unknown` 타깃이 있는 Rust, `wasm-bindgen-cli` 0.2.130, 그리고 `wasm-opt`(Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # 편집기, Gyroflow의 wasm, FFmpeg를 빌드한 뒤 dist/mac-arm64에 앱 생성
```

`studio/`에서 `npm run check:quick`은 빠른 검사를, `npm run verify`는 전체 테스트 묶음을 실행합니다(Google Chrome과 FFmpeg가 필요합니다).

## 저장소 구성

| 경로 | 설명 |
| --- | --- |
| `studio/` | 편집기. [FreeCut](https://github.com/walterlow/freecut)(MIT)의 포크입니다. DroneClean 고유의 코드는 `studio/src/studio/`에 있습니다. |
| `studio/desktop/` | Electron 앱, FFmpeg 빌드, 릴리스 스크립트. |
| `studio/mcp/` | 에이전트가 실행하는 MCP 런처. |
| `studio/web/` | 웹 편집기의 정적 서버. |
| `gyroflow/` | [Gyroflow](https://github.com/gyroflow/gyroflow)(GPL-3.0)의 포크. `gyroflow/wasm/`이 그 엔진을 편집기용으로 빌드합니다. |

이 저장소는 릴리스 프로세스가 게시합니다. 각 릴리스는 커밋 하나이며, 이 릴리스의 태그는 `v0.1.9`입니다.

## 기여와 보안

버그 신고와 아이디어를 환영합니다: [이슈를 열어](../../issues/new/choose) 주세요. 변경 사항이 릴리스에 들어가는 과정은 [CONTRIBUTING.md](CONTRIBUTING.md)에 나와 있습니다. 취약점은 [SECURITY.md](SECURITY.md)에 설명된 대로 비공개로 신고하고, 공개 이슈에는 올리지 마세요.

## 라이선스와 크레딧

GPL-3.0-or-later([LICENSE](LICENSE) 참조). DroneClean Studio에는 FreeCut(MIT)과 Gyroflow(GPL-3.0)가 포함되어 있고, 데스크톱 앱에는 공식 소스에서 `studio/desktop/scripts/build-ffmpeg.sh`로 빌드한 FFmpeg(LGPL-2.1)가 포함되어 있습니다. 스크린샷에는 [Pexels License](https://www.pexels.com/license/)에 따라 Pexels 영상 39579103을 사용했습니다. 데모와 비포 & 애프터는 제작자가 직접 촬영한 DJI Avata 2 영상으로, droneclean.app에서 제공되며 이 저장소와 그 라이선스에 포함되지 않습니다.

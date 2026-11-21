<p align="center">
  <a href="https://droneclean.app/ja/"><img src="https://droneclean.app/media/studio-demo.webp" alt="右側の Claude Code が、MCP サーバー経由で DroneClean Studio 上の 6 本のドローンクリップを編集している様子（47 倍速で表示）" width="100%"></a>
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
  <strong>日本語</strong> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>FPV・ドローンパイロットのための、無料でローカルファーストな動画エディター。</strong><br>
  ジャイロ手ぶれ補正、D-Log M のカラー、オプティカルフローのスローモーションによるなめらかなスピードランプ、そして AI エージェント向けの MCP サーバー。
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="最新リリース" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="ライセンス: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS（Apple silicon）、Windows、Web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Mac 版をダウンロード</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Windows 版をダウンロード</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/ja/studio/"><strong>ブラウザーで開く</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/ja/">droneclean.app</a>
</p>

上の動画は、Claude Code がエディターの MCP サーバー経由で DJI Avata 2 の 6 本のクリップを編集している様子です。マウスには一度も触れていません。曲のビートを読み取り、各クリップから数秒ずつ選んでビートに合わせてカットし、ジャイロデータで手ぶれ補正をかけ、D-Log M のカラーを変換し、ショットごとにオプティカルフローのスローモーションとモーションブラーを使ったスピードランプを付け、フレームを見て人や車が映らないようにします。かかった 19 分は 47 倍速で表示しています。Claude Code が行う変更はすべてエディター上の通常の操作として記録されるので、元に戻すことも、そのまま手作業で編集を続けることもできます。

## ビフォー・アフター

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="同じドローンのリールを左右に並べた比較。左は撮影したままの、フラットで揺れのある映像。右は DroneClean Studio で手ぶれ補正、カラーグレーディング、スピードランプを施した映像" width="488">
</p>

同じフライトのクリップから DroneClean Studio で編集したリールの最初の 24 秒です。左は撮影したままのカット：フラットな D-Log M のカラー、ドローンの揺れ、実速度。右は完成した編集：ジャイロデータで手ぶれ補正をかけ、D-Log M を変換してグレーディングし、スピードランプ、オプティカルフローのスローモーション、モーションブラーを加えています。

## 機能

- **ジャイロによる手ぶれ補正。** DJI や GoPro のファイルにはカメラの動きが記録されています。Studio は WebAssembly にコンパイルした [Gyroflow](https://github.com/gyroflow/gyroflow) のエンジンで、解析パスなしにそれを補正します。9:16 のプロジェクトに置いた 4:3 のクリップは縦のフレームを自動で埋め、キーフレームで動かせるフレーミングが被写体を画面内に保ちます。
- **ドローン映像のためのカラー。** DJI D-Log M と D-Log から Rec.709 への変換、`.cube` ファイルによるクリエイティブルック、カラーホイール、カーブ、セカンダリークオリファイア、パワーウィンドウ、白っぽくなった空のためのスカイグラデーション。
- **スピード。** イーズ付きの区間を持つスピードカーブと、ワンクリックの「スムーズランプ + ズーム」。モーションブラーはオプティカルフローに沿って各ピクセルの動きを追い、スローモーションは既存のフレームを繰り返す代わりに、そこから新しいフレームを作ります。曲からのビートマーカー。
- すべてのプロパティとエフェクトパラメーターに**キーフレーム**。ベジェとスプリングのイージングに対応。
- **書き出し。** YouTube 4K と Instagram リール用のプリセット、デスクトップアプリでは 10 ビットのマスター（ProRes 422 HQ、HEVC Main 10）。
- **AI エージェント。** ローカルの MCP サーバー：Claude など MCP クライアントが、エディターと同じ SDK を通じてプロジェクトを作成、グレーディング、書き出しでき、変更はすべて元に戻せます。
- **ドローンの影の除去**（唯一の有料エフェクト）は、DroneClean のクラウドサービスで行います。
- **ローカルファースト。** プロジェクトとメディアは、あなたが選んだフォルダーに残ります。影を消すために一部を送信したときだけ、映像がコンピューターの外に出ます。

<p align="center">
  <img src=".github/assets/studio.webp" alt="タイムラインにビーチのクリップが置かれ、映像上にドローンの影がマークされた DroneClean Studio エディター" width="820">
</p>

## インストール

**Mac（Apple silicon）：** [最新リリース](../../releases/latest)からディスクイメージをダウンロードし、DroneClean Studio を「アプリケーション」にドラッグします。このビルドはまだ Apple の署名がないため、初回は macOS に止められます。一度開いたあと、システム設定 › プライバシーとセキュリティ に進み、**このまま開く**を押してください。

**Windows 10 / 11（x64）：** [最新リリース](../../releases/latest)から `DroneClean-Studio-x64.exe` をダウンロードして実行します。ユーザー単位でインストールされ、管理者権限の確認は出ません。まだ署名がないため、初回は SmartScreen に止められます。**詳細情報 › 実行**を選んでください。NVIDIA、Intel、AMD のエンコーダー付きの FFmpeg が同梱されています。

**ブラウザー：** [droneclean.app/studio](https://droneclean.app/ja/studio/) では、パソコンの Chrome または Edge で同じエディターが動きます（File System Access API が必要です）。

## AI エージェントと使う

デスクトップアプリではエージェントアクセスが最初からオンになっています（アクセスできるのはあなたのユーザーだけです。**設定 › エージェントアクセス › AIエージェントを許可**でオフにできます）。このパネルには実際のコマンドが表示されます。Mac で Claude Code を使う場合：

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

Windows では、コマンドは
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` を指します（パネルにはあなたのユーザーのパスで表示されます）。

サーバーには 4 つのツールがあります。`search`（SDK リファレンス、ユーザーガイド、機能マップ）、`run`（エディターの SDK に対して実行するスクリプト）、`frame`（レンダリングしたフレームまたはコンタクトシート）、そして `export` です。あとは上の動画のように、自分の言葉で編集を頼むだけです：「開いているプロジェクトの 6 本のクリップで、曲のビートに合わせてカットしたなめらかなドローン編集を作って」。

## ソースからビルド

Apple silicon 上の macOS、Node 24、`wasm32-unknown-unknown` ターゲット付きの Rust、`wasm-bindgen-cli` 0.2.130、そして `wasm-opt`（Binaryen）。

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # エディター、Gyroflow の wasm、FFmpeg をビルドし、dist/mac-arm64 にアプリを作成
```

`studio/` で、`npm run check:quick` は高速なチェックを、`npm run verify` は完全なスイートを実行します（Google Chrome と FFmpeg が必要です）。

## リポジトリの構成

| パス | 内容 |
| --- | --- |
| `studio/` | エディター。[FreeCut](https://github.com/walterlow/freecut)（MIT）のフォークです。DroneClean 独自のコードは `studio/src/studio/` にあります。 |
| `studio/desktop/` | Electron アプリ、その FFmpeg ビルド、リリーススクリプト。 |
| `studio/mcp/` | エージェントが起動する MCP ランチャー。 |
| `studio/web/` | Web 版エディターの静的サーバー。 |
| `gyroflow/` | [Gyroflow](https://github.com/gyroflow/gyroflow)（GPL-3.0）のフォーク。`gyroflow/wasm/` がそのエンジンをエディター向けにビルドします。 |

このリポジトリはリリースプロセスによって公開されます。各リリースは 1 つのコミットで、このリリースにはタグ `v0.1.9` が付きます。

## コントリビューションとセキュリティ

バグ報告やアイデアを歓迎します：[issue を作成](../../issues/new/choose)してください。変更がリリースに入るまでの流れは [CONTRIBUTING.md](CONTRIBUTING.md) に書かれています。脆弱性は [SECURITY.md](SECURITY.md) の手順に従って非公開で報告し、公開の issue には書かないでください。

## ライセンスとクレジット

GPL-3.0-or-later（[LICENSE](LICENSE) を参照）。DroneClean Studio には FreeCut（MIT）と Gyroflow（GPL-3.0）が含まれ、デスクトップアプリには、公式ソースから `studio/desktop/scripts/build-ffmpeg.sh` でビルドした FFmpeg（LGPL-2.1）が含まれます。スクリーンショットには [Pexels License](https://www.pexels.com/license/) の下で Pexels の動画 39579103 を使用しています。デモとビフォー・アフターは作者自身の DJI Avata 2 の映像で、droneclean.app から配信されており、このリポジトリにもそのライセンスにも含まれません。

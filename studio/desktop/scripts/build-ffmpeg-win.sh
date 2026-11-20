#!/bin/sh
# Builds the FFmpeg the Windows app ships (PLAN.md task 8.1): `ffmpeg.exe` and `ffprobe.exe`, static, x86-64, into
# desktop/vendor/ffmpeg-win/, which electron-builder copies to the app's resources/ffmpeg/ (the first place
# src/main/media/ffmpeg.ts looks). The Mac's binaries come from scripts/build-ffmpeg.sh, from the same FFmpeg source.
#
# It cross-compiles on Linux (on the PC: its WSL Ubuntu) with mingw-w64. When the mingw-w64 compiler is not installed
# it fetches Ubuntu's own packages of it with `apt-get download` (no root needed) and unpacks them under the work
# folder, so nothing is installed on the machine. The hardware encoders and decoders src/main/media/formats.ts asks
# for on win32 come from permissively licensed headers and one library, each pinned to a version and a SHA-256:
#   NVENC, NVDEC, CUVID  nv-codec-headers (MIT)            hevc_nvenc, h264_nvenc, av1_nvenc and NVIDIA decoding
#   Quick Sync           Intel's libvpl dispatcher (MIT)  hevc_qsv, h264_qsv
#   AMF                  AMD's AMF headers (MIT)          hevc_amf, h264_amf
#   Media Foundation, D3D11VA, DXVA2: part of Windows; zlib (zlib licence) for the PNG coders.
# The drivers load these at run time; a machine without the vendor's GPU simply lacks those encoders, and formats.ts
# falls through to the next one. With no --enable-gpl and no --enable-nonfree the binaries are LGPL-2.1-or-later;
# vendor/ffmpeg-win/NOTICE.txt records every source's address and checksum and the configure line (the source offer
# the licence asks for).
#
# Usage, from studio/desktop on Linux:  sh scripts/build-ffmpeg-win.sh
#   WORK=<dir>  where to build (default ~/.cache/droneclean-ffmpeg-win: a Linux disk; building on /mnt/c is slow)
#   OUT=<dir>   where the binaries go (default vendor/ffmpeg-win)
set -eu
cd "$(dirname "$0")/.."
DESKTOP=$(pwd)

FFMPEG_VERSION=9.0.2
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
NVCODEC_VERSION=n13.1.15.0
NVCODEC_URL="https://github.com/FFmpeg/nv-codec-headers/archive/refs/tags/$NVCODEC_VERSION.tar.gz"
NVCODEC_SHA256=2255bc74d038b95aa4be30f5f66322c2176acbdb90ada1851db6993536fbeaf7
AMF_VERSION=v1.5.3
AMF_URL="https://github.com/GPUOpen-LibrariesAndSDKs/AMF/releases/download/$AMF_VERSION/AMF-headers-$AMF_VERSION.tar.gz"
AMF_SHA256=0f521ad98041f8001147cded4a660127f18b1c27a801a5cd691bda1fa48381be
VPL_VERSION=v2.17.0
VPL_URL="https://github.com/intel/libvpl/archive/refs/tags/$VPL_VERSION.tar.gz"
VPL_SHA256=4de3e2faf1e8307fb282e4a43f443191810f6a6b0a484fffa7995ba1c814c6ec
ZLIB_VERSION=1.3.1
ZLIB_URL="https://github.com/madler/zlib/releases/download/v$ZLIB_VERSION/zlib-$ZLIB_VERSION.tar.gz"
ZLIB_SHA256=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
# libvpl's dispatcher is C++: its static library needs the C++ runtime, which its vpl.pc does not list (hence
# --extra-libs=-lstdc++ below; -static links it into the .exe)
# Ubuntu 24.04's mingw-w64 (GCC 13, posix threads) and nasm, when they are not installed
TOOLCHAIN_PACKAGES="binutils-mingw-w64-x86-64 gcc-mingw-w64-base gcc-mingw-w64-x86-64-posix \
gcc-mingw-w64-x86-64-posix-runtime g++-mingw-w64-x86-64-posix mingw-w64-common mingw-w64-x86-64-dev nasm"

HOST=x86_64-w64-mingw32
CONFIGURE="--target-os=mingw32 --arch=x86_64 --enable-cross-compile --cross-prefix=$HOST- \
--disable-shared --enable-static --disable-autodetect \
--enable-ffnvcodec --enable-nvenc --enable-nvdec --enable-cuvid --enable-amf --enable-libvpl \
--enable-mediafoundation --enable-d3d11va --enable-dxva2 --enable-zlib \
--disable-ffplay --disable-doc --disable-debug --disable-network --extra-libs=-lstdc++"
STAMP="$FFMPEG_VERSION $FFMPEG_SHA256 $NVCODEC_VERSION $AMF_VERSION $VPL_VERSION $ZLIB_VERSION $CONFIGURE"

OUT="${OUT:-$DESKTOP/vendor/ffmpeg-win}"
WORK="${WORK:-$HOME/.cache/droneclean-ffmpeg-win}"

if [ "$(uname -s)" != "Linux" ]; then
  echo "build-ffmpeg-win: this script cross-compiles on Linux (on Windows: inside WSL); nothing to do here"
  exit 0
fi
if [ -f "$OUT/ffmpeg.exe" ] && [ -f "$OUT/ffprobe.exe" ] && [ "$(cat "$OUT/stamp.txt" 2>/dev/null)" = "$STAMP" ]; then
  echo "build-ffmpeg-win: $OUT is already FFmpeg $FFMPEG_VERSION built this way"
  exit 0
fi
mkdir -p "$WORK/downloads"
JOBS=$(nproc 2>/dev/null || echo 4)

# fetch <url> <sha256> <file name>: download once into the work folder, refuse a file whose checksum differs
fetch() {
  target="$WORK/downloads/$3"
  if [ ! -f "$target" ]; then
    curl --fail --location --silent --show-error --output "$target.part" "$1"
    mv "$target.part" "$target"
  fi
  actual=$(sha256sum "$target" | cut -d' ' -f1)
  if [ "$actual" != "$2" ]; then
    echo "build-ffmpeg-win: $3 has checksum $actual, not $2; refusing to build it" >&2
    rm -f "$target"
    exit 1
  fi
  echo "$target"
}

# The compiler: the installed one, or Ubuntu's packages unpacked under $WORK/toolchain (relocatable, no root)
if ! command -v "$HOST-gcc" >/dev/null 2>&1 || ! command -v nasm >/dev/null 2>&1; then
  TOOLROOT="$WORK/toolchain/root"
  if [ ! -x "$WORK/toolchain/bin/$HOST-gcc" ]; then
    rm -rf "$WORK/toolchain"
    mkdir -p "$WORK/toolchain/debs" "$TOOLROOT" "$WORK/toolchain/bin"
    # shellcheck disable=SC2086
    (cd "$WORK/toolchain/debs" && apt-get download $TOOLCHAIN_PACKAGES)
    for deb in "$WORK"/toolchain/debs/*.deb; do dpkg -x "$deb" "$TOOLROOT"; done
    # The plain names come from update-alternatives on an installed system; here they are links to the posix ones
    for tool in gcc g++ cpp gcc-ar gcc-nm gcc-ranlib; do
      ln -sf "$TOOLROOT/usr/bin/$HOST-$tool-posix" "$WORK/toolchain/bin/$HOST-$tool"
    done
  fi
  PATH="$WORK/toolchain/bin:$TOOLROOT/usr/bin:$PATH"
  export PATH
fi
"$HOST-gcc" --version | head -1

PREFIX="$WORK/prefix"
rm -rf "$PREFIX" "$WORK/src"
mkdir -p "$PREFIX/include" "$PREFIX/lib/pkgconfig" "$WORK/src"

# zlib, static
tar -xzf "$(fetch "$ZLIB_URL" "$ZLIB_SHA256" "zlib-$ZLIB_VERSION.tar.gz")" -C "$WORK/src"
(cd "$WORK/src/zlib-$ZLIB_VERSION" && make -f win32/Makefile.gcc PREFIX="$HOST-" -j"$JOBS" libz.a >/dev/null &&
  cp zlib.h zconf.h "$PREFIX/include/" && cp libz.a "$PREFIX/lib/")
cat > "$PREFIX/lib/pkgconfig/zlib.pc" <<EOF
prefix=$PREFIX
Name: zlib
Description: zlib
Version: $ZLIB_VERSION
Libs: -L\${prefix}/lib -lz
Cflags: -I\${prefix}/include
EOF

# nv-codec-headers: headers and ffnvcodec.pc
tar -xzf "$(fetch "$NVCODEC_URL" "$NVCODEC_SHA256" "nv-codec-headers-$NVCODEC_VERSION.tar.gz")" -C "$WORK/src"
(cd "$WORK/src/nv-codec-headers-$NVCODEC_VERSION" && make PREFIX="$PREFIX" install >/dev/null)

# AMF: headers only, where FFmpeg looks for them (<AMF/core/Factory.h>)
tar -xzf "$(fetch "$AMF_URL" "$AMF_SHA256" "AMF-headers-$AMF_VERSION.tar.gz")" -C "$WORK/src"
cp -R "$WORK/src/amf-headers-$AMF_VERSION/AMF" "$PREFIX/include/AMF"

# libvpl: the Quick Sync dispatcher, static, without its tools and examples
tar -xzf "$(fetch "$VPL_URL" "$VPL_SHA256" "libvpl-$VPL_VERSION.tar.gz")" -C "$WORK/src"
VPL_SRC="$WORK/src/libvpl-${VPL_VERSION#v}"
cmake -S "$VPL_SRC" -B "$VPL_SRC/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=Windows \
  -DCMAKE_C_COMPILER="$HOST-gcc" -DCMAKE_CXX_COMPILER="$HOST-g++" -DCMAKE_RC_COMPILER="$HOST-windres" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DBUILD_SHARED_LIBS=OFF -DBUILD_TOOLS=OFF -DBUILD_EXAMPLES=OFF \
  -DBUILD_TESTS=OFF -DINSTALL_EXAMPLES=OFF -DINSTALL_DEV=ON >/dev/null
cmake --build "$VPL_SRC/build" -j"$JOBS" >/dev/null
cmake --install "$VPL_SRC/build" >/dev/null

# FFmpeg
tar -xJf "$(fetch "$FFMPEG_URL" "$FFMPEG_SHA256" "ffmpeg-$FFMPEG_VERSION.tar.xz")" -C "$WORK/src"
FFSRC="$WORK/src/ffmpeg-$FFMPEG_VERSION"
# shellcheck disable=SC2086
(cd "$FFSRC" && PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" ./configure \
  --prefix="$WORK/install" --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib -static" $CONFIGURE >/dev/null ||
  { tail -30 ffbuild/config.log >&2; exit 1; })
(cd "$FFSRC" && make -j"$JOBS" >/dev/null && make install >/dev/null)

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$WORK/install/bin/ffmpeg.exe" "$WORK/install/bin/ffprobe.exe" "$OUT/"
"$HOST-strip" "$OUT/ffmpeg.exe" "$OUT/ffprobe.exe"
cp "$FFSRC/COPYING.LGPLv2.1" "$OUT/COPYING.LGPLv2.1"
cat > "$OUT/NOTICE.txt" <<EOF
FFmpeg $FFMPEG_VERSION for Windows x64, built for DroneClean Studio from the official source:
  $FFMPEG_URL
  SHA-256 $FFMPEG_SHA256
configure $CONFIGURE
The binaries are licensed LGPL-2.1-or-later (COPYING.LGPLv2.1). Linked in, each under its own permissive licence:
  nv-codec-headers $NVCODEC_VERSION (MIT)   $NVCODEC_URL  SHA-256 $NVCODEC_SHA256
  AMF headers $AMF_VERSION (MIT)            $AMF_URL  SHA-256 $AMF_SHA256
  libvpl $VPL_VERSION (MIT)                 $VPL_URL  SHA-256 $VPL_SHA256
  zlib $ZLIB_VERSION (zlib licence)          $ZLIB_URL  SHA-256 $ZLIB_SHA256
  the mingw-w64 runtime and GCC's runtime libraries (permissive, with the GCC Runtime Library Exception)
FFmpeg is a trademark of Fabrice Bellard. https://ffmpeg.org
EOF
printf '%s' "$STAMP" > "$OUT/stamp.txt"
echo "build-ffmpeg-win: $OUT holds FFmpeg $FFMPEG_VERSION ($(du -sh "$OUT" | cut -f1))"

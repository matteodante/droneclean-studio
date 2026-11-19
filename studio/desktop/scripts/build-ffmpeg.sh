#!/bin/sh
# Builds the FFmpeg the desktop app ships (PLAN.md, "Before anything is published"): `ffmpeg` and `ffprobe`, static,
# into desktop/vendor/ffmpeg/, which electron-builder copies to the app's Resources/ffmpeg/ (the first place
# src/main/media/ffmpeg.ts looks). Until 19 Nov 2026 the packaged app used whatever FFmpeg was on PATH.
#
# macOS only for now (Windows, with NVENC and the others, is task 8.1). The Mac build links no external library:
# encoding goes through Apple's VideoToolbox (hevc_videotoolbox, h264_videotoolbox, prores_videotoolbox) and FFmpeg's
# own encoders (prores_ks, aac, pcm), which is what src/main/media/formats.ts asks for first on darwin; libx264 and
# libx265 there are only fallbacks. With no --enable-gpl and no external library the binaries are LGPL-2.1-or-later;
# vendor/ffmpeg/NOTICE.txt records the version, the source's address and checksum and the configure line, which is
# the source offer the licence asks for.
#
# Pinned: the version and checksum Homebrew's formula gives for the FFmpeg this Mac develops with. The download is
# checked against it, and a build whose stamp matches is not built again. Usage: sh scripts/build-ffmpeg.sh
set -eu
cd "$(dirname "$0")/.."

VERSION=9.0.2
URL="https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
MIN_MACOS=13.0

OUT=vendor/ffmpeg
WORK=vendor/build
CONFIGURE="--disable-shared --enable-static --disable-autodetect --enable-videotoolbox --enable-audiotoolbox \
--enable-zlib --disable-ffplay --disable-doc --disable-debug --disable-network \
--extra-cflags=-mmacosx-version-min=$MIN_MACOS --extra-ldflags=-mmacosx-version-min=$MIN_MACOS"
STAMP="$VERSION $SHA256 $CONFIGURE"

if [ "$(uname -s)" != "Darwin" ]; then
  # Packaging on another system goes on without it: only the mac section of electron-builder.yml copies vendor/ffmpeg
  echo "build-ffmpeg: this script builds the macOS binaries; Windows is task 8.1"
  exit 0
fi
if [ -x "$OUT/ffmpeg" ] && [ -x "$OUT/ffprobe" ] && [ "$(cat "$OUT/stamp.txt" 2>/dev/null)" = "$STAMP" ]; then
  echo "build-ffmpeg: $OUT is already FFmpeg $VERSION built this way"
  exit 0
fi

mkdir -p "$WORK"
TARBALL="$WORK/ffmpeg-$VERSION.tar.xz"
if [ ! -f "$TARBALL" ]; then
  curl --fail --location --silent --show-error --output "$TARBALL.part" "$URL"
  mv "$TARBALL.part" "$TARBALL"
fi
ACTUAL=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "build-ffmpeg: $TARBALL has checksum $ACTUAL, not $SHA256; refusing to build it" >&2
  rm -f "$TARBALL"
  exit 1
fi

SRC="$WORK/ffmpeg-$VERSION"
rm -rf "$SRC"
tar -xJf "$TARBALL" -C "$WORK"
PREFIX="$(pwd)/$WORK/install"
rm -rf "$PREFIX"
# shellcheck disable=SC2086
(cd "$SRC" && ./configure --prefix="$PREFIX" $CONFIGURE && make -j"$(sysctl -n hw.ncpu)" && make install)

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$PREFIX/bin/ffmpeg" "$PREFIX/bin/ffprobe" "$OUT/"
cp "$SRC/COPYING.LGPLv2.1" "$OUT/COPYING.LGPLv2.1"
cat > "$OUT/NOTICE.txt" <<EOF
FFmpeg $VERSION, built for DroneClean Studio from the official source:
  $URL
  SHA-256 $SHA256
configure $CONFIGURE
No external library is linked; the binaries are licensed LGPL-2.1-or-later (COPYING.LGPLv2.1).
FFmpeg is a trademark of Fabrice Bellard. https://ffmpeg.org
EOF
printf '%s' "$STAMP" > "$OUT/stamp.txt"
echo "build-ffmpeg: $OUT holds FFmpeg $VERSION ($(du -sh "$OUT" | cut -f1))"

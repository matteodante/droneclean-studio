#!/bin/sh
# Regenerates the tiny golden-frame videos. Do NOT run this casually: the
# committed files ARE the test input. A different FFmpeg or x264/x265 version
# produces different bytes, and with them different decoded pixels, which would
# look like a render regression. Re-run only when the inputs must change, then
# update the stored frames on purpose (see ../README.md) and commit both.
#
# Content (12 frames, 320x180, 24 fps, Rec.709 limited range, same picture in both files):
#   top half   a slow luma ramp around mid grey, 128 codes of 10-bit over the width (about 38 levels in 8-bit),
#              so 10-bit versus 8-bit shows as band width
#   bottom     eight flat colour blocks and a white box that moves 20 px right per frame,
#              so that decoding the wrong frame (one early or late) is a visible difference
#
# The shadow-piece pair (72 and 30 frames, 320x180, 24 fps) is the source and a cleaned
# piece for the shadow-piece-boundary case:
#   shadow-source  the same picture at a slower pace (the box moves 3 px per frame) and 3 s long
#   shadow-piece   a different picture on purpose (a blue-tinted staircase with a box moving
#                  10 px per frame), so a frame read from the wrong file is obvious
set -eu
cd "$(dirname "$0")"
SRC="color=c=black:s=320x180:r=24:d=0.5,format=yuv444p10le,geq=lum='if(lt(Y\,90)\,440+X*0.4\,if(between(X\,20+N*20\,44+N*20)*between(Y\,110\,150)\,900\,150+floor(X/40)*80))':cb='if(lt(Y\,90)\,512\,300+floor(X/40)*50)':cr='if(lt(Y\,90)\,512\,700-floor(X/40)*50)'"
TAGS="-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
# shellcheck disable=SC2086
ffmpeg -v error -y -f lavfi -i "$SRC" -c:v libx265 -pix_fmt yuv420p10le -tag:v hvc1 $TAGS \
  -x265-params "log-level=error:crf=14:keyint=12:frame-threads=1:pools=1:no-wpp=1" -threads 1 -an hevc-main10.mp4
# shellcheck disable=SC2086
ffmpeg -v error -y -f lavfi -i "$SRC" -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 14 -g 12 $TAGS \
  -threads 1 -an h264-high.mp4

# The source of the shadow case: the same picture, 72 frames, the white box 3 px per frame.
SHADOW_SRC="color=c=black:s=320x180:r=24:d=3,format=yuv444p10le,geq=lum='if(lt(Y\,90)\,440+X*0.4\,if(between(X\,20+N*3\,44+N*3)*between(Y\,110\,150)\,900\,150+floor(X/40)*80))':cb='if(lt(Y\,90)\,512\,300+floor(X/40)*50)':cr='if(lt(Y\,90)\,512\,700-floor(X/40)*50)'"
# shellcheck disable=SC2086
ffmpeg -v error -y -f lavfi -i "$SHADOW_SRC" -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 14 -g 12 $TAGS \
  -threads 1 -an shadow-source.mp4

# The cleaned piece of source frames 30 to 59: a different picture (blue-tinted staircase,
# a white box moving 10 px per frame in the upper part), 30 frames, same size and rate.
SHADOW_PIECE="color=c=black:s=320x180:r=24:d=1.25,format=yuv444p10le,geq=lum='if(between(X\,20+N*10\,60+N*10)*between(Y\,60\,100)\,900\,120+floor(X/20)*40)':cb='if(between(X\,20+N*10\,60+N*10)*between(Y\,60\,100)\,400\,760)':cr=512"
# shellcheck disable=SC2086
ffmpeg -v error -y -f lavfi -i "$SHADOW_PIECE" -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 14 -g 12 $TAGS \
  -threads 1 -an shadow-piece.mp4

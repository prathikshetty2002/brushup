#!/usr/bin/env bash
# Turns the raw captures in demo/out into the files the README uses, in docs/media.
#   node demo/capture-screenshots.mjs && node demo/record-demo.mjs && bash demo/make-media.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=docs/media
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/*.gif "$OUT"/*.mp4

# Screenshots: the wide ones at 1800px (still 2x on most screens), the panel close-ups as captured. Metadata stripped.
for name in hero notes-page; do
  magick "demo/out/shots/$name.png" -resize 1800x -strip -define png:compression-level=9 "$OUT/$name.png"
done
for name in style checks layers notes image changes; do
  magick "demo/out/shots/$name.png" -strip -define png:compression-level=9 "$OUT/$name.png"
done

# The full walkthrough, as is.
cp demo/out/brushup-demo.mp4 "$OUT/brushup-demo.mp4"

# A short looping highlight for the README (GitHub can't play a video in a README): select and retype, resize, then
# the Checks fix. The start and end times come from the captions the recording logs.
SEGMENTS="${SEGMENTS:-3.6-16.2 29.0-38.6}"
FILTER=""; N=0
for seg in $SEGMENTS; do
  s=${seg%-*}; e=${seg#*-}
  FILTER="${FILTER}[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${N}];"
  N=$((N+1))
done
CONCAT=""; for i in $(seq 0 $((N-1))); do CONCAT="${CONCAT}[v${i}]"; done
WIDTH="${GIF_WIDTH:-880}"; FPS="${GIF_FPS:-10}"
ffmpeg -y -loglevel error -i demo/out/brushup-demo.mp4 -filter_complex "${FILTER}${CONCAT}concat=n=${N}:v=1:a=0,fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" "$OUT/brushup-demo.gif"

ls -la "$OUT"

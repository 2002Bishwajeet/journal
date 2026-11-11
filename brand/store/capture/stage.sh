#!/bin/sh
# Copies the raw captures into the generator's screenshot folders (brand/store/README.md).
set -e
cd "$(dirname "$0")"
pub=../generator/public/screenshots
stage() { # <raw device> <theme per slide 01..06> <dest>
  src=$1; themes=$2; dest=$pub/$3/en
  mkdir -p "$dest"
  n=1
  for theme in $themes; do
    f=$(ls raw/$src/$theme/0$n-*.png)
    cp "$f" "$dest/0$n.png"
    n=$((n + 1))
  done
}
# Dark captures go on the dark (inverted) slides 2 and 4.
stage iphone "light dark light dark light light" apple/iphone
stage ipad "light dark light dark light light" apple/ipad
stage android "light dark light dark light light" android/phone

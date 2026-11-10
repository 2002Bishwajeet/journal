#!/usr/bin/env bash
# Installs the OS packages Playwright's browsers need (#868). The first run
# apt-installs them and keeps the .debs in ~/apt-archives (cached by the
# workflow); later runs install those .debs with dpkg and never touch the apt
# mirror, which has been slow or unreachable. A cached package is skipped when
# the runner already has that version or newer.
# Usage: playwright-deps.sh <browser>...
set -euo pipefail
archives=~/apt-archives

if compgen -G "$archives/*.deb" > /dev/null; then
  for deb in "$archives"/*.deb; do
    pkg=$(dpkg-deb -f "$deb" Package)
    have=$(dpkg-query -W -f='${Version}' "$pkg" 2>/dev/null || true)
    if [ -z "$have" ] || dpkg --compare-versions "$(dpkg-deb -f "$deb" Version)" gt "$have"; then
      echo "$deb"
    fi
  done | xargs -r sudo dpkg -i && missing=$(
    # A cache built on an older runner image can lack libraries the current
    # image dropped, so dpkg succeeds yet the browser still cannot launch.
    { find ~/.cache/ms-playwright -type f \( -perm -u+x -o -name '*.so*' \) -exec ldd {} + 2>/dev/null || true; } | { grep 'not found' || true; } | sort -u
  ) && [ -z "$missing" ] && exit 0
  echo "::warning::Cached .debs failed or left libraries missing (${missing:-none listed}); falling back to apt."
fi

npx playwright install-deps "$@"
mkdir -p "$archives"
cp /var/cache/apt/archives/*.deb "$archives"/

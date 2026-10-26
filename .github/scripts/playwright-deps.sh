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
  done | xargs -r sudo dpkg -i && exit 0
  echo "::warning::Installing the cached .debs failed; falling back to apt."
fi

npx playwright install-deps "$@"
mkdir -p "$archives"
cp /var/cache/apt/archives/*.deb "$archives"/

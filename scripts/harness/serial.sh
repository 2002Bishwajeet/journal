#!/bin/bash
# Usage: scripts/harness/serial.sh <command...>
# Runs a heavy command (build/test/lint/e2e/vitest) under a machine-wide lock so parallel
# agents never run two at once on a 16 GB machine. macOS has no flock, so: mkdir lock.
# Same path as ~/.claude/bin/heavy, so both scripts share one lock.
LOCK=/tmp/journal-heavy.lock
while ! mkdir "$LOCK" 2>/dev/null; do
  pid=$(cat "$LOCK/pid" 2>/dev/null)
  # Stale: holder died, or held for over 60 minutes.
  if { [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; } || [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    rm -rf "$LOCK"; continue
  fi
  [ -z "$waited" ] && echo "[serial] waiting for lock held by pid ${pid:-?}: $(cat "$LOCK/cmd" 2>/dev/null)" >&2
  waited=1; sleep 5
done
echo $$ > "$LOCK/pid"; echo "$*" > "$LOCK/cmd"
trap 'rm -rf "$LOCK"' EXIT INT TERM
"$@"

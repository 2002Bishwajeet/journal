# src-tauri

Native shell (Tauri v2) for desktop, iOS and Android. It serves `dist/` from
Rust on the fixed origin `http://localhost:47821`; see the comment on `PORT` in
`src/lib.rs` for why the port never changes.

## Port 47821 must be free

The app binds `127.0.0.1:47821` and `[::1]:47821` before it opens a window. If
either is taken, it shows "Journal can't start" and exits with code 1, in debug
and release builds alike. Whatever answers on that port would run inside
Journal's origin and could read the session token and local database.

In development, the iOS Simulator shares the host's loopback. So the desktop
app and a Simulator build can't run at the same time: the second one to start
now stops with that error instead of quietly serving from the first.

## iOS: `tauri ios build` fails with "Directory not empty"

A second `npm run tauri ios build` can fail with `Directory not empty` after
Xcode has already built the app: the CLI won't overwrite the output of the
previous build. Delete it first:

```bash
rm -rf src-tauri/gen/apple/build/arm64-sim/Journal.app src-tauri/gen/apple/journal_iOS.xcarchive
```

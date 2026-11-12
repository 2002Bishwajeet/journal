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

## With and without the premium code

Paid native features live in the private repo `journal-native-features`,
mounted as the optional submodule `native/`. A normal clone doesn't fetch it,
and every build below works the same without it:

- **Without it** (the public build): `build.rs` finds no `native/rust/mod.rs`,
  so `lib.rs` uses a no-op `premium::register`, `window.__JOURNAL_NATIVE__.plugins`
  is `[]`, `@premium` is `src/lib/premiumStub.ts`, and the Android and iOS
  projects get no premium module or targets.
- **With it** (`git submodule update --init native`, needs access to the private
  repo): `build.rs` sets `cfg(journal_premium)`, compiles `native/rust/mod.rs` as
  `mod premium`, and makes a `<plugin>:default` permission for each plugin in
  `native/rust/plugins.json`, which `lib.rs` grants to the main window. The web
  sees the plugin names in `window.__JOURNAL_NATIVE__.plugins`:
  `hasNativePlugin('premium')` is true and `invokeNative('premium', 'ping')`
  resolves to `"pong"` (`src/lib/native.ts`). `tauri dev`, `tauri build` and
  `tauri ios build` pick it up with no flag, since it's the same Cargo build.

On Android, `gen/android/settings.gradle` includes `:journal-premium` from
`native/android/premium` when that folder exists, and `app` depends on it then.
On iOS, `npm run tauri:ios:init` ends with `npm run native:ios:targets`, which
runs `native/scripts/apple-targets.rb` (needs `gem install xcodeproj`): it adds
the extension targets in `native/apple/targets.json` and the App Group
`group.id.biswa.journal` to the app. It's safe to run again, and without
`native/` it only prints a message.

Check both builds before a PR that touches either side: `npm run build` and
`cargo test` here, with `native/` checked out and with it moved aside. Public CI
always builds without it; the private repo's CI builds it inside journal.

## Desktop: build it yourself

```bash
npm ci
npm run tauri:build   # the installers for this OS, in src-tauri/target/release/bundle/
```

It needs Rust and, on Linux, WebKitGTK (`libwebkit2gtk-4.1-dev`; see
`.github/workflows/tauri.yml`). The app is named "Journal+" on desktop
(`tauri.macos.conf.json`, `tauri.windows.conf.json`, `tauri.linux.conf.json`),
because macOS ships its own Journal; `tauri.conf.json` keeps "Journal" for the
generated iOS and Android projects. A local build is unsigned and has no
updater bundles; it still checks for updates when it runs.

## Desktop releases and updates

`.github/workflows/desktop-release.yml` builds the signed and notarised
universal macOS `.dmg`, the Windows NSIS and `.msi` installers (not code-signed
yet) and the Linux AppImage and `.deb`, and attaches them to the app's
`v<version>` GitHub release with `SHA256SUMS.txt`. Manual Release runs it once
the repo variable `DESKTOP_RELEASES` is `true`; run it by hand with a tag to
rebuild one release.

The app checks `releases/latest/download/latest.json` at launch and daily
(`update_loop` in `src/lib.rs`), downloads the update, and installs it when
the user picks "Restart now". Updates are verified against `plugins.updater.pubkey`
in `tauri.conf.json`. The private key is `~/.journal-keys/tauri-updater.key` on
the owner's Mac (password in `tauri-updater.properties` next to it), and the
release build signs with it through `tauri.release.conf.json`. Losing that key
means installed apps can't update any more: keep a backup.

## iOS: `tauri ios build` fails with "Directory not empty"

A second `npm run tauri ios build` can fail with `Directory not empty` after
Xcode has already built the app: the CLI won't overwrite the output of the
previous build. Delete it first:

```bash
rm -rf src-tauri/gen/apple/build/arm64-sim/Journal.app src-tauri/gen/apple/journal_iOS.xcarchive
```

## iOS project and TestFlight

`gen/apple` is generated and git-ignored. The iOS-only files that must survive
a regeneration live in `ios/` at the paths they take inside `gen/apple`: the app
icon and launch-screen assets (`Assets.xcassets`), `LaunchScreen.storyboard`,
the privacy manifest (`journal_iOS/PrivacyInfo.xcprivacy`) and the entitlements
(`journal_iOS/journal_iOS.entitlements`: Associated Domains for Universal Links). Info.plist keys go
in `Info.plist` (shared with macOS) or `Info.ios.plist`.

```bash
npm run tauri:ios:init     # tauri ios init if needed, then copy ios/ in
npm run tauri:ios:release  # the above, then archive and upload to TestFlight
```

The release build number (`CFBundleVersion`) is the git commit count; the
version is package.json's. The upload uses the Apple account signed in to
Xcode, so run it from a logged-in macOS session: over plain ssh, codesign fails
with `errSecInternalComponent` because the login keychain is locked.
The icons and launch mark are generated by `scripts/generate-ios-assets.mjs`.

## Android and Play internal testing

`gen/android` is tracked (see `.gitignore`). The launcher icon (adaptive, with
a monochrome layer for themed icons), the Android 12+ splash icon and the Play
Store icon (`android/play-icon-512.png`) are generated by
`scripts/generate-android-assets.mjs`.

```bash
npm run tauri:android:release  # signed AAB for arm64 and armv7
```

The bundle lands in
`gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`.
Its versionCode is the git commit count and its versionName package.json's
version. It needs the Android SDK, NDK (`ANDROID_HOME`, `NDK_HOME`) and the
upload key: a properties file at `~/.journal-keys/journal-upload.properties`
(or the path in `JOURNAL_ANDROID_UPLOAD_KEY`) with `storeFile`, `password` and
`keyAlias`. Never commit the keystore or its password; without the file, the
release build is unsigned.

# src-tauri

Native shell (Tauri v2) for desktop, iOS and Android. It serves `dist/` from
Rust on a fixed `http://localhost` origin; see the comment on `PORT` in
`src/lib.rs` for why the port never changes and how it was chosen.

## Two fixed ports: release and development

| Build | Port | Origin |
| --- | --- | --- |
| Release and store workflows (`desktop-release.yml`; the iOS and Android CI of #1304) | `PROD_PORT` 23941 | `http://localhost:23941` |
| Every other build: `tauri dev`, a local `tauri build`, Simulator builds, `tauri:ios:release` and `tauri:android:release` run by hand | `DEV_PORT` 23942 | `http://localhost:23942` |

The workflows set `JOURNAL_RELEASE_BUILD=1` when they compile, and `lib.rs`
reads it with `option_env!`. To build with the release port on your machine
(for example to test an update over an installed app), set it yourself:
`JOURNAL_RELEASE_BUILD=1 npm run tauri:build`. A build with the other port has
another origin, so it has its own local database and its own sign-in.

The capabilities, `Info.plist` and the Android config list both origins, so one
static file serves both builds. Premium capabilities (`native/rust`) use
`crate::PORT`, the one origin of the build.

The app binds `127.0.0.1:PORT` and `[::1]:PORT` before it opens a window. If
either is taken, it shows "Journal can't start" and exits with code 1, in debug
and release builds alike. Whatever answers on that port would run inside
Journal's origin and could read the session token and local database. With
the two ports, that only happens when two builds of the same type run: two
development builds (the iOS Simulator shares the Mac's loopback, so a desktop
dev build and a Simulator build count as two), or a second copy of the
installed app.

The premium single-instance plugin (`native/rust/tray.rs`) is on in release
builds only: it keys on the app identifier, which both builds share, so in a
development build it would quit whichever of the two started second.

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
  `native/rust/plugins.txt`, which the plugin grants to the main window. The web
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

## Sign-in and external links

The app's web view never shows other sites (#1188). `src/lib/native.ts` routes them:

- External http(s) links and `window.open` open in an in-app browser on iOS
  (SFSafariViewController) and Android (Custom Tabs), through the local plugin
  in `plugins/browser`, and in the default browser on desktop (tauri-plugin-opener).
- Sign-in sends the identity's YouAuth page back to `journal://auth/finalize`.
  iOS runs it in an ASWebAuthenticationSession, which hands the callback back
  directly. Android (Custom Tabs) and macOS (default browser) get it as a deep
  link. Windows and Linux still sign in inside the web view: there a
  `journal://` link starts a second copy of the app, which can't bind the port.

## Desktop: build it yourself

```bash
npm ci
npm run tauri:build   # the installers for this OS, in src-tauri/target/release/bundle/
```

It needs Rust and, on Linux, WebKitGTK (`libwebkit2gtk-4.1-dev`; see
`.github/workflows/tauri.yml`). The app is named "Journal" on desktop and inside the iOS and Android apps; only their
home-screen names (`Info.ios.plist`, Android `strings.xml`) are "Journal+", because "Journal" is
taken on the App Store (ITMS-90129). A local build is unsigned and has no
updater bundles; it still checks for updates when it runs.

The desktop icons (`icons/`: `.icns`, `.ico` and the PNGs) are generated with
`tauri icon` by `scripts/generate-desktop-icons.mjs` from the same feather as
the iOS and Android icons; its header has the command.

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

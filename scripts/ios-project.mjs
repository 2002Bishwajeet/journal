#!/usr/bin/env node
// Applies src-tauri/ios/ (app icon, launch screen, privacy manifest,
// entitlements) to the generated Xcode project. src-tauri/gen/apple is
// git-ignored and recreated by `tauri ios init`, so run this after every init:
// `npm run tauri:ios:init`.
//
// --release then archives, signs and uploads a build to TestFlight through the
// Apple account signed in to Xcode (`npm run tauri:ios:release`, on a Mac).
// Its CFBundleVersion is the git commit count, so each build from main is
// higher than the last; the marketing version is package.json's.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';

const GEN = 'src-tauri/gen/apple';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

if (!existsSync(GEN)) run('npx', ['tauri', 'ios', 'init', '--ci']);
// Replace Tauri's placeholder icon set rather than merge into it.
rmSync(`${GEN}/Assets.xcassets/AppIcon.appiconset`, { recursive: true, force: true });
cpSync('src-tauri/ios', GEN, { recursive: true });
// Re-run XcodeGen so the project picks up the copied PrivacyInfo.xcprivacy.
run('xcodegen', ['generate', '--spec', `${GEN}/project.yml`]);

if (process.argv.includes('--release')) {
  const build = execFileSync('git', ['rev-list', '--count', 'HEAD']).toString().trim();
  // `tauri ios build` adds method and teamID; destination=upload makes the
  // export send the build to App Store Connect instead of writing an IPA.
  writeFileSync(
    `${GEN}/ExportOptions.plist`,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>upload</string>
</dict>
</plist>
`,
  );
  run('npx', [
    'tauri', 'ios', 'build',
    '--export-method', 'app-store-connect',
    '--config', JSON.stringify({ bundle: { iOS: { bundleVersion: build } } }),
  ]);
}

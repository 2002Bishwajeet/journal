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
// ios-release.yml (#1304) sets both through JOURNAL_IOS_BUILD_NUMBER and
// JOURNAL_IOS_VERSION, and adds --no-sign for a dry run (build only, no upload).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { checkEntitlements } from './ios-entitlements.mjs';

const GEN = 'src-tauri/gen/apple';
const ENTITLEMENTS = 'journal_iOS/journal_iOS.entitlements';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

if (!existsSync(GEN)) run('npx', ['tauri', 'ios', 'init', '--ci']);
// Replace Tauri's placeholder icon set rather than merge into it.
rmSync(`${GEN}/Assets.xcassets/AppIcon.appiconset`, { recursive: true, force: true });
cpSync('src-tauri/ios', GEN, { recursive: true });
// Re-run XcodeGen so the project picks up the copied PrivacyInfo.xcprivacy.
run('xcodegen', ['generate', '--spec', `${GEN}/project.yml`]);
// XcodeGen rewrites the entitlements file from project.yml, which Tauri's
// template leaves empty: copy ours back, or Universal Links are gone (#1326).
cpSync(`src-tauri/ios/${ENTITLEMENTS}`, `${GEN}/${ENTITLEMENTS}`);
// XcodeGen just dropped any premium extension targets: add them back.
// The targets script adds its App Group to the entitlements above.
run('npm', ['run', 'native:ios:targets']);
checkEntitlements(`${GEN}/${ENTITLEMENTS}`);

if (process.argv.includes('--release')) {
  const build =
    process.env.JOURNAL_IOS_BUILD_NUMBER || execFileSync('git', ['rev-list', '--count', 'HEAD']).toString().trim();
  const version = process.env.JOURNAL_IOS_VERSION;
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
    '--config', JSON.stringify({ ...(version && { version }), bundle: { iOS: { bundleVersion: build } } }),
    ...(process.argv.includes('--no-sign') ? ['--no-sign'] : []),
  ]);
}

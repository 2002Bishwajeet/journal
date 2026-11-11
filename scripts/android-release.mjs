#!/usr/bin/env node
// Builds the signed Play Store bundle (`npm run tauri:android:release`, on a
// machine with the Android SDK, NDK and the upload key; see src-tauri/README.md).
// versionCode is the git commit count, like the iOS build number, so each build
// from main is higher than the last; versionName is package.json's.
import { execFileSync } from 'node:child_process';

const versionCode = Number(execFileSync('git', ['rev-list', '--count', 'HEAD']).toString().trim());
execFileSync(
  'npx',
  [
    'tauri', 'android', 'build', '--aab',
    '--target', 'aarch64', 'armv7',
    '--config', JSON.stringify({ bundle: { android: { versionCode } } }),
  ],
  { stdio: 'inherit' },
);

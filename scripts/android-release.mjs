#!/usr/bin/env node
// Builds the signed Play Store bundle (`npm run tauri:android:release`, on a
// machine with the Android SDK, NDK and the upload key; see src-tauri/README.md).
// versionCode is the git commit count, like the iOS build number, so each build
// from main is higher than the last; versionName is package.json's.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkBillingMetaData } from './android-billing-check.mjs';

// #1340: the checked-in label is "Journal Dev" so a local build can't pass for the store app.
// Only the release workflow (JOURNAL_RELEASE_BUILD=1) builds with the real name.
if (process.env.JOURNAL_RELEASE_BUILD === '1') {
  const strings = 'src-tauri/gen/android/app/src/main/res/values/strings.xml';
  writeFileSync(strings, readFileSync(strings, 'utf8').replaceAll('Journal Dev', 'Journal+'));
}

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

// #1175: with native/ the bundle sells through Play, which warns without the billing version meta-data.
if (existsSync('native/android/premium')) checkBillingMetaData('src-tauri/gen/android/app');

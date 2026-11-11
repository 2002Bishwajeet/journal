#!/usr/bin/env node
// Manual Release: write package.json's version into the native shell (src-tauri),
// so the desktop and mobile apps never ship with a version of their own.
// src/__tests__/nativeVersion.test.ts fails any PR where they differ.
// Usage: node scripts/native-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CRATE = /^(name = "journal"\r?\nversion = ")([^"]+)/m;

/** Each native file that holds the app version, and where in it. */
export const NATIVE_VERSION_FILES = {
  'src-tauri/tauri.conf.json': /^( {2}"version": ")([^"]+)/m,
  'src-tauri/Cargo.toml': CRATE,
  'src-tauri/Cargo.lock': CRATE,
};

export const readVersion = (text, pattern) => pattern.exec(text)?.[2];

export const writeVersion = (text, pattern, version) => text.replace(pattern, `$1${version}`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const [file, pattern] of Object.entries(NATIVE_VERSION_FILES)) {
    writeFileSync(file, writeVersion(readFileSync(file, 'utf8'), pattern, version));
  }
}

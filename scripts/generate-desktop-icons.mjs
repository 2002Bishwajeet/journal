/**
 * Generates the desktop icons in src-tauri/icons/ (icon.icns, icon.ico and the
 * Linux/Tauri PNGs) with `tauri icon`, from the same feather and cream tile as the
 * iOS and Android icons (scripts/generate-ios-assets.mjs,
 * scripts/generate-android-assets.mjs).
 *
 * Source: the feather from site/public/favicon.svg on a rounded cream tile, 824 px
 * inside a transparent 1024 px canvas (the macOS icon grid; Windows and Linux
 * show the tile the same way). `tauri icon` also writes iOS, Android and Windows
 * Store icons; they go to a temp dir that is discarded, so the iOS and Android
 * icons keep coming from their own scripts.
 *
 * Not a dependency. Re-run (Node 20+) from the repo root:
 *   npm i --prefix /tmp/desktop-sharp sharp && NODE_PATH=/tmp/desktop-sharp/node_modules node scripts/generate-desktop-icons.mjs
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [process.env.NODE_PATH ?? '.'] }));

const OUT = 'src-tauri/icons';
const FILES = ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.icns', 'icon.ico'];
const feather = fs.readFileSync('site/public/favicon.svg', 'utf8').match(/<path[^>]*\/>/)[0];

const TILE = 824;
const MARGIN = (1024 - TILE) / 2;
// The iOS icon draws the 64-unit feather 600 px wide on 1024; keep that ratio on the tile.
const SCALE = (600 * (TILE / 1024)) / 64;
const OFFSET = 512 - 32 * SCALE;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FAF8F1"/><stop offset="1" stop-color="#F2ECDC"/></linearGradient></defs>
  <rect x="${MARGIN}" y="${MARGIN}" width="${TILE}" height="${TILE}" rx="185" fill="url(#g)"/>
  <g fill="#67665E" transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})">${feather}</g>
</svg>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-icons-'));
try {
  const source = path.join(tmp, 'app-icon.png');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(source);
  execFileSync('npx', ['tauri', 'icon', source, '-o', path.join(tmp, 'out')], { stdio: 'inherit' });
  for (const file of FILES) fs.copyFileSync(path.join(tmp, 'out', file), path.join(OUT, file));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

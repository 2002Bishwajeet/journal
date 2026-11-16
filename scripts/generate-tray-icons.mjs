/**
 * Generates the macOS menu bar icon (#1331) from src-tauri/icons/tray/tray-template.svg
 * (the brand quill path from brand/logo/mark-dark.svg, without its fill):
 * transparent PNGs, black plus alpha only, at 1x (18 px) and 2x (36 px). The tray
 * code (native/rust/tray.rs) shows them as a template image, so macOS tints them for
 * light and dark menu bars and the highlighted state.
 *
 * Not a dependency. Re-run (Node 20+) from the repo root:
 *   npm i --prefix /tmp/desktop-sharp sharp && NODE_PATH=/tmp/desktop-sharp/node_modules node scripts/generate-tray-icons.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [process.env.NODE_PATH ?? '.'] }));

const DIR = 'src-tauri/icons/tray';
const svg = fs.readFileSync(`${DIR}/tray-template.svg`);

for (const [file, size] of [
  ['tray-template.png', 18],
  ['tray-template@2x.png', 36],
]) {
  // The SVG is 64 units wide; this density renders it at `size` px. Keep only its
  // alpha and put it on pure black, so no grey edge pixels end up in the colour channels.
  const alpha = await sharp(svg, { density: (72 * size) / 64 })
    .resize(size, size)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: '#000' } })
    .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(`${DIR}/${file}`);
}

/**
 * Generates the iOS app icon (light, dark, tinted) and the launch-screen mark in
 * src-tauri/ios/Assets.xcassets/. scripts/ios-project.mjs copies that catalog
 * into the generated Xcode project.
 *
 * Icon: the feather from site/public/favicon.svg on the PWA icon's cream tile,
 * full bleed (iOS applies its own corner mask). Dark and tinted use the
 * favicon's dark-mode colour on the app's dark background.
 * Launch mark: src/assets/logo_withoutbg.png at 128 pt, as on the PWA splash.
 *
 * Not a dependency. Re-run (Node 20+) from the repo root:
 *   npm i --prefix /tmp/ios-sharp sharp && NODE_PATH=/tmp/ios-sharp/node_modules node scripts/generate-ios-assets.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [process.env.NODE_PATH ?? '.'] }));

const OUT = 'src-tauri/ios/Assets.xcassets';
const feather = fs.readFileSync('site/public/favicon.svg', 'utf8').match(/<path[^>]*\/>/)[0];

const icon = (background, fill) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${background}</linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <g fill="${fill}" transform="translate(212 212) scale(9.375)">${feather}</g>
</svg>`);

const ICONS = {
  'icon.png': icon('<stop offset="0" stop-color="#FAF8F1"/><stop offset="1" stop-color="#F2ECDC"/>', '#67665E'),
  'icon-dark.png': icon('<stop offset="0" stop-color="#1C1B1A"/>', '#E6E4DD'),
  'icon-tinted.png': icon('<stop offset="0" stop-color="#000000"/>', '#E6E4DD'),
};
for (const [file, svg] of Object.entries(ICONS)) {
  await sharp(svg).flatten().png({ compressionLevel: 9 }).toFile(`${OUT}/AppIcon.appiconset/${file}`);
}

for (const scale of [1, 2, 3]) {
  const suffix = scale === 1 ? '' : `@${scale}x`;
  await sharp('src/assets/logo_withoutbg.png')
    .resize(128 * scale, 128 * scale, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/LaunchMark.imageset/launch-mark${suffix}.png`);
}

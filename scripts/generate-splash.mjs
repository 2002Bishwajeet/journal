/**
 * Generates the iOS launch images in public/splash/ and prints the matching
 * <link rel="apple-touch-startup-image"> tags for index.html.
 *
 * Each image is the theme background with src/assets/logo_withoutbg.png centred
 * like SplashScreen.tsx: 128 CSS px square, its centre 56 CSS px above the
 * screen centre (the logo sits at the top of a 240 px column that is centred).
 * No text, so the hand-off to the JS splash does not jump.
 *
 * Not a dependency. Re-run (Node 20+) from the repo root:
 *   npm i --prefix /tmp/splash-sharp sharp && NODE_PATH=/tmp/splash-sharp/node_modules node scripts/generate-splash.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [process.env.NODE_PATH ?? '.'] }));

const THEMES = { light: '#FDFCF8', dark: '#1C1B1A' };
const LOGO_CSS = 128;
const LOGO_RISE_CSS = 56;
// [name, portrait CSS width, portrait CSS height, pixel ratio]
const DEVICES = [
  ['iphone-16-pro-max', 440, 956, 3],
  ['iphone-16-pro', 402, 874, 3],
  ['iphone-16-plus-15-plus-14-pro-max', 430, 932, 3],
  ['iphone-16-15-14-pro', 393, 852, 3],
  ['iphone-14-plus-13-pro-max-12-pro-max', 428, 926, 3],
  ['iphone-14-13-12', 390, 844, 3],
  ['iphone-13-mini-12-mini', 375, 812, 3],
  ['iphone-se-3', 375, 667, 2],
  ['ipad-pro-13', 1032, 1376, 2],
  ['ipad-pro-11', 834, 1210, 2],
  ['ipad-air-13', 1024, 1366, 2],
  ['ipad-air-11-ipad-10', 820, 1180, 2],
  ['ipad-mini-7', 744, 1133, 2],
];

fs.mkdirSync('public/splash', { recursive: true });
const logoCache = new Map();
const logo = async (px) => {
  if (!logoCache.has(px)) {
    logoCache.set(
      px,
      await sharp('src/assets/logo_withoutbg.png')
        .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    );
  }
  return logoCache.get(px);
};

const links = [];
for (const theme of Object.keys(THEMES)) {
  for (const [name, w, h, dpr] of DEVICES) {
    for (const orientation of ['portrait', 'landscape']) {
      const [cw, ch] = orientation === 'portrait' ? [w, h] : [h, w];
      const [pw, ph] = [cw * dpr, ch * dpr];
      const size = LOGO_CSS * dpr;
      const file = `${name}-${orientation}-${theme}.png`;
      await sharp({ create: { width: pw, height: ph, channels: 4, background: THEMES[theme] } })
        .composite([
          {
            input: await logo(size),
            left: Math.round((pw - size) / 2),
            top: Math.round(ph / 2 - LOGO_RISE_CSS * dpr - size / 2),
          },
        ])
        .flatten({ background: THEMES[theme] })
        .png({ compressionLevel: 9, palette: true })
        .toFile(`public/splash/${file}`);
      links.push(
        `    <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation}) and (prefers-color-scheme: ${theme})" href="/splash/${file}" />`,
      );
    }
  }
}
console.log(links.join('\n'));

// Renders every PNG/ICO in brand/png from the SVGs and HTML templates.
// Run from the repo root (needs Playwright, already a dev dependency): node brand/render.mjs
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const out = `${dir}png/`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(url, width, height, file, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + file, omitBackground: transparent });
}

async function svg(name, width, height, file, transparent = true) {
  const markup = readFileSync(`${dir}logo/${name}`, 'utf8');
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${markup}`,
  );
  await page.screenshot({ path: out + file, omitBackground: transparent });
}

for (const t of ['light', 'dark']) {
  await svg(`mark-${t}.svg`, 512, 512, `mark-${t}.png`);
  await svg(`wordmark-${t}.svg`, 1236, 384, `wordmark-${t}.png`);
}
for (const size of [1024, 512, 192, 180]) await svg('app-icon.svg', size, size, `app-icon-${size}.png`, false);
for (const size of [16, 32, 48]) await svg('mark-light.svg', size, size, `favicon-${size}.png`);

const tpl = `file://${dir}templates/`;
await shot(`${tpl}board.html`, 1920, 1440, 'board.png');
await shot(`${tpl}social-card.html`, 1200, 630, 'social-card-light.png');
await shot(`${tpl}social-card.html?theme=dark&kicker=Agents&title=${encodeURIComponent('Agents build live, interactive pages inside your notes.')}`, 1200, 630, 'social-card-dark.png');
await shot(`${tpl}screenshot-frame.html`, 1600, 1000, 'screenshot-frame-example.png');
await browser.close();

// favicon.ico with PNG payloads (supported by every current browser).
const pngs = [16, 32, 48].map((s) => [s, readFileSync(`${out}favicon-${s}.png`)]);
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach(([s, png], i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync(`${out}favicon.ico`, Buffer.concat([header, ...pngs.map(([, png]) => png)]));
console.log('rendered to', out);

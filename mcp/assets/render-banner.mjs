// Renders banner.svg to banner.png (1280×640) in Chromium, with the site's fonts from @fontsource-variable.
// Run from the repo root: node mcp/assets/render-banner.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const font = (pkg, file) => `url(data:font/woff2;base64,${readFileSync(`node_modules/@fontsource-variable/${pkg}/files/${file}`).toString('base64')})`;
const css = `
@font-face { font-family: 'Playfair Display Variable'; font-weight: 400 900; src: ${font('playfair-display', 'playfair-display-latin-wght-normal.woff2')}; }
@font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: ${font('inter', 'inter-latin-wght-normal.woff2')}; }
body { margin: 0; }`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.setContent(`<style>${css}</style>${readFileSync('mcp/assets/banner.svg', 'utf8')}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'mcp/assets/banner.png' });
await browser.close();

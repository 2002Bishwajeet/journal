/**
 * Puts the landing site's screenshots (site/public/media/) into Apple's device bezels: phone shots in the
 * iPhone 18 Pro Max (*-iphone-{light,dark}.webp), desktop shots and the hero video in the 14-inch MacBook Pro M5
 * (*-mac-{light,dark}.webp, hero-mac-*.mp4). Silver for light, black for dark.
 *
 * The bezels are Apple Design Resources (https://developer.apple.com/design/resources/), used under that
 * license. They are never committed: only the flattened composites this writes go in the repo. Point
 * APPLE_BEZEL_DIR at the folder holding the two downloads, then run (needs ImageMagick and ffmpeg):
 *
 *   APPLE_BEZEL_DIR=~/agent-work/apple-bezels npx vite-node scripts/device-frames.ts
 */
import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DIR = process.env.APPLE_BEZEL_DIR;
if (!DIR) throw new Error('Set APPLE_BEZEL_DIR to the folder with the Apple bezel downloads (iPhone-18-PNG, MacBook-Pro-M5).');

const MEDIA = 'site/public/media';
const WORK = mkdtempSync(path.join(tmpdir(), 'device-frames-'));
// Composites are written at 60% of the bezel's own size: still past 2x where the site shows them.
const SCALE = 0.6;

type Theme = 'light' | 'dark';
const PAGE_BG: Record<Theme, string> = { light: '#FDFCF8', dark: '#1C1B1A' }; // --bg in site/src/styles.css

const PHONE = {
  bezel: (theme: Theme) => path.join(DIR, 'iPhone-18-PNG/iPhone 18 Pro Max', `iPhone 18 Pro Max - ${theme === 'light' ? 'Silver' : 'Black'} - Portrait.png`),
  size: { width: 1470, height: 3000 },
  screen: { x: 75, y: 66, width: 1320, height: 2868 }, // 440 × 956 points at 3x
};
const MAC = {
  bezel: (theme: Theme) => path.join(DIR, 'MacBook-Pro-M5/Bezel-MacBook-Pro-M5/PNG', `MacBook Pro M5 14-inch ${theme === 'light' ? 'Silver' : 'Space Black'}.png`),
  size: { width: 3860, height: 2540 },
  // The screen's corners are under the bezel, so the bezel drawn over a capture is its mask. The top 64px,
  // beside the notch, is the menu bar's row: black, as macOS shows it for an app scaled to fit below the camera.
  screen: { x: 418, y: 352, width: 3024, height: 1900 },
  menuBar: 64,
};

const out = (name: string, theme: Theme, device: string) => `${MEDIA}/${name}-${device}-${theme}`;
/** The capture's bottom-left pixel: the paper a capture shorter than its screen is laid on. */
const paper = (file: string) => `#${execFileSync('magick', [file, '-flip', '-format', '%[hex:p{0,0}]', 'info:']).toString().trim().slice(0, 6)}`;
const dataUrl = (file: string, type: string) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

// ---- MacBook: ffmpeg lays the capture under the bezel, top-aligned and fitted to the screen ----

/** The capture fitted to the screen, the bezel over it, on `canvas` (transparent for a still, page paper for the video). */
function macGraph(capture: string, canvas: string): string {
  const { x, y, width, height } = MAC.screen;
  const fill = paper(capture).replace('#', '0x');
  return [
    `color=c=${canvas}:s=${MAC.size.width}x${MAC.size.height}:r=30,format=rgba,drawbox=x=${x}:y=${y - MAC.menuBar}:w=${width}:h=${MAC.menuBar}:color=black:t=fill[bg]`,
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:0:color=${fill}[screen]`,
    `[bg][screen]overlay=${x}:${y}:shortest=1[shot]`,
    `[shot][1:v]overlay=0:0,scale=${Math.round(MAC.size.width * SCALE)}:-2:flags=lanczos`,
  ].join(';');
}

function macStill(name: string, theme: Theme): void {
  const capture = `${MEDIA}/${name}-${theme}.webp`;
  const png = path.join(WORK, `${name}-${theme}.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', capture, '-i', MAC.bezel(theme),
    '-filter_complex', macGraph(capture, 'black@0'), '-frames:v', '1', png]);
  // ImageMagick's WebP keeps the outside fully transparent; ffmpeg's leaves it at 1/255.
  execFileSync('magick', [png, '-quality', '84', `${out(name, theme, 'mac')}.webp`]);
}

/** The hero video: an mp4 has no transparency, so it sits on the page's paper; its poster is its first frame. */
function macVideo(theme: Theme): void {
  const graph = macGraph(`${MEDIA}/hero-poster-${theme}.webp`, PAGE_BG[theme].replace('#', '0x'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${MEDIA}/hero-${theme}.mp4`, '-i', MAC.bezel(theme),
    '-filter_complex', graph, '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', `${out('hero', theme, 'mac')}.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${MEDIA}/hero-mac-${theme}.mp4`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '86', `${out('hero-poster', theme, 'mac')}.webp`]);
}

// ---- iPhone: Chromium draws the status bar over the capture, masked to the screen under the bezel ----

/** The screen's shape: the bezel's see-through pixels joined to its middle (not the outside, nor the camera's glint). */
function phoneMask(theme: Theme): string {
  const file = path.join(WORK, `phone-mask-${theme}.png`);
  const { width, height } = PHONE.size;
  execFileSync('magick', [PHONE.bezel(theme), '-alpha', 'extract', '-threshold', '99%',
    '-fill', 'red', '-draw', `color ${width / 2},${height / 2} floodfill`,
    '-fill', 'black', '+opaque', 'red', '-fill', 'white', '-opaque', 'red', '-alpha', 'copy', file]);
  return file;
}

// iOS's status bar at 9:41: signal, Wi-Fi and a full battery.
const STATUS_BAR = `<div class="phone-status" aria-hidden="true">
  <span>9:41</span>
  <span class="phone-status-icons">
    <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
    <svg viewBox="0 0 16 12"><path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.3-1.4A10.6 10.6 0 0 0 8 .6C5.2.6 2.6 1.7.7 3.6L2 5c1.6-1.5 3.7-2.4 6-2.4Zm0 3.7c1.3 0 2.5.5 3.4 1.3l1.3-1.4A7 7 0 0 0 8 4.3a7 7 0 0 0-4.7 1.9l1.3 1.4c.9-.8 2.1-1.3 3.4-1.3Zm0 3.6c.4 0 .8.1 1.1.4L8 11.4 6.9 10.3c.3-.3.7-.4 1.1-.4Z"/></svg>
    <svg viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" stroke-opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2.5"/><path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fill-opacity="0.4"/></svg>
  </span>
</div>`;
const INTER = dataUrl('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'font/woff2');

async function phoneStill(page: Page, name: string, theme: Theme): Promise<void> {
  const capture = `${MEDIA}/${name}-${theme}.webp`;
  const { screen, size } = PHONE;
  // Sizes inside the screen are in cqw of its width, from iOS points (440pt wide).
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: Inter; src: url(${INTER}) format('woff2'); font-weight: 100 900; }
    body { margin: 0; }
    .device { position: relative; width: ${size.width}px; height: ${size.height}px; }
    .device > img { position: absolute; inset: 0; }
    .mask { position: absolute; inset: 0; mask: url(${dataUrl(phoneMask(theme), 'image/png')}) 0 0 / 100% 100%; }
    .screen {
      position: absolute; left: ${screen.x}px; top: ${screen.y}px; width: ${screen.width}px; height: ${screen.height}px;
      overflow: hidden; container-type: inline-size; background: ${paper(capture)};
      color: ${theme === 'light' ? '#000' : '#fff'}; font-family: Inter;
    }
    .screen > img { display: block; width: 100%; }
    .screen::after { content: ''; position: absolute; inset-inline: 0; margin-inline: auto; bottom: 2cqw; width: 34cqw; height: 1.3cqw; border-radius: 1cqw; background: currentColor; }
    .phone-status { display: grid; grid-template-columns: 1fr 32cqw 1fr; align-items: center; height: 13.7cqw; padding-top: 0.6cqw; font-size: 4.3cqw; font-weight: 620; letter-spacing: -0.01em; text-align: center; }
    .phone-status-icons { grid-column: 3; display: flex; justify-content: center; align-items: center; gap: 1.4cqw; }
    .phone-status-icons svg { height: 3.1cqw; width: auto; fill: currentColor; }
    .phone-status-icons svg:last-child { height: 3.3cqw; }
  </style><div class="device"><div class="mask"><div class="screen">${STATUS_BAR}<img src="${dataUrl(capture, 'image/webp')}"></div></div><img src="${dataUrl(PHONE.bezel(theme), 'image/png')}"></div>`);
  await page.evaluate(() => document.fonts.ready);
  const png = path.join(WORK, `${name}-${theme}.png`);
  await page.locator('.device').screenshot({ path: png, omitBackground: true });
  execFileSync('magick', [png, '-resize', `${SCALE * 100}%`, '-quality', '84', `${out(name, theme, 'iphone')}.webp`]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: PHONE.size });
  for (const theme of ['light', 'dark'] as const) {
    for (const name of ['phone-live-block', 'phone-note']) await phoneStill(page, name, theme);
    for (const name of ['feature-blocks', 'public-page', 'agent-result']) macStill(name, theme);
    macVideo(theme);
  }
} finally {
  await browser.close();
  rmSync(WORK, { recursive: true, force: true });
}

// Does iOS honour `prefers-color-scheme` on apple-touch-startup-image (#854)? CI only,
// after safari-check.ts (.github/workflows/ios-safari.yml). Serves a test page with
// index.html's own iPhone 15 portrait launch-image media queries, pointing at a red
// (light) and a blue (dark) image, and a head script that blocks the first paint so the
// launch image stays up. Adds it to the Home Screen in dark mode, launches it in dark,
// then in light, and samples the screen each time. Reports; never fails the job.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import { remote } from 'webdriverio';

const UDID = process.env.IOS_UDID!;
const PORT = 4174;
const OUT = 'test-results/ios-safari';
const NAME = 'LaunchTest';
mkdirSync(OUT, { recursive: true });

/** A solid-colour RGB PNG. */
function png(w: number, h: number, [r, g, b]: number[]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// index.html's own tags for the iPhone 15 (393×852 @3x) in portrait.
const tags = readFileSync('index.html', 'utf8')
  .split('\n')
  .filter((l) => l.includes('apple-touch-startup-image') && l.includes('device-width: 393px') && l.includes('portrait'));
const media = (scheme: string) => tags.find((l) => l.includes(`prefers-color-scheme: ${scheme}`))?.match(/media="([^"]+)"/)?.[1];
const [lightMedia, darkMedia] = [media('light'), media('dark')];
const files: Record<string, [string, Buffer]> = {
  '/red.png': ['image/png', png(1179, 2556, [255, 0, 0])],
  '/blue.png': ['image/png', png(1179, 2556, [0, 0, 255])],
  '/': [
    'text/html',
    Buffer.from(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><title>${NAME}</title>
${lightMedia ? `<link rel="apple-touch-startup-image" media="${lightMedia}" href="/red.png">` : ''}
${darkMedia ? `<link rel="apple-touch-startup-image" media="${darkMedia}" href="/blue.png">` : ''}
<script>if (navigator.standalone) { const t = Date.now() + 8000; while (Date.now() < t); }</script>
</head><body style="background:#0f0">page</body></html>`),
  ],
};
const server = createServer((req, res) => {
  const f = files[req.url ?? ''];
  console.log(`${req.method} ${req.url} ${f ? 200 : 404}`);
  res.writeHead(f ? 200 : 404, { 'content-type': f?.[0] ?? 'text/plain', 'cache-control': 'no-store' }).end(f?.[1]);
}).listen(PORT, '127.0.0.1');

const simctl = (...args: string[]) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });

/** Centre pixel of a simulator screenshot (BMP, so no decoder is needed). */
function sample(file: string) {
  simctl('io', UDID, 'screenshot', '--type=bmp', `${OUT}/${file}.bmp`);
  simctl('io', UDID, 'screenshot', `${OUT}/${file}.png`);
  const bmp = readFileSync(`${OUT}/${file}.bmp`);
  const [offset, w, h, bpp] = [bmp.readUInt32LE(10), bmp.readInt32LE(18), bmp.readInt32LE(22), bmp.readUInt16LE(28)];
  const i = offset + (Math.floor(Math.abs(h) / 2) * (Math.floor((w * bpp) / 8 + 3) & ~3)) + Math.floor(w / 2) * (bpp / 8);
  const [b, g, r] = bmp.subarray(i, i + 3);
  return r > 200 && g < 60 && b < 60 ? 'red (light image)' : b > 200 && r < 60 && g < 60 ? 'blue (dark image)' : g > 200 && r < 60 && b < 60 ? 'green (page painted)' : `other rgb(${r},${g},${b})`;
}

const results: string[] = [];
const browser = await remote({
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  logLevel: 'warn',
  connectionRetryTimeout: 240_000,
  connectionRetryCount: 1,
  capabilities: {
    platformName: 'iOS',
    browserName: 'Safari',
    'appium:automationName': 'XCUITest',
    'appium:udid': UDID,
    ...(process.env.WDA_DERIVED_DATA && { 'appium:usePrebuiltWDA': true, 'appium:derivedDataPath': process.env.WDA_DERIVED_DATA }),
    'appium:wdaLaunchTimeout': 240_000,
    'appium:wdaConnectionTimeout': 240_000,
    'appium:newCommandTimeout': 300,
  },
});
// The first match: the share sheet has a cell and a label for "Add to Home Screen".
async function tapFirst(predicate: string) {
  const find = () => browser.$$(`-ios predicate string:${predicate}`);
  await browser.waitUntil(async () => (await find()).length > 0, { timeout: 30_000, timeoutMsg: `timed out waiting for ${predicate}` });
  await (await find())[0].click();
}

try {
  if (!lightMedia || !darkMedia) throw new Error('index.html has no light and dark iPhone 15 portrait launch images');
  simctl('ui', UDID, 'appearance', 'dark');
  await browser.url(`http://127.0.0.1:${PORT}/`);
  await browser.switchContext('NATIVE_APP');
  await tapFirst('name == "ShareButton" OR label == "Share"');
  await tapFirst('label == "Add to Home Screen"');
  await tapFirst('type == "XCUIElementTypeButton" AND label == "Add"');
  await browser.pause(3_000);

  let webApp = '';
  for (const appearance of ['dark', 'light']) {
    simctl('ui', UDID, 'appearance', appearance);
    if (webApp) await browser.execute('mobile: terminateApp', { bundleId: webApp });
    await browser.execute('mobile: activateApp', { bundleId: 'com.apple.springboard' });
    // The new icon can be on a later Home Screen page.
    const icon = `type == "XCUIElementTypeIcon" AND label == "${NAME}"`;
    for (let i = 0; i < 3 && !(await browser.$(`-ios predicate string:${icon}`).isDisplayed().catch(() => false)); i++) {
      await browser.execute('mobile: swipe', { direction: 'left' });
    }
    await tapFirst(icon);
    await browser.pause(1_500);
    const shot = sample(`launch-${appearance}`);
    webApp ||= ((await browser.execute('mobile: activeAppInfo')) as { bundleId: string }).bundleId;
    results.push(`| launch in ${appearance} (added in dark) | launch-${appearance}.png | ${shot} |`);
    console.log(`launch in ${appearance}: ${shot} (web app ${webApp})`);
  }
} catch (error) {
  results.push(`| error | | ${(error as Error).message.split('\n')[0]} |`);
  console.log(`::warning::launch image check: ${(error as Error).message}`);
  simctl('io', UDID, 'screenshot', `${OUT}/launch-error.png`);
} finally {
  await browser.deleteSession().catch(() => {});
  server.close();
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ['## Launch image colour scheme (#854)', '', '| Step | Screenshot | Centre pixel |', '|---|---|---|', ...results, ''].join('\n'),
  );
}

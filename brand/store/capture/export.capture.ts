import { test } from '@playwright/test';
import JSZip from 'jszip';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Drives the generator's own "Export bundle" (brand/store/generator, `npm run dev` on :3100)
// and keeps the store sizes under brand/store/{ios,android}.
const STORE = join(import.meta.dirname, '..');
const EXPORTS = [
  { platform: 'iOS', device: 'iPhone', size: '1320x2868', out: 'ios/iphone-6.9' },
  { platform: 'iOS', device: 'iPad', size: '2064x2752', out: 'ios/ipad-13' },
  { platform: 'Android', device: 'Android Phone', size: '1080x1920', out: 'android/phone' },
  { platform: 'Android', device: 'Feature Graphic', size: '1024x500', out: 'android/feature-graphic' },
];
const only = process.env.STORE_EXPORT;

test.use({ baseURL: 'http://127.0.0.1:3100', viewport: { width: 1600, height: 1000 }, acceptDownloads: true });

for (const e of EXPORTS.filter((x) => !only || x.out.includes(only))) {
  test(`export ${e.out}`, async ({ page, browser }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: e.platform }).click();
    const device = page.getByRole('combobox').first();
    if (!(await device.innerText()).includes(e.device)) {
      await device.click();
      await page.getByRole('option', { name: e.device, exact: true }).click();
    }
    await page.waitForTimeout(1500); // screenshots preload; the export retries any that are missing
    const download = page.waitForEvent('download', { timeout: 170_000 });
    await page.getByRole('button', { name: /Export bundle/ }).click();
    const zipPath = join(test.info().outputDir, 'bundle.zip');
    await (await download).saveAs(zipPath);
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const dir = join(STORE, e.out);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const files = Object.values(zip.files).filter((f) => !f.dir && f.name.includes(`/${e.size}/`));
    if (!files.length) throw new Error(`no ${e.size} files in ${Object.keys(zip.files).join(', ')}`);
    // The bundle's PNGs carry an alpha channel, which App Store Connect rejects: re-shoot each
    // one opaque at 1:1 to get RGB.
    const [w, h] = e.size.split('x').map(Number);
    const flat = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const f of files) {
      const b64 = await f.async('base64');
      await flat.setContent(`<body style="margin:0;background:#000"><img style="display:block" src="data:image/png;base64,${b64}"></body>`);
      await flat.locator('img').evaluate((img: HTMLImageElement) => img.decode());
      await flat.screenshot({ path: join(dir, f.name.split('/').pop()!) });
    }
    await flat.close();
  });
}

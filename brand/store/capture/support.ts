import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Browser, Page } from '@playwright/test';
import { withFencedPage, waitForAppReady } from '../../../e2e/fixtures';
import { assertTestOrigin } from '../../../e2e/support/origin-guard';

const SEED = join(import.meta.dirname, 'seed');
export const OUT = join(import.meta.dirname, 'raw');

// A demo identity on the fenced .homebase.test domain: nothing leaves the machine.
const ORIGIN = 'http://127.0.0.1:5174';
const storageState = {
  cookies: [],
  origins: [{
    origin: ORIGIN,
    localStorage: [
      { name: 'identity', value: 'maya.homebase.test' },
      { name: 'BX0900', value: 'e2e-fake-auth-token-000000000000' },
      { name: 'APSS', value: 'AAECAwQFBgcICQoLDA0ODw==' },
      { name: 'journal-last-seen-version', value: '999.0.0' },
    ],
  }],
};

async function seedZipBase64(): Promise<string> {
  const zip = new JSZip();
  for (const folder of readdirSync(SEED)) {
    for (const file of readdirSync(join(SEED, folder))) {
      zip.file(`Vault/${folder}/${file}`, readFileSync(join(SEED, folder, file), 'utf8'));
    }
  }
  return zip.generateAsync({ type: 'base64' });
}

export type Shot = { width: number; height: number; scale: number; dark?: boolean; insets?: { top: number; bottom: number }; touch?: boolean };

/** Boots the hermetic app at `shot`'s viewport, imports the demo notes, and runs `body`. */
export async function withSeededApp(browser: Browser, shot: Shot, body: (page: Page) => Promise<void>) {
  await withFencedPage(browser, {
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: shot.scale,
    isMobile: !!shot.touch,
    hasTouch: !!shot.touch,
    colorScheme: shot.dark ? 'dark' : 'light',
    storageState,
    serviceWorkers: 'block',
  }, async (page) => {
    if (shot.insets) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: shot.insets.top, bottom: shot.insets.bottom, left: 0, right: 0 } } as never);
    }
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page).catch(() => page.waitForLoadState('load').then(() => waitForAppReady(page)));
    const zip = await seedZipBase64();
    await assertTestOrigin(page);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { ImportService } = await import('/src/lib/importexport/ImportService.ts');
      const result = await ImportService.importFiles([new File([bytes], 'seed.zip')]);
      if (result.failed) throw new Error(JSON.stringify(result.errors));
    }, zip);
    await page.reload();
    await waitForAppReady(page);
    await body(page);
  });
}

const SIGNAL = '<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>';
const WIFI = '<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 12 5.6 9.3a3.4 3.4 0 0 1 4.8 0zM2.8 6.6a7.4 7.4 0 0 1 10.4 0l-1.4 1.5a5.4 5.4 0 0 0-7.6 0zM0 3.8a11.4 11.4 0 0 1 16 0l-1.4 1.5a9.4 9.4 0 0 0-13.2 0z"/></svg>';
const BATTERY = '<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2"/><path d="M25 4.5v4a2 2 0 0 0 0-4z" opacity=".4"/></svg>';

/** Draws the device status bar into the top safe area, as the native shell shows it. */
export async function statusBar(page: Page, kind: 'ios' | 'android' | 'ipad', height: number) {
  await page.evaluate(({ kind, height, icons }) => {
    document.getElementById('store-status-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'store-status-bar';
    const pad = kind === 'ios' ? '0 34px 0 48px' : kind === 'ipad' ? '0 22px' : '0 22px';
    bar.style.cssText = `position:fixed;top:0;left:0;right:0;height:${height}px;z-index:2147483647;pointer-events:none;display:flex;align-items:${kind === 'ios' ? 'center' : 'center'};justify-content:space-between;padding:${pad};font:600 ${kind === 'android' ? 14 : 17}px Inter,system-ui,sans-serif;color:var(--foreground)`;
    bar.innerHTML = `<span>${kind === 'ipad' ? '9:41&nbsp;&nbsp;Tue Nov 11' : '9:41'}</span><span style="display:flex;gap:6px;align-items:center;fill:currentColor">${icons}</span>`;
    if (kind === 'ios') {
      const island = document.createElement('div');
      island.style.cssText = 'position:absolute;left:50%;top:11px;width:126px;height:37px;margin-left:-63px;border-radius:20px;background:#000';
      bar.appendChild(island);
    }
    document.body.appendChild(bar);
  }, { kind, height, icons: SIGNAL + WIFI + BATTERY });
}

/** Cosmetic only: the dev origin in the share sheet's link preview reads as the production host. */
export async function productionHost(page: Page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue?.includes('127.0.0.1:5174')) n.nodeValue = n.nodeValue.replace('127.0.0.1:5174', 'journal.cloudx.run');
    }
  });
}

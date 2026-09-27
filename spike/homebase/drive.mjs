// Throwaway Playwright driver for the spike (#240). Not production code.
// Chromium trusts the per-run CA through the NSS DB (no ignoreHTTPSErrors).
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const IDENTITY = process.env.IDENTITY ?? 'frodo.dotyou.cloud';
const APP = process.env.APP_ORIGIN ?? 'https://e2e.dotyou.cloud:4443';
const OUT = process.env.OUT_DIR ?? '.';
const PASSWORD = `Spike-${crypto.randomUUID()}-Aa1!`;
const t0 = Date.now();
const log = (...a) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('requestfailed', (r) => log('REQFAIL', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) log('HTTP', r.status(), r.request().method(), r.url()); });
page.on('console', (m) => { if (m.type() === 'error') log('CONSOLE', m.text().slice(0, 300)); });
page.on('framenavigated', (f) => { if (f === page.mainFrame()) log('NAV', f.url().slice(0, 120)); });

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});

try {
  // 1. Owner first run. Preconfigured dev domains accept any first-run token
  //    (OwnerSecretService.SetNewPasswordAsync: `|| tenantContext.IsPreconfigured`),
  //    but it must parse as a Guid (PasswordReply.FirstRunToken is Guid?) or the API 400s.
  await page.goto(`https://${IDENTITY}/owner/firstrun?frt=${crypto.randomUUID()}`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#retypePassword').fill(PASSWORD);
  await shot('01-firstrun');
  await page.getByRole('button', { name: /Set password & login/i }).click();
  // The owner app lands on /owner/ and then redirects an unconfigured identity to /owner/setup.
  await page.waitForURL(/\/owner\/setup/, { timeout: 60_000 });
  log('after first run:', page.url().slice(0, 120));

  // 2. Setup wizard: EULA then "Setup" (names default from the hostname).
  //    The owner app sends the stored first-run token to system/initialize, which calls
  //    MarkRegistrationComplete(frt) and 400s on our made-up one. Without a token it skips that.
  await page.evaluate(() => localStorage.removeItem('first-run-token'));
  await page.locator('#eula').check();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await page.getByRole('button', { name: /^Setup$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/owner/setup'), { timeout: 180_000 });
  await shot('02-owner-home');
  log('owner console at', page.url().slice(0, 120));

  // 3. Owner-level endpoint with the owner cookie.
  const ownerVerify = await page.evaluate(() =>
    fetch('/api/owner/v1/authentication/verifyToken').then(async (r) => `${r.status} ${await r.text()}`));
  log('OWNER verifyToken ->', ownerVerify);
  if (!ownerVerify.endsWith('true')) throw new Error(`owner verifyToken not true: ${ownerVerify}`);

  // 4. YouAuth: authorise the Journal app from its own origin.
  await page.goto(APP);
  await page.locator('#identity').fill(IDENTITY);
  await page.getByRole('button', { name: /^Continue$/ }).click();
  let clicks = 0;
  // Clicks through owner-app consent pages until the app origin is back and `done()` holds.
  const consentUntil = async (done) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const url = new URL(page.url());
      if (url.origin === APP && !url.pathname.startsWith('/auth') && (await done().catch(() => false))) return;
      if (url.hostname === IDENTITY) {
        for (const name of [/^Allow$/, /^Next$/, /^Login$/]) {
          const btn = page.getByRole('button', { name });
          if (await btn.first().isVisible().catch(() => false)) {
            await shot(`03-consent-${++clicks}`);
            log('clicking', String(name), 'on', url.pathname);
            await btn.first().click();
            await page.waitForTimeout(1500);
            break;
          }
        }
      }
      await page.waitForTimeout(500);
    }
    throw new Error(`consent loop timed out at ${page.url().slice(0, 200)}`);
  };
  await consentUntil(() => page.evaluate(() => !!localStorage.getItem('BX0900')));

  // 4b. On a fresh identity the app immediately asks for extra permissions
  //     (ExtendPermissionDialog -> owner /owner/appupdate). Approve them too.
  const extend = page.getByRole('link', { name: /Extend permissions/ });
  if (await extend.waitFor({ timeout: 8_000 }).then(() => true, () => false)) {
    log('app shows "Missing permissions"; extending');
    await shot('04a-missing-permissions');
    await extend.click();
    await page.waitForURL((u) => u.hostname === IDENTITY, { timeout: 30_000 });
    await consentUntil(async () => !(await extend.isVisible()) &&
      (await page.getByRole('button', { name: /Create your first note|^New$/ }).first().isVisible()));
  }
  const hasToken = await page.evaluate(() => !!localStorage.getItem('BX0900') && !!localStorage.getItem('APSS'));
  await shot('04-app-after-auth');
  log('APP auth tokens stored:', hasToken, 'at', page.url().slice(0, 200));
  if (!hasToken) throw new Error('Journal app did not receive a YouAuth token');
  await ctx.storageState({ path: `${OUT}/live-storage-state.json` });

  // 5. Smoke: create one note and wait for its upload to the identity.
  const upload = page.waitForResponse(
    (r) => r.url().includes(IDENTITY) && /upload/i.test(r.url()) && r.request().method() === 'POST',
    { timeout: 90_000 });
  const newBtn = page.getByRole('button', { name: /Create your first note|^New$/ }).first();
  await newBtn.click();
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type(`Spike note ${new Date().toISOString()}`);
  const res = await upload;
  log('UPLOAD', res.status(), res.url());
  await shot('05-note');
  if (res.status() !== 200) throw new Error(`upload returned ${res.status()}`);
  log('SPIKE OK');
} catch (e) {
  await shot('99-failure');
  log('FAILED at', page.url().slice(0, 200), e);
  process.exitCode = 1;
} finally {
  await browser.close();
}

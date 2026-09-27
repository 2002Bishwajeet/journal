// Non-interactive counterpart to auth.setup.ts for CI (#203): drives the
// owner app bundled in the odin-core image through first-run, setup, and
// YouAuth consent for a freshly booted, unseeded dev identity — there's no
// human to click "Approve" like auth.setup.ts assumes. See #240's spike
// findings comment (the source of truth) for why each step below is needed.
//
// Deliberately imports from '@playwright/test' directly, not '../fixtures',
// for the same reason as auth.setup.ts: this leaves the app origin for the
// real identity's own owner console, which the shared network fence would
// otherwise abort. Everything else in e2e/ keeps using '../fixtures'.
import { test as setup, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { assertTestOrigin } from '../support/origin-guard';
import { LIVE_STORAGE_STATE } from '../fixtures';

const IDENTITY = process.env.E2E_LIVE_IDENTITY;
const CONSENT_TIMEOUT_MS = 120_000;

setup('bootstrap a fresh dev identity non-interactively and save storage state', async ({ page }) => {
    if (!IDENTITY) {
        throw new Error(
            'E2E_LIVE_IDENTITY is not set (e.g. frodo.dotyou.cloud — a preconfigured odin-core dev identity).',
        );
    }
    const password = `E2e-${crypto.randomUUID()}-Aa1!`;

    // 1. Owner first-run. Preconfigured dev domains skip the first-run-token
    // check, but the value must still parse as a Guid or /authentication/passwd 400s.
    await page.goto(`https://${IDENTITY}/owner/firstrun?frt=${crypto.randomUUID()}`);
    await page.locator('#password').fill(password);
    await page.locator('#retypePassword').fill(password);
    await page.getByRole('button', { name: /Set password & login/i }).click();
    await page.waitForURL(/\/owner\/setup/, { timeout: 60_000 });

    // 2. Setup wizard. The owner app would otherwise resend the fake
    // first-run token to system/initialize, and MarkRegistrationComplete 400s on it.
    await page.evaluate(() => localStorage.removeItem('first-run-token'));
    await page.locator('#eula').check();
    await page.getByRole('button', { name: /Confirm/i }).click();
    await page.getByRole('button', { name: /^Setup$/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/owner/setup'), { timeout: 180_000 });

    const ownerVerify = await page.evaluate(() =>
        fetch('/api/owner/v1/authentication/verifyToken').then((r) => r.text()));
    expect(ownerVerify).toBe('true');

    // 3. Authorise the Journal app via YouAuth, from the app's own origin.
    await page.goto('/welcome');
    await assertTestOrigin(page);
    const appOrigin = new URL(page.url()).origin;
    await page.getByLabel('Identity').fill(IDENTITY);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Clicks through the owner console's consent pages until back on the app
    // origin with `done()` satisfied. There's no DOM signal for "which
    // consent page is this" beyond the button that happens to be on it, and
    // no human to drive it (unlike auth.setup.ts's single waitForURL) — this
    // polling loop mirrors #240's validated spike driver for exactly that
    // reason, not a synchronization shortcut on our own app.
    const hasAuthTokens = () =>
        page.evaluate(() => !!localStorage.getItem('BX0900') && !!localStorage.getItem('APSS'));
    const consentUntil = async (done: () => Promise<boolean>) => {
        const deadline = Date.now() + CONSENT_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const url = new URL(page.url());
            if (url.origin === appOrigin && !url.pathname.startsWith('/auth') && (await done().catch(() => false))) {
                return;
            }
            if (url.hostname === IDENTITY) {
                for (const name of [/^Allow$/, /^Next$/, /^Login$/]) {
                    const button = page.getByRole('button', { name });
                    if (await button.first().isVisible().catch(() => false)) {
                        await button.first().click();
                        await page.waitForTimeout(1_000);
                        break;
                    }
                }
            }
            await page.waitForTimeout(500);
        }
        throw new Error(`Consent loop timed out at ${page.url()}`);
    };
    // Checks the raw auth-token keys rather than any visible app UI, since
    // the "Missing permissions" dialog below covers the app as soon as it
    // regains focus.
    await consentUntil(hasAuthTokens);

    // 4. A fresh identity has no permissions yet: Journal shows a "Missing
    // permissions" dialog right after the first consent (tracked separately
    // as its own bug, #246) — extend them here so the run isn't blocked.
    const extend = page.getByRole('link', { name: /Extend permissions/i });
    if (await extend.isVisible().catch(() => false)) {
        await extend.click();
        await page.waitForURL((url) => url.hostname === IDENTITY, { timeout: 30_000 });
        await consentUntil(async () => !(await extend.isVisible().catch(() => false)) && (await hasAuthTokens()));
    }

    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible({ timeout: 60_000 });
    await page.context().storageState({ path: LIVE_STORAGE_STATE });
});

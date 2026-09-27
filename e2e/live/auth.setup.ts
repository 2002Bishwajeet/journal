// Deliberately imports from '@playwright/test' directly, not '../fixtures':
// the whole point of this setup is to leave the app origin for the real
// identity's own YouAuth authorize page, which the shared fixtures' network
// fence would otherwise abort. Everything else in e2e/ keeps using
// '../fixtures' — see e2e/README.md.
import { test as setup, expect } from '@playwright/test';
import { assertTestOrigin } from '../support/origin-guard';

const IDENTITY = process.env.E2E_LIVE_IDENTITY;
const STORAGE_STATE_PATH = 'e2e/.auth/live.json';
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

setup('log in to a real Homebase identity and save storage state', async ({ page }) => {
    if (!IDENTITY) {
        throw new Error(
            'E2E_LIVE_IDENTITY is not set. Run: E2E_LIVE_IDENTITY=<identity> npm run e2e:login ' +
            '(use a throwaway identity, e.g. a local odin-core dev identity like frodo.dotyou.cloud — never your real journal).',
        );
    }

    await page.goto('/welcome');
    await assertTestOrigin(page);
    const appOrigin = new URL(page.url()).origin;

    await page.getByLabel('Identity').fill(IDENTITY);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Navigates away to https://<identity>/api/owner/v1/youauth/authorize — the
    // human approves the app's access request there, on the identity's own
    // owner console, then it redirects back to /auth/finalize on our origin.
    console.log(`Waiting up to ${APPROVAL_TIMEOUT_MS / 1000}s for approval on ${IDENTITY}...`);
    await page.waitForURL((url) => url.origin === appOrigin, { timeout: APPROVAL_TIMEOUT_MS });

    // /auth/finalize completes the key exchange, then replaces the URL with
    // the signed-in app shell.
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible({ timeout: 60_000 });

    await page.context().storageState({ path: STORAGE_STATE_PATH });
});

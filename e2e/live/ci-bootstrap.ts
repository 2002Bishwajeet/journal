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
import { test as setup, expect, type Browser, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { assertTestOrigin } from '../support/origin-guard';
import { LIVE_STORAGE_STATE, LIVE_SHARING_IDENTITIES, LIVE_CIRCLE_NAME, waitForAppReady } from '../fixtures';
import { createNote } from '../support/actions';

const IDENTITY = process.env.E2E_LIVE_IDENTITY;
const CONSENT_TIMEOUT_MS = 120_000;

setup.describe.configure({ mode: 'serial' });

// Clicks through the owner console's consent pages until back on the app
// origin with `done()` satisfied. There's no DOM signal for "which consent
// page is this" beyond the button that happens to be on it, and no human to
// drive it (unlike auth.setup.ts's single waitForURL) — this polling loop
// mirrors #240's validated spike driver for exactly that reason, not a
// synchronization shortcut on our own app.
async function consentUntil(page: Page, identity: string, appOrigin: string, done: () => Promise<boolean>) {
    const deadline = Date.now() + CONSENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const url = new URL(page.url());
        if (url.origin === appOrigin && !url.pathname.startsWith('/auth') && (await done().catch(() => false))) {
            return;
        }
        if (url.hostname === identity) {
            // Exactly one of these is ever visible at a time (the current
            // consent page), so one alternation locator covers all three.
            const button = page.getByRole('button', { name: /^(Allow|Next|Login)$/ });
            if (await button.first().isVisible().catch(() => false)) {
                await button.first().click();
                // Let the consent page navigate away before looking for the next button.
                await page.waitForTimeout(1_000);
                continue;
            }
        }
        // Polling a redirect chain across origins: no single element or event to wait on.
        await page.waitForTimeout(500);
    }
    throw new Error(`Consent loop timed out at ${page.url()}`);
}

// Checks the raw auth-token keys rather than any visible app UI, since the
// "Missing permissions" dialog covers the app as soon as it regains focus.
const hasAuthTokens = (page: Page) => () =>
    page.evaluate(() => !!localStorage.getItem('BX0900') && !!localStorage.getItem('APSS'));

/** First-run, setup and YouAuth consent for one dev identity, in its own context; saves its storage state. */
async function bootstrapIdentity(browser: Browser, identity: string, storageState: string): Promise<void> {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        const password = `E2e-${crypto.randomUUID()}-Aa1!`;

        // 1. Owner first-run. Preconfigured dev domains skip the first-run-token
        // check, but the value must still parse as a Guid or /authentication/passwd 400s.
        await page.goto(`https://${identity}/owner/firstrun?frt=${crypto.randomUUID()}`);
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
        await page.getByLabel('Identity').fill(identity);
        await page.getByRole('button', { name: 'Continue' }).click();
        await consentUntil(page, identity, appOrigin, hasAuthTokens(page));

        // 4. A fresh identity has no permissions yet: Journal shows a "Missing
        // permissions" dialog right after the first consent (tracked separately
        // as its own bug, #246) — extend them here so the run isn't blocked.
        const extend = page.getByRole('link', { name: /Extend permissions/i });
        if (await extend.isVisible().catch(() => false)) {
            await extend.click();
            await page.waitForURL((url) => url.hostname === identity, { timeout: 30_000 });
            await consentUntil(page, identity, appOrigin,
                async () => !(await extend.isVisible().catch(() => false)) && (await hasAuthTokens(page)()));
        }

        await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible({ timeout: 60_000 });
        // Also carries the owner-console session cookie for `identity`, which
        // the sharing setup below reuses.
        await context.storageState({ path: storageState });
    } finally {
        await context.close();
    }
}

setup('bootstrap a fresh dev identity non-interactively and save storage state', async ({ browser }) => {
    if (!IDENTITY) {
        throw new Error(
            'E2E_LIVE_IDENTITY is not set (e.g. frodo.dotyou.cloud — a preconfigured odin-core dev identity).',
        );
    }
    await bootstrapIdentity(browser, IDENTITY, LIVE_STORAGE_STATE);
});

// The peer and the outsider for e2e/sharing (#676): same steps, other dev
// identities on the same container.
for (const { role, identity, storageState } of LIVE_SHARING_IDENTITIES) {
    setup(`bootstrap the ${role} identity (${identity}) and save storage state`, async ({ browser }) => {
        await bootstrapIdentity(browser, identity, storageState);
    });
}

// Runs `body` with a page whose context carries `storageState` (an app session
// plus that identity's owner-console cookie, from bootstrapIdentity), then
// saves the state back, since a consent round-trip can refresh it.
async function withIdentity(browser: Browser, storageState: string, body: (page: Page) => Promise<void>) {
    const context = await browser.newContext({ storageState });
    try {
        await body(await context.newPage());
        await context.storageState({ path: storageState });
    } finally {
        await context.close();
    }
}

// The owner console's sidebar expands over the page while the mouse rests on
// it, and Playwright's mouse starts at (0, 0), inside it.
async function openOwnerConsole(page: Page, identity: string, path: string) {
    await page.goto(`https://${identity}${path}`);
    await page.mouse.move(1000, 600);
}

async function createCircle(page: Page, identity: string, name: string) {
    await openOwnerConsole(page, identity, '/owner/circles');
    await page.getByRole('button', { name: 'Add Circle' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create new Circle' });
    // The Name field has no usable accessible name of its own; it is the first textbox.
    await dialog.getByRole('textbox').first().fill(name);
    await dialog.getByRole('button', { name: 'Add Circle' }).click();
    await expect(page.getByRole('link', { name })).toBeVisible();
}

// The circle toggles in the owner console's connection dialogs hide the real
// checkbox under a styled switch, hence `force`.
async function sendConnectionRequest(page: Page, from: string, to: string, circle: string | null) {
    await openOwnerConsole(page, from, '/owner/connections');
    await page.getByRole('button', { name: 'Send Request' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send connection request' });
    await dialog.getByLabel('Recipient identity').fill(to);
    await dialog.getByRole('button', { name: 'Continue' }).click();
    if (circle) await dialog.getByRole('checkbox', { name: circle, exact: true }).check({ force: true });
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('link', { name: new RegExp(to) })).toBeVisible();
}

async function acceptConnectionRequest(page: Page, identity: string, from: string, circle: string | null) {
    const confirm = page.getByRole('button', { name: 'Confirm request...' });
    // The request travels host to host; reload until it lands.
    await expect(async () => {
        await openOwnerConsole(page, identity, '/owner/connections');
        await expect(confirm).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await confirm.click();
    const dialog = page.getByRole('dialog', { name: `Connection request from ${from}` });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    if (circle) await dialog.getByRole('checkbox', { name: circle, exact: true }).check({ force: true });
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('link', { name: new RegExp(from) })).toBeVisible();
}

/** Members of `circle` on `identity`, as identities. */
async function circleMembers(page: Page, identity: string, circle: string): Promise<string[]> {
    await openOwnerConsole(page, identity, '/owner/circles');
    await page.getByRole('link', { name: circle }).click();
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
    // Member rows link to /owner/connections/<identity>; the sidebar's link has no trailing segment.
    const members = page.locator('a[href^="/owner/connections/"]');
    await expect(members.first()).toBeVisible();
    return (await members.evaluateAll((links) => links.map((a) => a.getAttribute('href')!))).map((href) =>
        href.replace('/owner/connections/', ''));
}

// Opens Journal's collaboration dialog on a throwaway note, follows its
// "Grant Permissions" link and approves the owner-console app-update consent
// (COLLABORATION_PERMISSIONS plus the circle drives), the same way a person
// would the first time they share.
async function grantCollaborationPermissions(page: Page, identity: string) {
    await page.goto('/');
    await assertTestOrigin(page);
    const appOrigin = new URL(page.url()).origin;
    await waitForAppReady(page);

    const title = 'E2E setup: collaboration permissions';
    await createNote(page, { title, body: 'Opens the collaboration dialog once, during setup.' });
    await page.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark as Collaborative' }).click();

    const grant = page.getByRole('link', { name: /Grant Permissions/ });
    await expect(grant).toBeVisible({ timeout: 30_000 });
    await grant.click();
    await page.waitForURL((url) => url.hostname === identity, { timeout: 30_000 });
    // The consent returns with ?action=collaborate, which reopens the dialog,
    // now listing circles (ReadCircleMembership).
    const circle = page.getByRole('dialog').getByText(LIVE_CIRCLE_NAME);
    await consentUntil(page, identity, appOrigin, () => circle.isVisible());
}

setup('connect the owner with the peer and the outsider, and put only the peer in the E2E collaborators circle', async ({ browser }) => {
    const owner = IDENTITY!;
    const [peer, outsider] = LIVE_SHARING_IDENTITIES;

    // Fresh dev identities are not connected to each other (the owner's
    // Connections page reads "Ready to add some connections?"), so nothing to skip.
    await withIdentity(browser, LIVE_STORAGE_STATE, async (page) => {
        await createCircle(page, owner, LIVE_CIRCLE_NAME);
        await sendConnectionRequest(page, owner, peer.identity, LIVE_CIRCLE_NAME);
        await sendConnectionRequest(page, owner, outsider.identity, null);
    });
    await withIdentity(browser, peer.storageState, (page) =>
        acceptConnectionRequest(page, peer.identity, owner, null));
    await withIdentity(browser, outsider.storageState, (page) =>
        acceptConnectionRequest(page, outsider.identity, owner, null));

    await withIdentity(browser, LIVE_STORAGE_STATE, async (page) => {
        await openOwnerConsole(page, owner, '/owner/connections');
        for (const { identity } of [peer, outsider]) {
            await expect(page.getByRole('link', { name: new RegExp(identity) })).toBeVisible();
        }
        await expect(page.getByRole('heading', { name: 'Sent Connection Requests' })).toBeHidden();
        expect(await circleMembers(page, owner, LIVE_CIRCLE_NAME)).toEqual([peer.identity]);
    });
});

// Only what an ordinary user does: no owner-console circle authorization for
// Journal on either side (the app enrolls recipients in its own circle at share
// time, #730, and the recipient pulls, #732).
// - owner, permissions: until then the collaboration dialog offers only "Grant Permissions".
// - peer, permissions: without them the peer app's read over peer
//   (transit/query/header_byuniqueId) fails ("Does not have permission").
setup('grant Journal the collaboration permissions, on the owner and on the peer', async ({ browser }) => {
    const [peer] = LIVE_SHARING_IDENTITIES;
    for (const { identity, storageState } of [{ identity: IDENTITY!, storageState: LIVE_STORAGE_STATE }, peer]) {
        await withIdentity(browser, storageState, (page) => grantCollaborationPermissions(page, identity));
    }
});

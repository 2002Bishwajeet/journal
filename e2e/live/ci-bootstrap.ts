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
// src/lib/homebase/config.ts's JOURNAL_DRIVE; that module reads import.meta.env, which Playwright's Node has not got.
const JOURNAL_DRIVE = { alias: 'd5f411fa83fd4854a3bd7e974cc9bca9', type: '30743710039d4b97bbd352f343d1c9df' };
// Its JOURNAL_APP_ID for a production build, which the live tier's `vite build` is.
const JOURNAL_APP_ID = 'c762ee784274473480919d8080d7a825';

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

// odin-core v0.1.966's owner console has no Connections or Circles pages (odin-js #950, #951),
// so the sharing setup talks to the owner API directly, from the identity's owner console page.
// The owner API takes and returns bodies sealed with the owner console's shared secret
// (odin-core's SharedSecretEncryptionMiddleware 400s on plain JSON, and on a GET without an
// encrypted `ss` querystring): AES-CBC under localStorage's base64 `SS`, as {iv, data}.
// Same as js-lib's DotYouClient interceptors.
async function ownerApi<T>(page: Page, identity: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (new URL(page.url()).hostname !== identity) await page.goto(`https://${identity}/owner`);
    return page.evaluate(async ({ method, path, body }) => {
        const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
        const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        const key = await crypto.subtle.importKey(
            'raw', fromBase64(localStorage.getItem('SS')!), 'AES-CBC', false, ['encrypt', 'decrypt']);
        const seal = async (text: string) => {
            const iv = crypto.getRandomValues(new Uint8Array(16));
            const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(text)));
            return JSON.stringify({ iv: toBase64(iv), data: toBase64(data) });
        };
        const [route, query = ''] = path.split('?');
        const response = method === 'GET'
            ? await fetch(`/api/owner/v1${route}?ss=${encodeURIComponent(await seal(query))}`)
            : await fetch(`/api/owner/v1${route}`, {
                method,
                headers: { 'Content-Type': 'application/json', 'X-ODIN-FILE-SYSTEM-TYPE': 'Standard' },
                body: await seal(JSON.stringify(body)),
            });
        const text = await response.text();
        if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
        if (!text) return null;
        const sealed = JSON.parse(text) as { iv: string; data: string };
        const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.data));
        return JSON.parse(new TextDecoder().decode(plain) || 'null');
    }, { method, path, body }) as Promise<T>;
}

async function circleId(page: Page, identity: string, name: string): Promise<string> {
    const circles = await ownerApi<{ id: string; name: string }[]>(page, identity, 'GET', '/circles/definitions/list');
    const circle = circles.find((c) => c.name === name);
    if (!circle) throw new Error(`No circle "${name}" on ${identity}`);
    return circle.id;
}

// What the owner console's old "Add Circle" dialog created: Read on the standard profile
// drive and ReadConnections (10). A circle must grant at least one drive or key.
async function createCircle(page: Page, identity: string, name: string) {
    await ownerApi(page, identity, 'POST', '/circles/definitions/create', {
        id: crypto.randomUUID(),
        name,
        description: '',
        driveGrants: [{
            permissionedDrive: { drive: { alias: '8f12d8c4933813d378488d91ed23b64c', type: '597241530e3ef24b28b9a75ec3a5c45c' }, permission: 1 },
        }],
        permissions: { keys: [10] },
    });
}

async function sendConnectionRequest(page: Page, from: string, to: string, circle: string | null) {
    await ownerApi(page, from, 'POST', '/circles/requests/sendrequest', {
        recipient: to,
        message: 'E2E setup',
        contactData: { name: from },
        circleIds: circle ? [await circleId(page, from, circle)] : [],
    });
}

async function acceptConnectionRequest(page: Page, identity: string, from: string, circle: string | null) {
    // The request travels host to host; pending/single 404s until it lands.
    await expect(() => ownerApi(page, identity, 'POST', '/circles/requests/pending/single', { odinId: from }))
        .toPass({ timeout: 60_000 });
    await ownerApi(page, identity, 'POST', '/circles/requests/pending/accept', {
        sender: from,
        circleIds: circle ? [await circleId(page, identity, circle)] : [],
        contactData: { name: identity },
    });
}

/** Members of `circle` on `identity`, as identities. */
async function circleMembers(page: Page, identity: string, circle: string): Promise<string[]> {
    return ownerApi<string[]>(page, identity, 'POST', '/circles/connections/circles/list',
        { circleId: await circleId(page, identity, circle) });
}

async function connectionStatus(page: Page, identity: string, other: string): Promise<string> {
    const { status } = await ownerApi<{ status: string }>(page, identity, 'POST', '/circles/connections/status', { odinId: other });
    return status;
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
    await page.getByRole('menuitem', { name: 'Share…' }).click();

    const grant = page.getByRole('link', { name: /Grant Permissions/ });
    await expect(grant).toBeVisible({ timeout: 30_000 });
    await grant.click();
    await page.waitForURL((url) => url.hostname === identity, { timeout: 30_000 });
    // The consent returns with ?action=collaborate, which reopens the dialog,
    // now finding circles (ReadCircleMembership) in its search.
    const dialog = page.getByRole('dialog', { name: 'Share Note' });
    const circle = dialog.getByRole('option').filter({ hasText: LIVE_CIRCLE_NAME });
    await consentUntil(page, identity, appOrigin, async () => {
        const search = dialog.getByLabel('Add people or circles');
        if (!(await search.isVisible())) return false;
        await search.fill(LIVE_CIRCLE_NAME);
        return circle.first().isVisible();
    });
}

// What the circle page's "Apps that <circle> can use" -> Journal did: authorise the circle for
// Journal, so its members get Journal's circle drive grant (Journal Notes: Read, Write, React, Comment).
async function authorizeCircleForJournal(page: Page, identity: string, circle: string) {
    type App = { authorizedCircles: string[]; circleMemberPermissionSetGrantRequest: unknown };
    const app = await ownerApi<App>(page, identity, 'POST', '/appmanagement/app', { appId: JOURNAL_APP_ID });
    const id = await circleId(page, identity, circle);
    await ownerApi(page, identity, 'POST', '/appmanagement/register/updateauthorizedcircles', {
        appId: JOURNAL_APP_ID,
        authorizedCircles: [...app.authorizedCircles.filter((c) => c !== id), id],
        circleMemberPermissionGrant: app.circleMemberPermissionSetGrantRequest,
    });
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
    // The peer files the owner under its own circle of the same name: the owner's
    // invite reaches the peer only if the owner may write to the peer's Journal drive.
    await withIdentity(browser, peer.storageState, async (page) => {
        await createCircle(page, peer.identity, LIVE_CIRCLE_NAME);
        await acceptConnectionRequest(page, peer.identity, owner, LIVE_CIRCLE_NAME);
    });
    await withIdentity(browser, outsider.storageState, (page) =>
        acceptConnectionRequest(page, outsider.identity, owner, null));

    await withIdentity(browser, LIVE_STORAGE_STATE, async (page) => {
        for (const { identity } of [peer, outsider]) {
            expect((await connectionStatus(page, owner, identity)).toLowerCase()).toBe('connected');
        }
        expect(await circleMembers(page, owner, LIVE_CIRCLE_NAME)).toEqual([peer.identity]);
    });
});

// Each of these four steps was needed; dropping any one breaks the circle-share spec:
// - owner, permissions: until then the collaboration dialog offers only "Grant Permissions".
// - owner, circle: the peer can read without it (Journal Notes allows anonymous
//   reads; the file's ACL does the rest), but its edit is refused by the
//   owner's host ("Unauthorized to write to drive").
// - peer, permissions: without them the peer app's read over peer
//   (transit/query/header_byuniqueId) fails ("Does not have permission").
// - peer, circle: the owner's invite is a transfer into the peer's Journal
//   drive, which the peer's host refuses ("Unauthorized to write to drive").
setup('grant Journal what circle collaboration needs, on the owner and on the peer', async ({ browser }) => {
    // Two identities, each with a consent round-trip: the default 30s ran out on CI.
    setup.setTimeout(120_000);
    const [peer] = LIVE_SHARING_IDENTITIES;
    for (const { identity, storageState } of [{ identity: IDENTITY!, storageState: LIVE_STORAGE_STATE }, peer]) {
        await withIdentity(browser, storageState, async (page) => {
            await grantCollaborationPermissions(page, identity);
            await authorizeCircleForJournal(page, identity, LIVE_CIRCLE_NAME);
        });
    }
});

// #845: the owner's host accepts a share push (a peer app notification) only from a drive that
// has the IsCollaborativeChannel attribute and allows subscriptions. Journal's consent asks for
// both, but odin-js drops the attributes when the owner console creates the drive at consent,
// so a fresh identity's drive lacks the attribute and the push gets a 400. Set it through the
// owner API on this throwaway identity. Only the owner sends pushes.
setup('mark the owner\'s Journal drive as a collaboration drive that allows subscriptions', async ({ browser }) => {
    const owner = IDENTITY!;
    await withIdentity(browser, LIVE_STORAGE_STATE, async (page) => {
        const targetDrive = JOURNAL_DRIVE;
        type Drive = { targetDriveInfo: { alias: string }; allowSubscriptions: boolean; attributes: Record<string, string> | null };
        const journalDrive = async () => {
            const { results } = await ownerApi<{ results: Drive[] }>(page, owner, 'POST', '/drive/mgmt', { pageNumber: 1, pageSize: 1000 });
            const drive = results.find((d) => d.targetDriveInfo.alias.replace(/-/g, '') === targetDrive.alias);
            if (!drive) throw new Error('Journal drive not found');
            return drive;
        };
        const drive = await journalDrive();
        // updateattributes replaces the whole set, so keep what the drive already has.
        await ownerApi(page, owner, 'POST', '/drive/mgmt/updateattributes', {
            targetDrive,
            attributes: { ...drive.attributes, IsCollaborativeChannel: 'true' },
        });
        if (!drive.allowSubscriptions) {
            await ownerApi(page, owner, 'POST', '/drive/mgmt/set-allow-subscriptions', { targetDrive, allowSubscriptions: true });
        }
        const updated = await journalDrive();
        const result = { allowSubscriptions: updated.allowSubscriptions, collaborative: updated.attributes?.IsCollaborativeChannel };
        expect(result).toEqual({ allowSubscriptions: true, collaborative: 'true' });
    });
});

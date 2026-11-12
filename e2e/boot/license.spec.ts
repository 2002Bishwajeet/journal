import { existsSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { screenshotInBothThemes, settingsPanel } from '../support/actions';

// #301: the native app's license key, trial and paywall. The app is forced native through the
// init-script globals (window.__JOURNAL_NATIVE__ and a stub of Tauri's IPC). The device's store
// (native/rust/license.rs) lives on the test side, so it outlasts reloads and sign-out; the
// billing Worker (VITE_BILLING_URL in .env.e2e) is mocked with page.route.

const WORKER = 'https://billing.journal.test';
const BUY_URL = 'https://journal.cloudx.run/landing/buy';
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const KEY = 'E2E-LICENSE-KEY-0042';

type Store = Record<string, unknown> | null;
type Ipc = { cmd: string; args: Record<string, unknown> };

const licensed = (over: Record<string, unknown> = {}): Store => ({
    licenseKey: KEY,
    instanceId: 'inst-1',
    validatedAt: daysAgo(1),
    updatesUntil: new Date(Date.now() + 200 * DAY).toISOString(),
    trialStartedAt: daysAgo(100),
    ...over,
});

/** A signed-in native app on `platform`, with the device store `store`. */
async function openNativeApp(
    browser: Browser,
    { platform = 'macos', store = null }: { platform?: string; store?: Store },
    body: (page: Page, device: { store: Store; ipc: Ipc[] }) => Promise<void>,
): Promise<void> {
    const device = { store, ipc: [] as Ipc[] };
    await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
        await page.exposeFunction('deviceIpc', (cmd: string, args: Record<string, unknown>) => {
            device.ipc.push({ cmd, args });
            if (cmd === 'plugin:journal-license|load') return device.store;
            if (cmd === 'plugin:journal-license|save') device.store = args.state as Store;
            if (cmd === 'plugin:journal-license|hostname') return 'e2e-host';
            if (cmd === 'plugin:journal-mirror|state') return { root: null, files: {} };
            return null;
        });
        await page.addInitScript((platform) => {
            const w = window as unknown as Record<string, unknown>;
            w.__JOURNAL_NATIVE__ = { platform };
            w.__TAURI_INTERNALS__ = {
                transformCallback: () => 0,
                invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
                    const deviceIpc = w.deviceIpc as (cmd: string, args: unknown) => Promise<unknown>;
                    // The Worker call, as the page's own request so page.route can answer it (still logged in device.ipc).
                    if (cmd === 'plugin:journal-license|request') {
                        await deviceIpc(cmd, args);
                        const res = await fetch(`${args.base}${args.path}`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(args.body),
                        });
                        return { status: res.status, body: await res.json().catch(() => null) };
                    }
                    return deviceIpc(cmd, args);
                },
            };
        }, platform);
        // The Worker has no answer unless a test gives one (a later page.route wins).
        await page.route(`${WORKER}/**`, (route) => route.fulfill({ status: 502, json: { error: 'no answer' } }));
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page, device);
    });
}

const paywall = (page: Page) => page.getByRole('dialog', { name: /trial has ended|no longer valid|Connect to the internet|Enter license key/ });

async function openLicenseSettings(page: Page) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'License', exact: true }).click();
    return settingsPanel(dialog);
}

test.describe('native app', () => {
    test.skip(!existsSync('native/web/index.ts'), 'needs the private native/ module');

    test('first launch: a 3-day trial; a key activates with the device name; 422 names the 5-device limit', async ({ browser }) => {
        await openNativeApp(browser, {}, async (page, device) => {
            await page.setViewportSize({ width: 1280, height: 800 });
            const chip = page.getByRole('button', { name: 'Trial: 3 days left' });
            await expect(chip).toBeVisible();
            expect(device.store?.trialStartedAt).toEqual(expect.any(String));
            await screenshotInBothThemes(page, (theme) => `trial-chip-${theme}-desktop.png`);

            const activations: Record<string, unknown>[] = [];
            let answer = { status: 422, json: { error: 'activation limit reached' } as object };
            await page.route(`${WORKER}/license/activate`, (route) => {
                activations.push(route.request().postDataJSON());
                return route.fulfill(answer);
            });

            await chip.click();
            const sheet = page.getByRole('dialog', { name: 'Enter license key' });
            await expect(sheet.getByText('The key is in the email with your receipt.')).toBeVisible();
            await sheet.getByLabel('License key').fill(`  ${KEY}  `);
            await sheet.getByRole('button', { name: 'Activate' }).click();
            await expect(sheet.getByRole('alert')).toHaveText(
                'This key is already active on 5 devices. Remove it from one in Settings → License on that device, or contact us at mail@bishwajeetparhi.dev for more.',
            );
            await screenshotInBothThemes(page, (theme) => `activate-422-${theme}-desktop.png`);

            answer = { status: 200, json: { instanceId: 'inst-9', licensed: true, revoked: false, updatesUntil: '2027-11-12T00:00:00Z' } };
            await sheet.getByRole('button', { name: 'Activate' }).click();
            await expect(sheet).toBeHidden();
            await expect(chip).toBeHidden();
            expect(activations.at(-1)).toEqual({ licenseKey: KEY, name: 'Journal on macOS (e2e-host)' });
            expect(device.store).toMatchObject({ licenseKey: KEY, instanceId: 'inst-9', updatesUntil: '2027-11-12T00:00:00Z' });
        });
    });

    test('an ended trial shows the paywall; Buy on the website opens the buy page without an identity', async ({ browser }) => {
        await openNativeApp(browser, { store: { trialStartedAt: daysAgo(4) } }, async (page, device) => {
            await page.setViewportSize({ width: 1280, height: 800 });
            const wall = paywall(page);
            await expect(wall.getByRole('heading', { name: 'Your 3-day trial has ended.' })).toBeVisible();
            await expect(wall).toContainText('Your notes are safe on your Homebase, and the free web app keeps working.');
            await screenshotInBothThemes(page, (theme) => `paywall-${theme}-desktop.png`);

            await wall.getByRole('button', { name: 'Buy on the website' }).click();
            await expect.poll(() => device.ipc.filter((c) => c.cmd === 'plugin:opener|open_url')).toEqual([
                { cmd: 'plugin:opener|open_url', args: { url: BUY_URL } },
            ]);
            await expect(wall.getByRole('button', { name: 'Use the free web app' })).toBeVisible();
            await expect(wall.getByRole('button', { name: 'Sign out' })).toBeVisible();

            await wall.getByRole('button', { name: 'Enter license key' }).click();
            await expect(wall.getByLabel('License key')).toBeVisible();
        });
    });

    test('an answer 8 days old is checked again: revoked shows the paywall, 502 keeps the app open', async ({ browser }) => {
        await openNativeApp(browser, { store: licensed({ validatedAt: daysAgo(8) }) }, async (page, device) => {
            // The launch's check got the default 502.
            await expect.poll(() => device.ipc.some((c) => c.cmd === 'plugin:journal-license|request')).toBe(true);
            await expect(paywall(page)).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
            expect(device.store?.instanceId).toBe('inst-1');

            const checks: Record<string, unknown>[] = [];
            await page.route(`${WORKER}/license/validate`, (route) => {
                checks.push(route.request().postDataJSON());
                return route.fulfill({ json: { valid: false, licensed: false, revoked: true } });
            });
            await page.reload();
            await expect(paywall(page).getByRole('heading', { name: 'This license key is no longer valid.' })).toBeVisible();
            expect(checks).toEqual([{ licenseKey: KEY, instanceId: 'inst-1' }]);
            expect(device.store).toMatchObject({ licenseKey: KEY, revoked: true });
            expect(device.store?.instanceId).toBeUndefined();
        });
    });

    test('61 days past the last good answer and offline, the paywall asks to connect', async ({ browser }) => {
        await openNativeApp(browser, { store: licensed({ validatedAt: daysAgo(61) }) }, async (page) => {
            await page.route(`${WORKER}/**`, (route) => route.abort('internetdisconnected'));
            await page.reload();
            await expect(paywall(page).getByRole('heading', { name: 'Connect to the internet to check your license.' })).toBeVisible();
        });
    });

    test('signing out and in as another identity keeps the license; Remove from this device frees it', async ({ browser }) => {
        await openNativeApp(browser, { store: licensed() }, async (page, device) => {
            await page.setViewportSize({ width: 1280, height: 800 });
            await page.getByRole('button', { name: 'Log out' }).click();
            await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
            await expect.poll(() => page.evaluate(() => localStorage.getItem('APSS')).catch(() => 'navigating')).toBeNull();
            await page.waitForLoadState();
            await assertTestOrigin(page);
            await page.evaluate(() => {
                localStorage.setItem('identity', 'e2e-other.homebase.test');
                localStorage.setItem('BX0900', 'e2e-fake-auth-token-000000000001');
                localStorage.setItem('APSS', 'AAECAwQFBgcICQoLDA0ODw==');
            });
            await page.goto('/');
            await waitForAppReady(page);
            await expect(paywall(page)).toHaveCount(0);

            const panel = await openLicenseSettings(page);
            await expect(panel).toContainText('•••• 0042');
            await expect(panel).toContainText('Updates until');
            await screenshotInBothThemes(page, (theme) => `license-settings-${theme}-desktop.png`);

            const removed: Record<string, unknown>[] = [];
            await page.route(`${WORKER}/license/deactivate`, (route) => {
                removed.push(route.request().postDataJSON());
                return route.fulfill({ json: { ok: true } });
            });
            await panel.getByRole('button', { name: 'Remove from this device' }).click();
            await expect(paywall(page).getByRole('heading', { name: 'Your 3-day trial has ended.' })).toBeVisible();
            expect(removed).toEqual([{ licenseKey: KEY, instanceId: 'inst-1' }]);
            expect(device.store).toEqual({ trialStartedAt: expect.any(String), lastSeenAt: expect.any(String) });
        });
    });

    test('a license whose updates ended shows the renewal notice once', async ({ browser }) => {
        await openNativeApp(browser, { store: licensed({ updatesUntil: daysAgo(3) }) }, async (page, device) => {
            await page.setViewportSize({ width: 1280, height: 800 });
            await expect(page.getByText(/^Your updates ended on /)).toBeVisible();
            await expect.poll(() => device.store?.renewalNoticeFor).toBe(device.store?.updatesUntil);

            const panel = await openLicenseSettings(page);
            await expect(panel).toContainText(/Updates ended on .+\. Renew for another year\./);
            await expect(panel.getByRole('button', { name: 'Renew' })).toBeVisible();

            await page.reload();
            await waitForAppReady(page);
            await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
            await expect(page.getByText(/^Your updates ended on /)).toHaveCount(0);
        });
    });

    for (const platform of ['ios', 'android']) {
        test(`${platform}: the paywall is the store's, with no website, and takes a license key`, async ({ browser }) => {
            await openNativeApp(browser, { platform, store: { trialStartedAt: daysAgo(4) } }, async (page) => {
                await page.setViewportSize({ width: 390, height: 844 });
                const wall = paywall(page);
                await expect(wall.getByRole('heading', { name: 'Your 3-day trial has ended.' })).toBeVisible();
                await expect(wall.getByText(/website|journal\.cloudx\.run/i)).toHaveCount(0);
                await expect(wall.getByRole('button', { name: 'Buy on the website' })).toHaveCount(0);
                await screenshotInBothThemes(page, (theme) => `paywall-${platform}-${theme}-phone.png`);

                await wall.getByRole('button', { name: 'Have a license key?' }).click();
                await expect(wall.getByRole('heading', { name: 'Enter license key' })).toBeVisible();
                await expect(wall.getByLabel('License key')).toBeVisible();
            });
        });
    }
});

test('web: no billing UI except About → Get the desktop app', async ({ app }) => {
    await app.setViewportSize({ width: 1280, height: 800 });
    await expect(app.getByText(/^Trial/)).toHaveCount(0);
    await app.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog.getByRole('tab', { name: 'License' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'About', exact: true }).click();
    await expect(settingsPanel(dialog).getByRole('link', { name: /Get the desktop app/ })).toHaveAttribute(
        'href',
        'https://journal.cloudx.run/landing/download',
    );
});

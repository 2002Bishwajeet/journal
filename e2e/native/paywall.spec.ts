import { existsSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { screenshotInBothThemes } from '../support/actions';

// #1177: the store build's trial screen, paywall and Settings → Purchase, and desktop's #301
// paywall. The app is forced native through the init-script globals, as in e2e/boot/license.spec.ts;
// the journal-iap plugin (#1174) and the device store (native/rust/license.rs) live on the test
// side, so moving the trial's date back ends it on the next load.

const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const PRICE = '24,99 €';
const PHONE = { width: 390, height: 844 };
const IPAD = { width: 820, height: 1180 };

type Purchase = { productId: string; purchaseDate: string; originalPurchaseDate: string };
interface Device {
    store: Record<string, unknown> | null;
    /** The store account's verified purchases. */
    owned: Purchase[];
    /** What the next `purchase` answers. */
    answer: 'purchased' | 'pending' | 'cancelled';
    calls: string[];
}

const owned = (productId: string, at: string): Purchase => ({ productId, purchaseDate: at, originalPurchaseDate: at });

async function openNativeApp(
    browser: Browser,
    { platform, store = null, purchases = [] }: { platform: string; store?: Device['store']; purchases?: Purchase[] },
    body: (page: Page, device: Device) => Promise<void>,
): Promise<void> {
    const device: Device = { store, owned: purchases, answer: 'purchased', calls: [] };
    await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
        await page.exposeFunction('deviceIpc', (cmd: string, args: Record<string, unknown>) => {
            device.calls.push(cmd);
            if (cmd === 'plugin:journal-license|load') return device.store;
            if (cmd === 'plugin:journal-license|save') device.store = args.state as Device['store'];
            if (cmd === 'plugin:journal-license|hostname') return 'e2e-host';
            if (cmd === 'plugin:journal-mirror|state') return { root: null, files: {} };
            if (cmd === 'plugin:journal-iap|products') return [{ id: 'journal.unlock', displayName: 'Journal', displayPrice: PRICE }];
            if (cmd === 'plugin:journal-iap|entitlements' || cmd === 'plugin:journal-iap|restore') return { entitlements: device.owned };
            if (cmd === 'plugin:journal-iap|purchase') {
                if (device.answer === 'purchased') device.owned.push(owned(args.id as string, new Date().toISOString()));
                return { status: device.answer };
            }
            return null;
        });
        await page.addInitScript((platform) => {
            const w = window as unknown as Record<string, unknown>;
            w.__JOURNAL_NATIVE__ = { platform, plugins: ['journal-iap'] };
            w.__TAURI_INTERNALS__ = {
                transformCallback: () => 0,
                invoke: (cmd: string, args: Record<string, unknown> = {}) =>
                    (w.deviceIpc as (cmd: string, args: unknown) => Promise<unknown>)(cmd, args),
            };
        }, platform);
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page, device);
    });
}

const trialScreen = (page: Page) => page.getByRole('dialog', { name: 'Try Journal free for 3 days' });
const storePaywall = (page: Page) => page.getByRole('dialog', { name: 'Unlock Journal' });

/** Nothing on screen names the website, a web price or the web shop. */
async function expectNoWebPurchase(page: Page) {
    await expect(page.getByText(/website|cloudx\.run\/landing|Dodo/i)).toHaveCount(0);
}

test.describe('native paywall', () => {
    test.skip(!existsSync('native/web/index.ts'), 'needs the private native/ module');

    test('ios: trial screen → start → chip; 72 h later the paywall; pending, Restore, Buy', async ({ browser }) => {
        await openNativeApp(browser, { platform: 'ios' }, async (page, device) => {
            await page.setViewportSize(PHONE);
            const trial = trialScreen(page);
            await expect(trial.getByRole('button', { name: `Unlock now for ${PRICE}` })).toBeVisible();
            await expect(trial).toContainText(`until you unlock Journal for ${PRICE}, a one-time purchase`);
            await expect(trial.getByRole('button', { name: 'Restore purchases' })).toBeVisible();
            await expect(trial.getByRole('button', { name: 'Have a license key?' })).toBeVisible();
            await expectNoWebPurchase(page);
            await screenshotInBothThemes(page, (theme) => `trial-ios-${theme}-phone.png`);
            await page.setViewportSize(IPAD);
            await screenshotInBothThemes(page, (theme) => `trial-ios-${theme}-ipad.png`);
            await page.setViewportSize(PHONE);

            await trial.getByRole('button', { name: 'Start free trial' }).click();
            await expect(trial).toBeHidden();
            expect(device.owned.map((p) => p.productId)).toEqual(['journal.trial.3day']);
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Trial: 3 days left' })).toBeVisible();

            // 72 hours later.
            device.owned = [owned('journal.trial.3day', hoursAgo(73))];
            await page.reload();
            await waitForAppReady(page);
            const wall = storePaywall(page);
            await expect(wall.getByRole('button', { name: `Unlock for ${PRICE}` })).toBeVisible();
            await expect(wall).toContainText('Your notes are safe on your Homebase. Reading and exporting always work.');
            await expectNoWebPurchase(page);
            await screenshotInBothThemes(page, (theme) => `paywall-ios-${theme}-phone.png`);
            await page.setViewportSize(IPAD);
            await screenshotInBothThemes(page, (theme) => `paywall-ios-${theme}-ipad.png`);
            await page.setViewportSize(PHONE);

            await wall.getByRole('button', { name: 'Restore purchases' }).click();
            await expect(page.getByText('Nothing to restore for this account')).toBeVisible();

            device.answer = 'pending';
            await wall.getByRole('button', { name: `Unlock for ${PRICE}` }).click();
            await expect(wall.getByRole('button', { name: 'Waiting for approval' })).toBeDisabled();

            // Ask to Buy approved: the app reads the store again on the next launch (or its `changed` event).
            device.answer = 'purchased';
            await page.reload();
            await waitForAppReady(page);
            await wall.getByRole('button', { name: `Unlock for ${PRICE}` }).click();
            await expect(wall).toBeHidden();
            await expect(page.getByText('Journal unlocked')).toBeVisible();
            await expect(page.getByText('Your notes are read-only on this device.', { exact: false })).toHaveCount(0);
        });
    });

    test('ios: the paywall closes to the read-only app; Settings → Purchase has Restore and the license key', async ({ browser }) => {
        await openNativeApp(browser, { platform: 'ios', purchases: [owned('journal.trial.3day', hoursAgo(80))] }, async (page) => {
            await page.setViewportSize(PHONE);
            const wall = storePaywall(page);
            await expect(wall).toBeVisible();
            await wall.getByRole('button', { name: 'Close' }).click();
            await expect(wall).toBeHidden();

            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            const settings = page.getByRole('dialog', { name: 'Settings' });
            await settings.getByRole('listitem').getByRole('button', { name: /^Purchase/ }).click();
            await expect(settings.getByText('Your trial has ended. Your notes are read-only on this device.')).toBeVisible();
            await expect(settings.getByRole('button', { name: 'Restore purchases' })).toBeVisible();
            await expect(settings.getByLabel('License key')).toBeVisible();
            await expectNoWebPurchase(page);
            await screenshotInBothThemes(page, (theme) => `settings-purchase-ios-${theme}-phone.png`);
        });
    });

    test('android: no trial screen, paywall or website until #1175 turns the Play purchase on', async ({ browser }) => {
        await openNativeApp(browser, { platform: 'android', store: { trialStartedAt: hoursAgo(80) } }, async (page) => {
            await page.setViewportSize(PHONE);
            await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
            await expect(trialScreen(page)).toHaveCount(0);
            await expect(storePaywall(page)).toHaveCount(0);
            await expectNoWebPurchase(page);
        });
    });

    test('macos: the trial info once, then after the trial "Buy on the website"', async ({ browser }) => {
        await openNativeApp(browser, { platform: 'macos' }, async (page, device) => {
            await page.setViewportSize({ width: 1280, height: 800 });
            const info = trialScreen(page);
            await expect(info).toContainText('until you unlock Journal, a one-time purchase');
            await screenshotInBothThemes(page, (theme) => `trial-info-macos-${theme}-desktop.png`);
            await info.getByRole('button', { name: 'Continue' }).click();
            await expect(info).toBeHidden();
            await page.reload();
            await waitForAppReady(page);
            await expect(page.getByRole('button', { name: 'Trial: 3 days left' })).toBeVisible();
            await expect(info).toHaveCount(0);

            device.store = { ...device.store, trialStartedAt: hoursAgo(73) };
            await page.reload();
            await waitForAppReady(page);
            const wall = page.getByRole('dialog', { name: 'Your 3-day trial has ended.' });
            await expect(wall.getByRole('button', { name: 'Buy on the website' })).toBeVisible();
            await expect(wall.getByRole('button', { name: 'Enter license key' })).toBeVisible();
        });
    });
});

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { inBothThemes } from '../support/actions';

// Every billing state, desktop and phone, light and dark, for the paywall design pass.
// SHOT_DIR=<dir> puts the screenshots there; otherwise the test's output folder.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const PRICE = '24,99 €';
const KEY = 'E2E-LICENSE-KEY-0042';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

type Purchase = { productId: string; purchaseDate: string; originalPurchaseDate: string };
const owned = (productId: string, at: string): Purchase => ({ productId, purchaseDate: at, originalPurchaseDate: at });

interface Setup {
    platform: 'macos' | 'ios';
    store?: Record<string, unknown> | null;
    purchases?: Purchase[];
    loadFails?: boolean;
    priceFails?: boolean;
    infoSeen?: boolean;
}

async function shoot(page: Page, name: string, size: { width: number; height: number }) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    const width = size.width < 600 ? 'phone' : 'desktop';
    await inBothThemes(page, async (theme) => {
        const file = `${name}-${width}-${theme}.png`;
        const dir = process.env.SHOT_DIR;
        await page.screenshot({ path: dir ? path.join(dir, file) : test.info().outputPath(file) });
    });
}

async function open(browser: Browser, setup: Setup, body: (page: Page) => Promise<void>) {
    const device = { store: setup.store ?? null, owned: setup.purchases ?? [] };
    await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
        await page.exposeFunction('deviceIpc', (cmd: string, args: Record<string, unknown>) => {
            if (cmd === 'plugin:journal-license|load') {
                if (setup.loadFails) throw new Error('E_IO');
                return device.store;
            }
            if (cmd === 'plugin:journal-license|save') device.store = args.state as Record<string, unknown>;
            if (cmd === 'plugin:journal-license|hostname') return 'e2e-host';
            if (cmd === 'plugin:journal-license|request') return 'offline';
            if (cmd === 'plugin:journal-mirror|state') return { root: null, files: {} };
            if (cmd === 'plugin:journal-iap|products') {
                if (setup.priceFails) throw new Error('E_STORE_UNAVAILABLE');
                return [{ id: 'journal.unlock', displayName: 'Journal', displayPrice: PRICE }];
            }
            if (cmd === 'plugin:journal-iap|entitlements' || cmd === 'plugin:journal-iap|restore') return { entitlements: device.owned };
            return null;
        });
        await page.addInitScript(
            ({ platform, infoSeen }) => {
                const w = window as unknown as Record<string, unknown>;
                w.__JOURNAL_NATIVE__ = { platform, plugins: platform === 'ios' ? ['journal-iap'] : [] };
                w.__TAURI_INTERNALS__ = {
                    transformCallback: () => 0,
                    invoke: (cmd: string, args: Record<string, unknown> = {}) =>
                        (w.deviceIpc as (cmd: string, args: unknown) => Promise<unknown>)(cmd, args),
                };
                if (infoSeen) localStorage.setItem('journal:trial-info-seen', '1');
            },
            { platform: setup.platform, infoSeen: !!setup.infoSeen },
        );
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page);
    });
}

const openPaywall = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('journal:open-paywall')));
const openPurchase = async (page: Page) => {
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('journal:open-settings', { detail: 'license' })));
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    // The event can land before Settings mounts; pick the section by hand when it did.
    const restore = settings.getByRole('button', { name: /Restore purchases|Activate|Remove from this device/ }).first();
    const shown = await expect(restore).toBeVisible({ timeout: 3_000 }).then(() => true, () => false);
    // Desktop's nav is tabs; the phone's is a list of buttons.
    if (!shown) await settings.getByRole('tab', { name: 'Purchase' }).or(settings.getByRole('button', { name: /^Purchase/ })).first().click();
    await expect(restore).toBeVisible();
};

const licensed = (validatedDaysAgo: number) => ({
    licenseKey: KEY,
    instanceId: 'inst-1',
    validatedAt: ago(validatedDaysAgo * DAY),
    updatesUntil: new Date(Date.now() + 200 * DAY).toISOString(),
    trialStartedAt: ago(100 * DAY),
});

test.describe('paywall states', () => {
    test.skip(!existsSync('native/web/index.ts'), 'needs the private native/ module');
    test.setTimeout(240_000);

    for (const size of [DESKTOP, PHONE]) {
        const w = size === PHONE ? 'phone' : 'desktop';

        test(`macos ${w}: trial info, trial chip, trial paywall, purchase`, async ({ browser }) => {
            await open(browser, { platform: 'macos' }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('dialog', { name: 'Try Journal free for 3 days' })).toBeVisible();
                await shoot(page, 'macos-trial-info', size);
                await page.getByRole('button', { name: 'Continue' }).click();
                if (size === DESKTOP) await shoot(page, 'macos-trial-chip', size);
                await expect(page.getByRole('button', { name: 'Trial: 3 days left' })).toBeAttached();
                await openPaywall(page);
                await expect(page.getByRole('dialog', { name: 'Unlock Journal' })).toBeVisible();
                await shoot(page, 'macos-trial-paywall', size);
                await page.getByRole('button', { name: 'Enter license key' }).click();
                await shoot(page, 'macos-license-key', size);
                await page.getByRole('button', { name: 'Back' }).click();
                await page.getByRole('button', { name: 'Keep reading' }).click();
                await openPurchase(page);
                await shoot(page, 'macos-purchase-trial', size);
            });
        });

        test(`macos ${w}: locked`, async ({ browser }) => {
            await open(browser, { platform: 'macos', store: { trialStartedAt: ago(80 * HOUR) }, infoSeen: true }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('dialog', { name: 'Your 3-day trial has ended.' })).toBeVisible();
                await shoot(page, 'macos-locked', size);
                await page.getByRole('button', { name: 'Keep reading' }).click();
                await shoot(page, 'macos-read-only', size);
                await openPurchase(page);
                await shoot(page, 'macos-purchase-locked', size);
            });
        });

        test(`macos ${w}: revoked`, async ({ browser }) => {
            await open(
                browser,
                { platform: 'macos', store: { trialStartedAt: ago(80 * HOUR), licenseKey: KEY, revoked: true }, infoSeen: true },
                async (page) => {
                    await page.setViewportSize(size);
                    await expect(page.getByRole('dialog', { name: 'This license key is no longer valid.' })).toBeVisible();
                    await shoot(page, 'macos-revoked', size);
                },
            );
        });

        test(`macos ${w}: offline-expired`, async ({ browser }) => {
            await open(browser, { platform: 'macos', store: licensed(70), infoSeen: true }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('dialog', { name: 'Connect to the internet to check your license.' })).toBeVisible();
                await shoot(page, 'macos-offline-expired', size);
                await page.getByRole('button', { name: 'Keep reading' }).click();
                await openPurchase(page);
                await shoot(page, 'macos-purchase-offline-expired', size);
            });
        });

        test(`macos ${w}: license error`, async ({ browser }) => {
            await open(browser, { platform: 'macos', loadFails: true, infoSeen: true }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('dialog', { name: "Couldn't read your license" })).toBeVisible();
                await shoot(page, 'macos-license-error', size);
            });
        });

        test(`macos ${w}: unlocked`, async ({ browser }) => {
            await open(browser, { platform: 'macos', store: licensed(1), infoSeen: true }, async (page) => {
                await page.setViewportSize(size);
                await openPurchase(page);
                await shoot(page, 'macos-purchase-unlocked', size);
            });
        });

        test(`ios ${w}: trial not started`, async ({ browser }) => {
            await open(browser, { platform: 'ios' }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('button', { name: `Unlock now for ${PRICE}` })).toBeVisible();
                await shoot(page, 'ios-trial-not-started', size);
            });
        });

        test(`ios ${w}: trial paywall + purchase`, async ({ browser }) => {
            await open(browser, { platform: 'ios', purchases: [owned('journal.trial.3day', ago(HOUR))] }, async (page) => {
                await page.setViewportSize(size);
                await page.getByRole('button', { name: 'Trial: 3 days left' }).first().click();
                await expect(page.getByRole('button', { name: `Unlock for ${PRICE}` })).toBeVisible();
                await shoot(page, 'ios-trial-paywall', size);
                await page.getByRole('button', { name: 'Close' }).click();
                await openPurchase(page);
                await shoot(page, 'ios-purchase-trial', size);
            });
        });

        test(`ios ${w}: locked + purchase`, async ({ browser }) => {
            await open(browser, { platform: 'ios', purchases: [owned('journal.trial.3day', ago(80 * HOUR))] }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('button', { name: `Unlock for ${PRICE}` })).toBeVisible();
                await shoot(page, 'ios-locked', size);
                await page.getByRole('button', { name: 'Close' }).click();
                await shoot(page, 'ios-read-only', size);
                await openPurchase(page);
                await shoot(page, 'ios-purchase-locked', size);
            });
        });

        test(`ios ${w}: price error`, async ({ browser }) => {
            await open(browser, { platform: 'ios', priceFails: true, purchases: [owned('journal.trial.3day', ago(80 * HOUR))] }, async (page) => {
                await page.setViewportSize(size);
                await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 });
                await shoot(page, 'ios-price-error', size);
            });
        });

        test(`ios ${w}: offline-expired`, async ({ browser }) => {
            await open(
                browser,
                { platform: 'ios', store: licensed(70), purchases: [owned('journal.trial.3day', ago(80 * HOUR))] },
                async (page) => {
                    await page.setViewportSize(size);
                    await expect(page.getByRole('button', { name: `Unlock for ${PRICE}` })).toBeVisible();
                    await shoot(page, 'ios-offline-expired', size);
                },
            );
        });

        test(`ios ${w}: unlocked`, async ({ browser }) => {
            await open(browser, { platform: 'ios', purchases: [owned('journal.unlock', ago(DAY))] }, async (page) => {
                await page.setViewportSize(size);
                await openPurchase(page);
                await shoot(page, 'ios-purchase-unlocked', size);
            });
        });
    }
});

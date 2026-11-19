import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { fakeKeychain } from '../support/fakeKeychain';
import { openSettingsSection, settingsPanel, THEMES } from '../support/actions';

// #1363: Settings -> Security in the desktop app, and the app lock. The app is forced native
// (macOS) through the init-script globals, as in e2e/boot/license.spec.ts. The key command
// (src-tauri/src/db_key.rs) is faked on the page: it hands out a fixed key, so the app opens
// its encrypted database, and Touch ID always confirms the owner. Its lock state lives in
// localStorage so a reload keeps it.

const VIEWPORTS = { '390': { width: 390, height: 844 }, '1280': { width: 1280, height: 800 } } as const;

async function openDesktopApp(browser: Browser, body: (page: Page) => Promise<void>): Promise<void> {
    await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
        await page.addInitScript(() => {
            const w = window as unknown as Record<string, unknown>;
            w.__JOURNAL_NATIVE__ = { platform: 'macos', plugins: [] };
            const lockOn = () => localStorage.getItem('e2e-key-command-lock') === 'true';
            w.__TAURI_INTERNALS__ = {
                transformCallback: () => 0,
                invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
                    if (cmd === 'plugin:journal-db-key|database_key') return { key: Array<number>(32).fill(7) };
                    if (cmd === 'plugin:journal-db-key|security_status') return { lockAvailable: true, lockOn: lockOn(), passphrase: false };
                    if (cmd === 'plugin:journal-db-key|set_app_lock') localStorage.setItem('e2e-key-command-lock', String(args.on));
                    return null;
                },
            };
        });
        await fakeKeychain(page);
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page);
    });
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

async function openSecurity(page: Page) {
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await openSettingsSection(dialog, 'Security');
    await settle(page);
    return settingsPanel(dialog);
}

async function shoot(page: Page, what: string, viewport: string) {
    for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator('html')).toHaveClass(new RegExp(theme));
        await settle(page);
        await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${viewport}.png`), animations: 'disabled' });
    }
}

for (const [name, size] of Object.entries(VIEWPORTS)) {
    test(`Settings -> Security in the desktop app at ${name}px: encrypted, the app lock, Lock after`, async ({ browser }) => {
        test.setTimeout(90_000);
        await openDesktopApp(browser, async (page) => {
            await page.setViewportSize(size);
            const panel = await openSecurity(page);
            await expect(panel.getByText('Notes on this device are encrypted')).toBeVisible();
            await expect(panel.getByText('The key is in the system keychain.')).toBeVisible();
            const lock = panel.getByRole('switch', { name: 'App lock' });
            await expect(lock).not.toBeChecked();
            await expect(panel.getByLabel('Lock after')).toHaveCount(0);
            await shoot(page, 'security-lock-off', name);

            await lock.click();
            await expect(lock).toBeChecked();
            await expect(panel.getByLabel('Lock after')).toHaveValue('');
            await expect(panel.getByRole('button', { name: /^Lock( now)?$/ })).toBeVisible();
            // Until it is turned on, "Show notes outside the app" is off under the lock.
            await expect(panel.getByRole('switch', { name: 'Show notes outside the app' })).not.toBeChecked();
            await panel.getByLabel('Lock after').selectOption('5');
            await shoot(page, 'security-lock-on', name);
        });
    });
}

test('Lock now shows the lock screen and no note; Unlock opens the app again', async ({ browser }) => {
    test.setTimeout(90_000);
    await openDesktopApp(browser, async (page) => {
        await page.setViewportSize(VIEWPORTS['1280']);
        const panel = await openSecurity(page);
        await panel.getByRole('switch', { name: 'App lock' }).click();
        await expect(panel.getByRole('switch', { name: 'App lock' })).toBeChecked();

        await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: /^Lock( now)?$/ }).click()]);
        await expect(page.getByRole('heading', { name: 'Journal is locked' })).toBeVisible();
        await expect(page.getByRole('navigation')).toHaveCount(0);
        await shoot(page, 'lock-screen', '1280');

        await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Unlock' }).click()]);
        await waitForAppReady(page);
        await expect(page.getByRole('heading', { name: 'Journal is locked' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    });
});

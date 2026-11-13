import { existsSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, activeTitleInput, createNote, openNote, screenshotInBothThemes, settingsPanel } from '../support/actions';

// #1176: after the 3-day trial the native app is read-only on this device, never locked out.
// The app is forced native through the init-script globals, as in e2e/boot/license.spec.ts; the
// device store (native/rust/license.rs) lives on the test side, so moving its trialStartedAt
// back ends the trial on the next load. That makes `@premium`'s useEntitlement() answer
// `canEdit: false`.

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const BANNER = 'Your notes are read-only on this device. Unlock Journal to keep writing.';

type Store = Record<string, unknown> | null;

async function openNativeApp(browser: Browser, body: (page: Page, device: { store: Store }) => Promise<void>): Promise<void> {
    const device = { store: { trialStartedAt: daysAgo(0) } as Store };
    await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', acceptDownloads: true }, async (page) => {
        await page.exposeFunction('deviceIpc', (cmd: string, args: Record<string, unknown>) => {
            if (cmd === 'plugin:journal-license|load') return device.store;
            if (cmd === 'plugin:journal-license|save') device.store = args.state as Store;
            if (cmd === 'plugin:journal-license|hostname') return 'e2e-host';
            if (cmd === 'plugin:journal-mirror|state') return { root: null, files: {} };
            return null;
        });
        await page.addInitScript(() => {
            const w = window as unknown as Record<string, unknown>;
            w.__JOURNAL_NATIVE__ = { platform: 'macos' };
            // The first launch's trial info sheet (#1177) is e2e/native/paywall.spec.ts's.
            localStorage.setItem('journal:trial-info-seen', '1');
            w.__TAURI_INTERNALS__ = {
                transformCallback: () => 0,
                invoke: (cmd: string, args: Record<string, unknown> = {}) =>
                    (w.deviceIpc as (cmd: string, args: unknown) => Promise<unknown>)(cmd, args),
            };
        });
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page, device);
    });
}

test.describe('native app after the trial', () => {
    test.skip(!existsSync('native/web/index.ts'), 'needs the private native/ module');

    test('reading, search and export work; nothing can be written', async ({ browser }) => {
        await openNativeApp(browser, async (page, device) => {
            await page.setViewportSize({ width: 1280, height: 800 });
            // During the trial: write a note to read later.
            await createNote(page, { title: 'Packing list', body: 'passport, charger' });

            // The trial ends.
            device.store = { ...device.store, trialStartedAt: daysAgo(4) };
            await page.reload();
            await waitForAppReady(page);
            const wall = page.getByRole('dialog', { name: 'Your 3-day trial has ended.' });
            await expect(wall).toContainText('you can still read, search and export them');
            // Desktop keeps the free web app link; store builds never show it (#1211 L6, App Store anti-steering).
            await expect(wall.getByRole('button', { name: 'Use the free web app' })).toBeVisible();

            // Sign out asks first: the note written above hasn't synced (no backend), and sign-out wipes it.
            await wall.getByRole('button', { name: 'Sign out' }).click();
            const signOut = page.getByRole('dialog', { name: 'Sign out?' });
            await expect(signOut).toContainText(/n't synced yet and will be lost/);
            await signOut.getByRole('button', { name: 'Cancel' }).click();
            await expect(signOut).toBeHidden();
            await expect(wall).toBeVisible();
            await wall.getByRole('button', { name: 'Keep reading' }).click();
            await expect(wall).toBeHidden();

            // The banner, at the top of the note list, with Unlock opening the paywall again.
            const banner = page.getByRole('status').filter({ hasText: BANNER }).first();
            await expect(banner).toBeVisible();
            await banner.getByRole('button', { name: 'Unlock' }).click();
            await expect(wall).toBeVisible();
            await wall.getByRole('button', { name: 'Keep reading' }).click();

            // No new note, no new folder.
            await expect(page.getByRole('button', { name: /^New( note)?$/ })).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'New folder' })).toHaveCount(0);

            // Reading: the note opens and its editor takes no typing.
            await openNote(page, 'Packing list');
            const editor = activeEditor(page);
            await expect(editor).toContainText('passport, charger');
            await expect(editor).toHaveAttribute('contenteditable', 'false');
            await editor.click();
            await page.keyboard.type('sunscreen');
            await expect(editor).not.toContainText('sunscreen');
            await expect(activeTitleInput(page)).toHaveJSProperty('readOnly', true);
            // #1211: no way to add a tag (tagInputReadOnly.test.tsx lists them), and Contents stays without the toolbar.
            await expect(page.locator('input[placeholder="Add tags..."]:visible')).toHaveCount(0);
            await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);
            await page.getByRole('button', { name: 'Table of contents', exact: true }).click();
            await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
            await screenshotInBothThemes(page, (theme) => `read-only-${theme}-desktop.png`);

            // Search finds it.
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await page.getByRole('dialog').getByRole('combobox').or(page.getByRole('dialog').getByRole('textbox')).first().fill('passport');
            await expect(page.getByRole('dialog').getByText('Packing list').first()).toBeVisible();
            await page.keyboard.press('Escape');

            // Export from the banner's overflow: Settings → Data & storage, with no import.
            await banner.getByRole('button', { name: 'More' }).click();
            await page.getByRole('menuitem', { name: 'Export my notes' }).click();
            const settings = page.getByRole('dialog');
            const panel = settingsPanel(settings);
            await expect(panel.getByRole('button', { name: 'Import Archive' })).toHaveCount(0);
            const download = page.waitForEvent('download');
            await panel.getByRole('button', { name: 'Export All Notes' }).click();
            expect((await download).suggestedFilename()).toMatch(/\.zip$/);

            // Today (journal://today and ?action=today) creates nothing: with no note for today, both go home.
            for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
                await page.setViewportSize(size);
                for (const url of ['/today', '/?action=today']) {
                    await page.goto(url);
                    await waitForAppReady(page);
                    await expect(page).toHaveURL((u) => u.pathname === '/' && !u.search);
                    await expect(page.getByText('Daily', { exact: true })).toHaveCount(0);
                }
            }
        });
    });
});

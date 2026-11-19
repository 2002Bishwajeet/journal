import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, createNote, openSettingsSection, settingsPanel, THEMES } from '../support/actions';

// #1427: a locked note in the desktop app. The app is forced native (macOS) through the
// init-script globals, as in e2e/settings/security.spec.ts. The key command
// (src-tauri/src/db_key.rs) is faked on the page: a fixed database key, and Touch ID that always
// confirms the owner, counted so the spec sees each Unlock ask.

const VIEWPORTS = { '1280': { width: 1280, height: 800 }, '390': { width: 390, height: 844 } } as const;
const TITLE = 'Diary';
const BODY = 'The surprise party is on Friday';

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
                    if (cmd === 'plugin:journal-db-key|confirm_owner') {
                        localStorage.setItem('e2e-owner-checks', String(Number(localStorage.getItem('e2e-owner-checks') ?? 0) + 1));
                    }
                    return null;
                },
            };
        });
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page);
    });
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const ownerChecks = (page: Page) => page.evaluate(() => Number(localStorage.getItem('e2e-owner-checks') ?? 0));

async function shoot(page: Page, what: string, viewport: string) {
    for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator('html')).toHaveClass(new RegExp(theme));
        await settle(page);
        await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${viewport}.png`), animations: 'disabled' });
    }
}

test('lock a note: the locked panel and a hidden snippet, Unlock, then Lock now locks it again', async ({ browser }) => {
    test.setTimeout(120_000);
    await openDesktopApp(browser, async (page) => {
        await page.setViewportSize(VIEWPORTS['1280']);
        await createNote(page, { title: TITLE, body: BODY });
        const row = page.getByTestId('note-row').filter({ hasText: TITLE });
        await expect(row).toContainText(BODY);

        await row.click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Lock note' }).click();
        const panel = page.getByRole('region', { name: 'Locked note' });
        await expect(panel.getByRole('heading', { name: 'This note is locked' })).toBeVisible();
        await expect(activeEditor(page)).toHaveCount(0);
        await expect(row).toContainText('Locked');
        await expect(row).not.toContainText(BODY);
        await expect(row.getByLabel('Locked')).toBeVisible();
        // Locking asks nothing.
        expect(await ownerChecks(page)).toBe(0);
        await shoot(page, 'locked-note', '1280');

        // A locked note can't be shared.
        await row.click({ button: 'right' });
        await expect(page.getByRole('menuitem', { name: 'Remove lock' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Share…' })).toHaveCount(0);
        await page.keyboard.press('Escape');

        await panel.getByRole('button', { name: 'Unlock' }).click();
        await expect(activeEditor(page)).toContainText(BODY);
        expect(await ownerChecks(page)).toBe(1);
        // The snippet stays hidden in the list while the note is open.
        await expect(row).not.toContainText(BODY);

        // Lock now (with the app lock on) locks it again.
        await page.getByRole('button', { name: 'Settings' }).click();
        const dialog = page.getByRole('dialog', { name: 'Settings' });
        await openSettingsSection(dialog, 'Security');
        const security = settingsPanel(dialog);
        await security.getByRole('switch', { name: 'App lock' }).click();
        await expect(security.getByRole('switch', { name: 'App lock' })).toBeChecked();
        await Promise.all([page.waitForEvent('load'), security.getByRole('button', { name: /^Lock( now)?$/ }).click()]);
        await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Unlock' }).click()]);
        await waitForAppReady(page);
        await expect(page.getByRole('heading', { name: 'This note is locked' })).toBeVisible();
        await expect(activeEditor(page)).toHaveCount(0);

        // The phone: the locked panel, then the note list it goes back to.
        await page.setViewportSize(VIEWPORTS['390']);
        await expect(page.getByRole('heading', { name: 'This note is locked' })).toBeVisible();
        await shoot(page, 'locked-note', '390');
        await page.getByRole('button', { name: 'Back to list' }).click();
        const phoneRow = page.getByTestId('note-row').filter({ hasText: TITLE });
        await expect(phoneRow).toContainText('Locked');
        await expect(phoneRow).not.toContainText(BODY);
        await shoot(page, 'locked-note-list', '390');
    });
});

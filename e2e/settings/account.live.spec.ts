import type { Page, TestInfo } from '@playwright/test';
import { test, expect, liveIdentityOrigin } from '../fixtures';
import { createNote, typeInEditor } from '../support/actions';

// #213 on a real Homebase: Settings → Account shows the live identity, Sync now
// reaches "Up to date · last synced Just now", and an edit made offline makes
// both sign-out entry points warn with the same lost-changes copy. Never
// confirms a sign-out — the liveRun page is shared with the other live specs.

// PR evidence: the "E2E live" workflow uploads this directory on every run.
const SCREENSHOT_DIR = 'test-results/account-screenshots';

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    // Let the dialog's fade/zoom-in finish (skipping endless ones like spinners).
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {}))));
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function openAccount(page: Page) {
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
    return settings.getByRole('tabpanel');
}

async function closeSettings(page: Page) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
}

test('Account: live identity, Sync now, offline edit warns on both sign-outs (#213)', async ({ liveRun }, testInfo) => {
    test.setTimeout(180_000);
    const { page } = liveRun;
    const identity = new URL(liveIdentityOrigin()).hostname;
    const title = `Account note ${Date.now()}`;
    await createNote(page, { title, body: 'Synced first, then edited offline.' });

    let panel = await openAccount(page);
    await expect(panel).toContainText(identity);
    const status = panel.getByRole('status');
    // Sync now until nothing is left waiting (the note above may still be uploading).
    await expect(async () => {
        await panel.getByRole('button', { name: 'Sync now' }).click();
        await expect(status).toHaveText('Up to date · last synced Just now', { timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    await screenshot(page, testInfo, 'account-live-synced');

    // No pending changes: the dialog reassures rather than warns.
    await panel.getByRole('button', { name: 'Sign out' }).click();
    let confirm = page.getByRole('dialog', { name: 'Sign out?' });
    await expect(confirm).toContainText('Your notes stay safe in your Homebase');
    await screenshot(page, testInfo, 'signout-live-no-pending');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await closeSettings(page);

    const context = page.context();
    await context.setOffline(true);
    try {
        await typeInEditor(page, ' Offline edit.');

        panel = await openAccount(page);
        await expect(panel.getByRole('status')).toContainText('Offline');
        // The editor's 2s debounced save is what refreshes the pending count.
        await expect(panel.getByRole('status')).toContainText('waiting', { timeout: 10_000 });
        await panel.getByRole('button', { name: 'Sign out' }).click();
        confirm = page.getByRole('dialog', { name: 'Sign out?' });
        const warning = confirm.getByText(/synced yet and will be lost/);
        await expect(warning).toBeVisible();
        const settingsCopy = await warning.textContent();
        await screenshot(page, testInfo, 'signout-live-pending-settings');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        await expect(confirm).toBeHidden();
        await closeSettings(page);

        await page.getByRole('button', { name: 'Log out' }).click();
        confirm = page.getByRole('dialog', { name: 'Sign out?' });
        await expect(confirm.getByText(/will be lost/)).toHaveText(settingsCopy!);
        await screenshot(page, testInfo, 'signout-live-pending-sidebar');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        await expect(confirm).toBeHidden();
    } finally {
        await context.setOffline(false);
    }

    // Back online, the offline edit syncs and the warning goes away.
    panel = await openAccount(page);
    await expect(async () => {
        await panel.getByRole('button', { name: 'Sync now' }).click();
        await expect(panel.getByRole('status')).toHaveText('Up to date · last synced Just now', { timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    await closeSettings(page);
});

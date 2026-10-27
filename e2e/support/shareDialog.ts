import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';

// The note's Share dialog (#682): people and circles with a role, and the public link.

export const shareDialog = (page: Page) => page.getByRole('dialog', { name: 'Share Note' });

/** The role menu of a row in "People with access": a circle's name or a person's identity. */
export const shareRole = (page: Page, name: string) => shareDialog(page).getByLabel(`Role for ${name}`, { exact: true });

/** Opens the Share dialog from the note row's menu in the current list. */
export async function openShareDialog(page: Page, title: string): Promise<void> {
    await assertTestOrigin(page);
    await page.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share…' }).click();
    await expect(shareDialog(page)).toBeVisible();
}

/**
 * Adds a circle or a connection: types `query` into the search and presses Enter, which adds
 * the highlighted result. `role` is picked first; without it a circle is an Editor and a
 * person a Viewer.
 */
export async function addToShare(page: Page, query: string, role?: 'Viewer' | 'Editor'): Promise<void> {
    const dialog = shareDialog(page);
    const field = dialog.getByLabel('Add people or circles');
    await field.fill(query);
    // The circles and connections load from the owner's server
    await expect(dialog.getByRole('option').filter({ hasText: query }).first()).toBeVisible({ timeout: 30_000 });
    if (role) await dialog.getByLabel('Role for people and circles you add').selectOption({ label: role });
    await field.press('Enter');
    await expect(shareRole(page, query)).toBeVisible();
}

/** Done saves the changes. An owner-console drive turns the dialog into a "Note shared" notice: close it. */
export async function saveShare(page: Page): Promise<void> {
    await shareDialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(shareDialog(page)).toBeHidden({ timeout: 30_000 });
    const readOnly = page.getByRole('dialog', { name: 'Note shared' });
    if (await readOnly.isVisible()) await readOnly.getByRole('button', { name: 'Done' }).click();
}

/** Stops sharing the note with everyone, from its Share dialog (one confirm). */
export async function stopSharing(page: Page, title: string): Promise<void> {
    await openShareDialog(page, title);
    await shareDialog(page).getByRole('button', { name: 'Stop sharing', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Stop sharing?' });
    await confirm.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(confirm).toBeHidden();
    // The footer's Stop sharing goes once the note is no longer shared
    await expect(shareDialog(page).getByRole('button', { name: 'Stop sharing', exact: true })).toHaveCount(0, { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(shareDialog(page)).toBeHidden();
}

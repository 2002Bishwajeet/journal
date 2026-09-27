import type { Page } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';

/** Create a note via the real UI (the notes list's "New" button), then fill title and body. */
export async function createNote(page: Page, { title, body }: { title: string; body: string }): Promise<void> {
    await assertTestOrigin(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByPlaceholder('Untitled').fill(title);
    // A freshly created note's Yjs document is still settling right after the
    // title fill (its editor briefly loses focus/keystrokes if typed into
    // immediately — confirmed by typing "Hello" and seeing only "H" land).
    // No DOM-observable readiness signal exists for this, so a short wait is
    // the practical fix.
    await page.waitForTimeout(500);
    await typeInEditor(page, body);
}

/** Open a note from the sidebar note list by its title. */
export async function openNote(page: Page, title: string): Promise<void> {
    await assertTestOrigin(page);
    await page.getByRole('button').filter({ hasText: title }).first().click();
}

/** Type into the currently open note's TipTap editor. */
export async function typeInEditor(page: Page, text: string): Promise<void> {
    await assertTestOrigin(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially(text);
    // Local persistence of the Yjs update to PGlite is not synchronous with
    // typing — navigating away right after typing can lose the last
    // keystrokes (confirmed: reloading immediately after showed only the
    // first couple of characters). No DOM-observable signal exists for it,
    // so a short settle wait is the practical fix.
    await page.waitForTimeout(1000);
}

/** Wait for SyncService to have no queued work left. */
export async function waitForSyncIdle(page: Page): Promise<void> {
    await assertTestOrigin(page);
    await page.evaluate(() => window.__journalE2E!.syncIdle());
}

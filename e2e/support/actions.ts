import { expect, type Locator, type Page } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';

// Previously open notes stay mounted as background tabs (so switching tabs is
// instant), each with its own title input and `.ProseMirror`. Both a
// getByPlaceholder('Untitled') and a bare `.ProseMirror` locator can then
// resolve to more than one element — scope every read/write to the visible
// (active) tab. Exported so specs asserting on the title/editor do the same.

/** The active tab's title input ("Untitled" is its placeholder, not its value). */
export function activeTitleInput(page: Page): Locator {
    return page.locator('input[placeholder="Untitled"]:visible');
}

/** The active tab's TipTap editor. */
export function activeEditor(page: Page): Locator {
    return page.locator('.ProseMirror:visible');
}

/** Create a note via the real UI (the notes list's "New" button), then fill title and body. */
export async function createNote(page: Page, { title, body }: { title: string; body: string }): Promise<void> {
    await assertTestOrigin(page);
    const before = page.url();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    // Desktop keeps earlier tabs mounted (hidden), so wait for the new note's URL,
    // then for the active title to read the new note's default "Untitled" — the
    // assertion re-queries on every retry, riding out the tab transition.
    await page.waitForURL((url) => url.href !== before);
    const input = activeTitleInput(page);
    await expect(input).toHaveValue('Untitled');
    await input.fill(title);
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
    const editor = activeEditor(page);
    await editor.click();
    await editor.pressSequentially(text);
    // Local persistence of the Yjs update to PGlite is not synchronous with
    // typing — navigating away right after typing can lose the last
    // keystrokes (confirmed: reloading immediately after showed only the
    // first couple of characters). No DOM-observable signal exists for it,
    // so a short settle wait is the practical fix.
    await page.waitForTimeout(1000);
}

/** The sidebar's folder list (used by the live tier's per-run isolation folder). */
export function foldersNav(page: Page): Locator {
    return page.getByRole('navigation', { name: 'Folders' });
}

/** Create a folder via the sidebar's "New folder" modal. */
export async function createFolder(page: Page, name: string): Promise<void> {
    await assertTestOrigin(page);
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByPlaceholder('Folder Name').fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(foldersNav(page).getByRole('button', { name, exact: true })).toBeVisible();
}

/** Select a folder in the sidebar — routes the active view to it. */
export async function selectFolder(page: Page, name: string): Promise<void> {
    await assertTestOrigin(page);
    await foldersNav(page).getByRole('button', { name, exact: true }).click();
}

/** Delete a folder (and everything in it) via the sidebar's context menu. */
export async function deleteFolder(page: Page, name: string): Promise<void> {
    await assertTestOrigin(page);
    await foldersNav(page).getByRole('button', { name, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Folder' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
}

/** Make a note public via the note list's "Share" context-menu item, returning its share URL. */
export async function shareNotePublicly(page: Page, title: string): Promise<string> {
    await assertTestOrigin(page);
    await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share' }).click();

    await page.getByRole('button', { name: 'Make Note Public' }).click();
    // The real makeNotePublic() drive call happens here — give it real network time.
    // The read-only URL row; the public branch also has the link-card Description textarea (#222).
    const urlInput = page.getByRole('dialog').locator('input[readonly]');
    await expect(urlInput).toBeVisible({ timeout: 15_000 });
    const shareUrl = await urlInput.inputValue();
    await page.keyboard.press('Escape');
    return shareUrl;
}

/** Grant a folder access to MCP agents via Settings -> Agent access (#168 UI). */
export async function setFolderAgentAccess(
    page: Page,
    folderName: string,
    access: 'none' | 'read' | 'write'
): Promise<void> {
    await assertTestOrigin(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Agent access' }).click();
    await dialog.getByLabel(`Agent access for ${folderName}`).selectOption(access);
    await page.keyboard.press('Escape');
}

/** Make a public note private again via the note list's "Share" context-menu item. */
export async function unshareNotePublicly(page: Page, title: string): Promise<void> {
    await assertTestOrigin(page);
    await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Stop sharing (make private)' }).click();
    // The real makeNotePrivate() drive call happens here — give it real network time.
    await expect(page.getByRole('button', { name: 'Make Note Public' })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
}

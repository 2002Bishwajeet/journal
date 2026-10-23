import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';
import { waitForAppReady } from '../fixtures';

// Previously open notes stay mounted as background tabs (so switching tabs is
// instant), each with its own title input and `.ProseMirror`. Both a
// getByPlaceholder('Untitled') and a bare `.ProseMirror` locator can then
// resolve to more than one element — scope every read/write to the visible
// (active) tab. Exported so specs asserting on the title/editor do the same.

/** The active tab's title field, a textarea ("Untitled" is its placeholder, not its value). */
export function activeTitleInput(page: Page): Locator {
    return page.locator('textarea[placeholder="Untitled"]:visible');
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
    // title fill (its editor briefly loses keystrokes if typed into immediately),
    // so wait for the title to be written before typing.
    await expect.poll(() => page.evaluate(() => window.__journalE2E!.hasUnsavedEdits())).toBe(false);
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
    await waitForNoteSaved(page);
}

/**
 * Wait until every edit made so far has been written to PGlite, so a reload or
 * navigation right after cannot lose it (typing then reloading immediately kept
 * only the first couple of characters). Uses the e2e hooks the app exposes.
 */
export async function waitForNoteSaved(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.__journalE2E!.hasUnsavedEdits())).toBe(false);
    // A commit returns before PGlite has flushed it to IndexedDB; a reload before that loses it.
    await page.evaluate(() => window.__journalE2E!.syncToDisk());
}

/** Paste `text` as plain text at the editor's cursor, through a synthetic paste event. */
export async function pastePlainText(page: Page, text: string): Promise<void> {
    await assertTestOrigin(page);
    await activeEditor(page).evaluate((el, value) => {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
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

/** Stop sharing a folder if it is shared (no-op when private), so its notes leave the public index. */
export async function unshareFolderIfShared(page: Page, name: string): Promise<void> {
    await assertTestOrigin(page);
    await foldersNav(page).getByRole('button', { name, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    const dialog = page.getByRole('dialog');
    const stop = dialog.getByRole('button', { name: 'Stop sharing (make private)' });
    await expect(dialog.getByRole('button', { name: /^(Share folder|Stop sharing \(make private\))$/ })).toBeVisible();
    if (await stop.isVisible()) {
        await stop.click();
        await dialog.getByRole('button', { name: 'Stop sharing', exact: true }).click();
        await expect(page.getByText(/Folder is private again/)).toBeVisible({ timeout: 60_000 });
    }
    await page.keyboard.press('Escape');
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

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Run `body` once per theme on the same page (light, then dark), so a behaviour whose
 * assertions do not depend on the theme is exercised once and only the evidence is taken
 * twice. A sandbox frame reloads on a theme change, so `body` should re-check what it
 * needs before taking its screenshots. Leaves the page in dark.
 */
export async function inBothThemes(page: Page, body: (theme: Theme) => Promise<unknown>): Promise<void> {
    for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator('html')).toHaveClass(new RegExp(theme));
        // Colour transitions keep running after the class flips; let them finish so shots show the settled theme.
        await page.evaluate(() =>
            Promise.all(
                document
                    .getAnimations()
                    .filter((a) => a instanceof CSSTransition)
                    .map((a) => a.finished.catch(() => undefined))
            )
        );
        await body(theme);
    }
}

/** `inBothThemes` with one full-page screenshot per theme, named by `fileName`. */
export async function screenshotInBothThemes(
    page: Page,
    fileName: (theme: Theme) => string,
    settle?: (theme: Theme) => Promise<void>,
    options: Omit<Parameters<Page['screenshot']>[0] & object, 'path'> = {}
): Promise<void> {
    await inBothThemes(page, async (theme) => {
        await settle?.(theme);
        await page.screenshot({ ...options, path: test.info().outputPath(fileName(theme)) });
    });
}

/** Reload, wait for the app to boot (CI takes ~6-7s) and for the note's editor to show. */
export async function reloadNote(page: Page): Promise<void> {
    await page.reload();
    await waitForAppReady(page);
    await expect(activeEditor(page)).toBeVisible({ timeout: 15_000 });
}

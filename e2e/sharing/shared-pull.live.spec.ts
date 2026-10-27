import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, activeEditor, screenshotInBothThemes, selectFolder } from '../support/actions';
import { addToShare, openShareDialog, saveShare } from '../support/shareDialog';

// #732: the peer finds a shared note by pulling from the owner's drive, without
// the owner's invite. Docker tier only, like circle-share.live.spec.ts.

function noteRow(page: Page, title: string) {
    return page.getByTestId('note-row').filter({ hasText: title });
}

const sharedWithMe = (page: Page) => page.getByRole('button', { name: /Shared with me/ });

const stamp = Date.now();
const title = `Pulled share ${stamp}`;
const body = `Pulled body ${stamp}`;

test('"Refresh" in "Shared with me" finds a shared note without its invite', async ({ liveRun, liveSharing }) => {
    test.setTimeout(300_000);
    const { owner, peer, circleName } = liveSharing;

    // Until the peer's page reloads, its app drops incoming invites: only the pull can bring the note.
    await peer.page.evaluate(() => window.__journalE2E!.ignoreInvites());

    await createNote(owner.page, { title, body });
    // On an identity whose Journal drive another app owns, the dialog stays open as "Note shared": saveShare closes it.
    await openShareDialog(owner.page, title);
    await addToShare(owner.page, circleName);
    await saveShare(owner.page);

    const refresh = peer.page.getByRole('button', { name: 'Refresh shared notes' });
    await expect(async () => {
        await refresh.click();
        await expect(refresh).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
        await sharedWithMe(peer.page).click();
        await expect(noteRow(peer.page, title)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 180_000 });

    await noteRow(peer.page, title).click();
    await expect(activeEditor(peer.page)).toContainText(body, { timeout: 30_000 });
    await screenshotInBothThemes(peer.page, (theme) => `shared-pull-peer-note-${theme}.png`);

    // liveRun's page is shared with the specs that run after this one.
    await selectFolder(owner.page, liveRun.folderName);
});

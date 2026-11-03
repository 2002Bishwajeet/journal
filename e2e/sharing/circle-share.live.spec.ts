import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, typeInEditor, activeEditor, screenshotInBothThemes, foldersNav, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { addToShare, openShareDialog, saveShare, shareDialog, stopSharing } from '../support/shareDialog';

// The circle-share flow (#676), through the one Share dialog (#682). Docker tier
// only: the liveSharing fixture needs the peer and outsider identities
// ci-bootstrap.ts sets up.

/** Reload until `check` passes: a reload runs the app's sync pull, and nothing else signals that new data arrived. */
async function reloadUntil(page: Page, check: () => Promise<void>): Promise<void> {
    await expect(async () => {
        await page.reload();
        await waitForAppReady(page);
        await check();
    }).toPass({ timeout: 120_000 });
}

// The notes list's row, not the editor's tab of the same title.
function noteRow(page: Page, title: string) {
    return page.getByTestId('note-row').filter({ hasText: title });
}

const sharedWithMe = (page: Page) => page.getByRole('button', { name: /Shared with me/ });

test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const title = `Circle share ${stamp}`;
const body = `Shared body ${stamp}`;
const peerSentence = ` Peer was here ${stamp}.`;

test('a note shared with a circle reaches its member but not an outsider', async ({ liveRun, liveSharing }) => {
    // Three identities, and every hand-off between them crosses two Homebase hosts.
    test.setTimeout(360_000);
    const { owner, peer, outsider, circleName } = liveSharing;

    // 1. The owner shares a new note in the run folder with the circle, as editors.
    await createNote(owner.page, { title, body });
    await openShareDialog(owner.page, title);
    await addToShare(owner.page, circleName);
    await expect(shareDialog(owner.page).getByRole('list', { name: 'People with access' })).toContainText(circleName);
    await screenshotInBothThemes(owner.page, (theme) => `circle-share-dialog-${theme}.png`);
    await saveShare(owner.page);
    // The note stays in the folder it was in.
    await expect(noteRow(owner.page, title)).toBeVisible({ timeout: 30_000 });

    // 2. The peer finds it under "Shared with me", sees the body and edits it.
    await reloadUntil(peer.page, async () => {
        await sharedWithMe(peer.page).click({ timeout: 5_000 });
        await expect(noteRow(peer.page, title)).toBeVisible({ timeout: 5_000 });
    });
    await noteRow(peer.page, title).click();
    await expect(activeEditor(peer.page)).toContainText(body, { timeout: 30_000 });
    // The peer's header says who shared it, by name, and nothing is an unknown circle.
    await peer.page.getByRole('button', { name: 'Show who can access this note' }).click();
    const access = peer.page.getByRole('list', { name: 'People with access' });
    await expect(access).toContainText(owner.identity);
    await expect(peer.page.getByText('Unknown circle')).toHaveCount(0);
    await peer.page.keyboard.press('Escape');
    await screenshotInBothThemes(peer.page, (theme) => `circle-share-peer-note-${theme}.png`);
    await typeInEditor(peer.page, peerSentence);

    // 3. The owner sees the peer's sentence after reopening the note (realtime
    // is not required); the note is still in the run folder.
    await assertTestOrigin(owner.page);
    await reloadUntil(owner.page, () =>
        expect(activeEditor(owner.page)).toContainText(peerSentence.trim(), { timeout: 5_000 }));
    await selectFolder(owner.page, liveRun.folderName);
    await expect(noteRow(owner.page, title)).toBeVisible();

    // 4. The outsider is connected to the owner but in no circle, so is not a
    // recipient: by the time the peer had the note, the outsider has nothing,
    // even after pulling from its connections (#732: the owner's server must not
    // return the note to a connection its ACL does not admit).
    await outsider.page.reload();
    await waitForAppReady(outsider.page);
    await expect(foldersNav(outsider.page).getByRole('button', { name: 'Main', exact: true })).toBeVisible();
    const refresh = outsider.page.getByRole('button', { name: 'Refresh shared notes' });
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
    await sharedWithMe(outsider.page).click();
    await expect(outsider.page.getByText(title)).toHaveCount(0);
    // liveRun's page is shared with the specs that run after this one.
    await selectFolder(owner.page, liveRun.folderName);
});

// Stopping the share keeps the note in its folder and takes it away from the
// peer's "Shared with me" after the peer's next sync (#680).
test('the owner stops sharing, and the peer no longer reaches the note', async ({ liveRun, liveSharing }) => {
    const { owner, peer } = liveSharing;
    await selectFolder(owner.page, liveRun.folderName);
    await stopSharing(owner.page, title);
    await expect(noteRow(owner.page, title)).toBeVisible();

    // A reload runs the peer's sync pull, which receives the deleted invite.
    await reloadUntil(peer.page, async () => {
        if (await sharedWithMe(peer.page).isVisible()) await sharedWithMe(peer.page).click();
        await expect(noteRow(peer.page, title)).toHaveCount(0, { timeout: 5_000 });
    });
});

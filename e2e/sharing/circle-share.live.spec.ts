import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, typeInEditor, activeEditor, screenshotInBothThemes, foldersNav, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// Baseline for today's circle-share flow (#676), so #678's sharing rework and
// #681's person sharing have a safety net. Docker tier only: the liveSharing
// fixture needs the peer and outsider identities ci-bootstrap.ts sets up.

// src/lib/homebase/config.ts's COLLABORATIVE_FOLDER_ID: a shared note moves there.
const COLLABORATIVE_FOLDER_ID = 'fc360190-4e23-b870-0ea4-ef233aad98ad';

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

    // 1. The owner shares a new note in the run folder with the circle.
    await createNote(owner.page, { title, body });
    await noteRow(owner.page, title).click({ button: 'right' });
    await owner.page.getByRole('menuitem', { name: 'Mark as Collaborative' }).click();
    const dialog = owner.page.getByRole('dialog', { name: 'Mark as Collaborative' });
    const circle = dialog.getByRole('button').filter({ hasText: circleName });
    // Click at once, before the row's members load: the share resolves them itself.
    await circle.click();
    await screenshotInBothThemes(owner.page, (theme) => `circle-share-dialog-${theme}.png`);
    await dialog.getByRole('button', { name: 'Share with 1 circle' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 2. The peer finds it under "Shared with me", sees the body and edits it.
    await reloadUntil(peer.page, async () => {
        await sharedWithMe(peer.page).click({ timeout: 5_000 });
        await expect(noteRow(peer.page, title)).toBeVisible({ timeout: 5_000 });
    });
    await noteRow(peer.page, title).click();
    await expect(activeEditor(peer.page)).toContainText(body, { timeout: 30_000 });
    await screenshotInBothThemes(peer.page, (theme) => `circle-share-peer-note-${theme}.png`);
    await typeInEditor(peer.page, peerSentence);

    // 3. The owner sees the peer's sentence after reopening the note (realtime
    // is not required). Bug: the owner's own shared notes are in no list (the
    // sidebar hides their folder, and they leave the folder they were in), and
    // step 5's "Revoke Collaboration" is only in a list row's menu, so this
    // goes through the app's own folder route for them; the note stays open.
    await owner.page.goto(`/${COLLABORATIVE_FOLDER_ID}`);
    await assertTestOrigin(owner.page);
    await reloadUntil(owner.page, () =>
        expect(activeEditor(owner.page)).toContainText(peerSentence.trim(), { timeout: 5_000 }));

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

// The owner's revoke leaves the shared notes' folder and takes the note away from
// the peer's "Shared with me" after the peer's next sync (#680).
test('the owner revokes the share, and the peer no longer reaches the note', async ({ liveSharing }) => {
    const { owner, peer } = liveSharing;
    await owner.page.goto(`/${COLLABORATIVE_FOLDER_ID}`);
    await assertTestOrigin(owner.page);
    await noteRow(owner.page, title).click({ button: 'right' });
    await owner.page.getByRole('menuitem', { name: 'Revoke Collaboration' }).click();
    const confirm = owner.page.getByRole('dialog', { name: 'Revoke Collaboration' });
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(confirm).toBeHidden({ timeout: 30_000 });
    // Revoking moves the note out of the shared notes' folder.
    await expect(noteRow(owner.page, title)).toBeHidden({ timeout: 30_000 });

    // A reload runs the peer's sync pull, which receives the deleted invite.
    await reloadUntil(peer.page, async () => {
        if (await sharedWithMe(peer.page).isVisible()) await sharedWithMe(peer.page).click();
        await expect(noteRow(peer.page, title)).toHaveCount(0, { timeout: 5_000 });
    });
});

import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, typeInEditor, activeEditor, screenshotInBothThemes, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// Sharing a note with a named identity (#681). Needs an owner server with
// odin-core #1993, which no release has yet (2026-10-23): run it on the
// bleeding-edge servers of the demo identities (`npm run e2e:live` with
// E2E_LIVE_IDENTITY, E2E_LIVE_PEER_IDENTITY and E2E_LIVE_OUTSIDER_IDENTITY),
// not on the Docker tier. The outsider must have granted Journal its
// collaboration permissions, all connected identities included.

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

async function expectInSharedWithMe(page: Page, title: string) {
    await reloadUntil(page, async () => {
        await sharedWithMe(page).click({ timeout: 5_000 });
        await expect(noteRow(page, title)).toBeVisible({ timeout: 5_000 });
    });
}

async function expectGoneFromSharedWithMe(page: Page, title: string) {
    await reloadUntil(page, async () => {
        if (await sharedWithMe(page).isVisible()) await sharedWithMe(page).click();
        await expect(noteRow(page, title)).toHaveCount(0, { timeout: 5_000 });
    });
}

const shareDialog = (page: Page) => page.getByRole('dialog', { name: 'Mark as Collaborative' });

async function addPerson(page: Page, identity: string) {
    const field = shareDialog(page).getByLabel('Add a person (Homebase identity)');
    await field.fill(identity);
    await field.press('Enter');
    await expect(shareDialog(page).getByRole('list', { name: 'People' })).toContainText(identity);
}

/** Opens the owner's shared notes' folder, where the note's "Edit Sharing" item is. */
async function editSharing(page: Page, title: string) {
    await page.goto(`/${COLLABORATIVE_FOLDER_ID}`);
    await assertTestOrigin(page);
    await waitForAppReady(page);
    await noteRow(page, title).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit Sharing' }).click();
    await expect(shareDialog(page)).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

const stamp = Date.now();

test('a note shared with the outsider by identity reaches only them, and the peer is refused', async ({ liveRun, liveSharing }) => {
    // Three identities, and every hand-off between them crosses two Homebase hosts.
    test.setTimeout(480_000);
    const { owner, peer, outsider } = liveSharing;
    const title = `Person share ${stamp}`;
    const body = `Shared body ${stamp}`;
    const outsiderSentence = ` Outsider was here ${stamp}.`;

    // 1. The owner shares a new note with the outsider only, by identity.
    await createNote(owner.page, { title, body });
    const docId = new URL(owner.page.url()).pathname.split('/').pop()!;
    await noteRow(owner.page, title).click({ button: 'right' });
    await owner.page.getByRole('menuitem', { name: 'Mark as Collaborative' }).click();
    await addPerson(owner.page, outsider.identity);
    await screenshotInBothThemes(owner.page, (theme) => `person-share-dialog-${theme}.png`);
    await shareDialog(owner.page).getByRole('button', { name: 'Share with 1 person' }).click();
    await expect(shareDialog(owner.page)).toBeHidden({ timeout: 30_000 });

    // 2. The outsider finds it under "Shared with me", sees the body and edits it.
    await expectInSharedWithMe(outsider.page, title);
    await noteRow(outsider.page, title).click();
    await expect(activeEditor(outsider.page)).toContainText(body, { timeout: 30_000 });
    await typeInEditor(outsider.page, outsiderSentence);

    // 3. The owner sees the outsider's sentence after reopening the note.
    await owner.page.goto(`/${COLLABORATIVE_FOLDER_ID}`);
    await assertTestOrigin(owner.page);
    await reloadUntil(owner.page, () =>
        expect(activeEditor(owner.page)).toContainText(outsiderSentence.trim(), { timeout: 5_000 }));

    // 4. The peer is in the owner's circle but not named: no invite reached them.
    await peer.page.reload();
    await waitForAppReady(peer.page);
    await expect(peer.page.getByText(title)).toHaveCount(0);

    // 5. Security check (#678 decision 6): with the all connected identities grant,
    // the peer has drive access to the owner's Journal, so only the note's ACL keeps
    // them out. They must be refused a read and a patch over peer.
    const before = await owner.page.evaluate((id) => window.__journalE2E!.noteHeader(id), docId);
    expect(before?.globalTransitId, 'the note has a globalTransitId to address a peer update by').toBeTruthy();
    // A peer update goes through the peer's own outbox: the peer's server answers
    // "enqueued", and the owner's server accepts or refuses it later, host to host.
    // So the patch is refused when the owner's note never changes.
    const patchResponse = peer.page.waitForResponse((r) => r.url().includes('/drive/files/update'));
    const probe = await peer.page.evaluate(
        ([author, id, globalTransitId, versionTag]) =>
            window.__journalE2E!.probePeerNote(author, id, globalTransitId, versionTag),
        [owner.identity, docId, before!.globalTransitId!, before!.versionTag] as const,
    );
    const { recipientStatus } = await (await patchResponse).json();
    test.info().annotations.push({
        type: 'security check (peer, not named)',
        description: JSON.stringify({ ...probe, recipientStatus }),
    });
    expect(probe.read, 'the peer reads the note').not.toBe('read');
    // A member's peer update lands within seconds (circle-share.live.spec.ts step 3);
    // nothing signals a refused one, so wait a minute, then check the note is unchanged.
    await owner.page.waitForTimeout(60_000);
    const after = await owner.page.evaluate((id) => window.__journalE2E!.noteHeader(id), docId);
    expect(after?.versionTag, 'the note changed').toBe(before!.versionTag);

    // 6. Taking the outsider off the share stops it; their next sync drops the note.
    await editSharing(owner.page, title);
    await shareDialog(owner.page).getByRole('button', { name: `Remove ${outsider.identity}` }).click();
    await shareDialog(owner.page).getByRole('button', { name: 'Stop sharing' }).click();
    await expect(shareDialog(owner.page)).toBeHidden({ timeout: 30_000 });
    await expectGoneFromSharedWithMe(outsider.page, title);
    // liveRun's page is shared with the specs that run after this one.
    await selectFolder(owner.page, liveRun.folderName);
});

test('a note shared with the circle and the outsider reaches both, and taking the outsider off leaves the peer', async ({ liveRun, liveSharing }) => {
    test.setTimeout(480_000);
    const { owner, peer, outsider, circleName } = liveSharing;
    const title = `Circle and person share ${stamp}`;

    // 1. The owner shares a new note with the circle and the outsider.
    await createNote(owner.page, { title, body: `Shared body ${stamp}` });
    await noteRow(owner.page, title).click({ button: 'right' });
    await owner.page.getByRole('menuitem', { name: 'Mark as Collaborative' }).click();
    await shareDialog(owner.page).getByRole('button').filter({ hasText: circleName }).click();
    await addPerson(owner.page, outsider.identity);
    await shareDialog(owner.page).getByRole('button', { name: 'Share with 1 circle and 1 person' }).click();
    await expect(shareDialog(owner.page)).toBeHidden({ timeout: 30_000 });

    // 2. Both get it.
    await expectInSharedWithMe(peer.page, title);
    await expectInSharedWithMe(outsider.page, title);

    // 3. The owner takes the outsider off and keeps the circle: the outsider's next
    // sync drops the note, and the peer still has it.
    await editSharing(owner.page, title);
    await shareDialog(owner.page).getByRole('button', { name: `Remove ${outsider.identity}` }).click();
    await shareDialog(owner.page).getByRole('button', { name: 'Share with 1 circle' }).click();
    await expect(shareDialog(owner.page)).toBeHidden({ timeout: 30_000 });
    await expectGoneFromSharedWithMe(outsider.page, title);
    await expectInSharedWithMe(peer.page, title);

    // Clean up: stop sharing, so the peer's list doesn't grow run after run.
    await owner.page.goto(`/${COLLABORATIVE_FOLDER_ID}`);
    await assertTestOrigin(owner.page);
    await waitForAppReady(owner.page);
    await noteRow(owner.page, title).click({ button: 'right' });
    await owner.page.getByRole('menuitem', { name: 'Revoke Collaboration' }).click();
    const confirm = owner.page.getByRole('dialog', { name: 'Revoke Collaboration' });
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(confirm).toBeHidden({ timeout: 30_000 });
    await selectFolder(owner.page, liveRun.folderName);
});

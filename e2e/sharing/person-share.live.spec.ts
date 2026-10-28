import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, typeInEditor, activeEditor, screenshotInBothThemes, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { addToShare, openShareDialog, saveShare, shareDialog, shareRole, stopSharing } from '../support/shareDialog';

// Sharing a note read-only with a named person (#897). Needs owner servers with
// odin-core #1993 (v0.1.966 on): run it on the demo tier (`npm run e2e:live` with
// E2E_LIVE_IDENTITY, E2E_LIVE_PEER_IDENTITY and E2E_LIVE_OUTSIDER_IDENTITY), not on
// the Docker tier (#677). The peer is in the owner's circle; the outsider is a
// connection in no circle, so only a person share reaches them.

// The notes list's row, not the editor's tab of the same title.
function noteRow(page: Page, title: string) {
    return page.getByTestId('note-row').filter({ hasText: title });
}

const sharedWithMe = (page: Page) => page.getByRole('button', { name: /Shared with me/ });

/** "Refresh shared notes" runs the full shared pull, which also drops what is no longer shared. */
async function refreshShared(page: Page) {
    const refresh = page.getByRole('button', { name: 'Refresh shared notes' });
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
    await sharedWithMe(page).click();
}

async function expectInSharedWithMe(page: Page, title: string) {
    await expect(async () => {
        await refreshShared(page);
        await expect(noteRow(page, title)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 180_000 });
}

async function expectGoneFromSharedWithMe(page: Page, title: string) {
    await expect(async () => {
        await refreshShared(page);
        await expect(noteRow(page, title)).toHaveCount(0, { timeout: 5_000 });
    }).toPass({ timeout: 180_000 });
}

/** Presses Tab until `target` has focus: the keyboard-only way to reach a control. */
async function tabTo(page: Page, target: ReturnType<Page['locator']>) {
    for (let i = 0; i < 12; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
}

const header = (page: Page, docId: string) => page.evaluate((id) => window.__journalE2E!.noteHeader(id), docId);

test.describe.configure({ mode: 'serial' });

const stamp = Date.now();

test('a note shared with the outsider to view reaches only them, read-only, and nobody can patch it', async ({ liveRun, liveSharing }) => {
    // Three identities, every hand-off crosses two Homebase hosts, and a refused patch needs a minute to show.
    test.setTimeout(600_000);
    const { owner, peer, outsider } = liveSharing;
    const title = `Person share ${stamp}`;
    const body = `Shared body ${stamp}`;

    // 1. The owner shares a new note with the outsider only, keyboard only, on a 375px phone.
    await createNote(owner.page, { title, body });
    const docId = new URL(owner.page.url()).pathname.split('/').pop()!;
    await openShareDialog(owner.page, title);
    const desktop = owner.page.viewportSize()!;
    await owner.page.setViewportSize({ width: 375, height: 812 });
    const dialog = shareDialog(owner.page);
    await expect(dialog).toBeVisible();
    const field = dialog.getByLabel('Add people or circles');
    const addPersonByKeyboard = async () => {
        await tabTo(owner.page, field);
        await owner.page.keyboard.type(outsider.identity);
        await expect(dialog.getByRole('option').filter({ hasText: outsider.identity })).toBeVisible({ timeout: 30_000 });
        await owner.page.keyboard.press('Enter');
        await expect(shareRole(owner.page, outsider.identity)).toBeVisible();
    };
    await addPersonByKeyboard();
    // Remove them from their role menu: Editor is disabled for a person, so one ArrowDown is Remove
    await tabTo(owner.page, shareRole(owner.page, outsider.identity));
    await owner.page.keyboard.press('ArrowDown');
    await expect(shareRole(owner.page, outsider.identity)).toHaveCount(0);
    await addPersonByKeyboard();
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth), 'the sheet scrolls sideways').toBeLessThanOrEqual(0);
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth), 'the page scrolls sideways').toBeLessThanOrEqual(375);
    await screenshotInBothThemes(owner.page, (theme) => `person-share-dialog-${theme}-375.png`);
    await owner.page.setViewportSize(desktop);
    await screenshotInBothThemes(owner.page, (theme) => `person-share-dialog-${theme}.png`);
    await saveShare(owner.page);

    // 2. The outsider finds it under "Shared with me" and opens it read-only.
    await expectInSharedWithMe(outsider.page, title);
    await noteRow(outsider.page, title).click();
    const editor = activeEditor(outsider.page);
    await expect(editor).toContainText(body, { timeout: 30_000 });
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await expect(outsider.page.getByText('View only', { exact: true }).locator('visible=true').first()).toBeVisible();
    await screenshotInBothThemes(outsider.page, (theme) => `person-share-viewer-note-${theme}.png`);

    // 3. The peer is in the owner's circle but not named: their pull doesn't find it.
    await refreshShared(peer.page);
    await expect(noteRow(peer.page, title)).toHaveCount(0);

    // 4. Security check. The peer has Read and Write on the owner's Journal drive from
    // the share circle, so only the note's ACL keeps them out; the outsider has Read
    // only, from journal-viewers. Both are refused a patch; the peer a read too.
    const before = await header(owner.page, docId);
    expect(before?.globalTransitId, 'the note has a globalTransitId to address a peer update by').toBeTruthy();
    expect(before?.acl?.odinIdList).toEqual([outsider.identity]);
    const probe = (page: Page) => page.evaluate(
        ([author, id, globalTransitId, versionTag]) =>
            window.__journalE2E!.probePeerNote(author, id, globalTransitId, versionTag),
        [owner.identity, docId, before!.globalTransitId!, before!.versionTag] as const,
    );
    // A peer update goes through the sender's own outbox, so its answer is "enqueued";
    // the owner's server accepts or refuses it later, host to host.
    const peerProbe = await probe(peer.page);
    const outsiderProbe = await probe(outsider.page);
    test.info().annotations.push(
        { type: 'security check (peer, not named)', description: JSON.stringify(peerProbe) },
        { type: 'security check (outsider, viewer)', description: JSON.stringify(outsiderProbe) },
    );
    expect(peerProbe.read, 'the peer reads the note').not.toBe('read');
    expect(outsiderProbe.read, 'the outsider reads the note').toBe('read');
    // A member's peer update lands within seconds (circle-share.live.spec.ts step 3);
    // nothing signals a refused one, so wait a minute, then check the note is unchanged.
    await owner.page.waitForTimeout(60_000);
    const after = await header(owner.page, docId);
    test.info().annotations.push({ type: 'owner ACL after the probes', description: JSON.stringify(after?.acl) });
    expect(after?.versionTag, 'a patch went through').toBe(before!.versionTag);
    expect(after?.acl?.odinIdList, 'the stored ACL lost odinIdList').toEqual([outsider.identity]);

    // 5. Stopping the share takes it out of the outsider's list after a sync.
    await selectFolder(owner.page, liveRun.folderName);
    await stopSharing(owner.page, title);
    await expectGoneFromSharedWithMe(outsider.page, title);
});

test('the outsider added to view a circle share reaches it, and only the circle edits', async ({ liveRun, liveSharing }) => {
    test.setTimeout(600_000);
    const { owner, peer, outsider, circleName } = liveSharing;
    const title = `Circle and person share ${stamp}`;
    const peerSentence = ` Peer was here ${stamp}.`;

    // 1. The owner shares a new note with the circle (Editor), then adds the outsider as a Viewer.
    await createNote(owner.page, { title, body: `Shared body ${stamp}` });
    const notePath = new URL(owner.page.url()).pathname;
    const docId = notePath.split('/').pop()!;
    await openShareDialog(owner.page, title);
    await addToShare(owner.page, circleName);
    await expect(shareRole(owner.page, circleName)).toHaveValue('editor');
    await saveShare(owner.page);
    await openShareDialog(owner.page, title);
    await addToShare(owner.page, outsider.identity, 'Viewer');
    await saveShare(owner.page);

    // 2. Both get it: the peer can edit, the outsider can't.
    await expectInSharedWithMe(peer.page, title);
    await expectInSharedWithMe(outsider.page, title);
    await noteRow(outsider.page, title).click();
    await expect(activeEditor(outsider.page)).toHaveAttribute('contenteditable', 'false', { timeout: 30_000 });
    await noteRow(peer.page, title).click();
    await expect(activeEditor(peer.page)).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 });
    await typeInEditor(peer.page, peerSentence);

    // 3. The peer's update replaces the stored ACL with one without odinIdList
    // (odin-core#2002); the owner's next pull puts the outsider back.
    await owner.page.goto(notePath);
    await assertTestOrigin(owner.page);
    await expect(async () => {
        await owner.page.reload();
        await waitForAppReady(owner.page);
        await expect(activeEditor(owner.page)).toContainText(peerSentence.trim(), { timeout: 5_000 });
        expect((await header(owner.page, docId))?.acl?.odinIdList).toEqual([outsider.identity]);
    }).toPass({ timeout: 180_000 });

    // 4. Taking the outsider off and keeping the circle: the outsider's list drops it, the peer keeps it.
    await selectFolder(owner.page, liveRun.folderName);
    await openShareDialog(owner.page, title);
    await shareRole(owner.page, outsider.identity).selectOption('remove');
    await expect(shareRole(owner.page, circleName)).toBeVisible();
    await saveShare(owner.page);
    await expectGoneFromSharedWithMe(outsider.page, title);
    await expectInSharedWithMe(peer.page, title);

    // Clean up: stop sharing, so the peer's list doesn't grow run after run.
    await stopSharing(owner.page, title);
});

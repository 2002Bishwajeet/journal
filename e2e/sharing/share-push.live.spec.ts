import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, activeEditor, screenshotInBothThemes, selectFolder } from '../support/actions';
import { addToShare, openShareDialog, saveShare } from '../support/shareDialog';

// #745: the owner's share sends a peer push; the peer's app pulls that owner and shows
// the note under "Shared with me". Docker tier only, like shared-pull.live.spec.ts.

// src/lib/homebase/config.ts's JOURNAL_PUSH_TYPE_SHARE
const JOURNAL_PUSH_TYPE_SHARE = '8f2d6b13-5c7a-4e90-b4d8-2a1e9c6f0b57';

function noteRow(page: Page, title: string) {
    return page.getByTestId('note-row').filter({ hasText: title });
}

const sharedWithMe = (page: Page) => page.getByRole('button', { name: /Shared with me/ });

const stamp = Date.now();
const title = `Pushed share ${stamp}`;
const body = `Pushed body ${stamp}`;

test('a share push lands in the peer\'s notification list and brings the note to "Shared with me"', async ({ liveRun, liveSharing }) => {
    test.setTimeout(300_000);
    const { owner, peer, circleName } = liveSharing;

    // The peer subscribes to the owner's Journal peer push (#743), and until its page
    // reloads its app drops incoming invites: only the pull can bring the note.
    await peer.page.evaluate((odinId) => window.__journalE2E!.subscribePeerPush(odinId), owner.identity);
    await peer.page.evaluate(() => window.__journalE2E!.ignoreInvites());

    await createNote(owner.page, { title, body });
    const noteId = new URL(owner.page.url()).pathname.split('/').pop()!;
    await openShareDialog(owner.page, title);
    await addToShare(owner.page, circleName);
    await saveShare(owner.page);

    // The peer's server stored one Journal SHARE entry for this note, sent by the owner.
    let entries: Awaited<ReturnType<NonNullable<Window['__journalE2E']>['journalNotifications']>> = [];
    await expect(async () => {
        entries = (await peer.page.evaluate(() => window.__journalE2E!.journalNotifications()))
            .filter((n) => n.typeId === JOURNAL_PUSH_TYPE_SHARE && n.tagId === noteId);
        expect(entries).toHaveLength(1);
    }).toPass({ timeout: 120_000 });
    expect(entries[0].senderId).toBe(owner.identity);

    // Playwright's browser has no push service, so hand the open app the message the
    // service worker relays for this push (sw.ts, #744), built from the stored entry.
    await peer.page.evaluate(({ senderId, typeId, tagId }) => {
        navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
            data: { type: 'journal-push', payload: { senderId, options: { typeId, tagId } } },
        }));
    }, entries[0]);

    // No reload and no "Refresh": the pull of that one owner brings the note.
    await sharedWithMe(peer.page).click();
    await expect(noteRow(peer.page, title)).toBeVisible({ timeout: 60_000 });
    await noteRow(peer.page, title).click();
    await expect(activeEditor(peer.page)).toContainText(body, { timeout: 30_000 });
    await screenshotInBothThemes(peer.page, (theme) => `share-push-peer-note-${theme}.png`);

    // liveRun's page is shared with the specs that run after this one.
    await selectFolder(owner.page, liveRun.folderName);
});

import type { Page } from '@playwright/test';
import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { addToShare, openShareDialog, saveShare, shareDialog, stopSharing } from '../support/shareDialog';

// #1002 against a real odin-core (Docker tier: the liveSharing fixture needs the peer
// and outsider identities ci-bootstrap.ts sets up). Records what the author's guest
// API answers for a note that isn't public, for each kind of viewer and for a missing
// note, and that the share route turns each answer into the right page: the circle
// member lands on the note, the outsider and a signed-out visitor see no access.

const HEADER_PATH = '/api/guest/v1/drive/query/specialized/cuid/header';
const MISSING_ID = '0b8e4c27-5d1a-4f93-a6e2-7c3d9f1b5e40';
// JOURNAL_DRIVE (src/lib/homebase/config.ts), not imported: that module pulls in the SDK.
const JOURNAL_DRIVE = { alias: 'd5f411fa83fd4854a3bd7e974cc9bca9', type: '30743710039d4b97bbd352f343d1c9df' };

const headerUrl = (uniqueId: string) =>
  `${liveIdentityOrigin()}${HEADER_PATH}?${new URLSearchParams({ alias: JOURNAL_DRIVE.alias, type: JOURNAL_DRIVE.type, clientUniqueId: uniqueId })}`;

/** Lets `page` make the author's guest drive reads, which its fence blocks by default, and returns the header read's status. */
async function guestHeaderStatus(page: Page, docId: string, open: () => Promise<unknown>): Promise<number> {
  const owner = new URL(liveIdentityOrigin()).host;
  await page.context().route(`https://${owner}/api/guest/v1/drive/**`, (route) => route.continue());
  const response = page.waitForResponse((r) => r.url().includes(HEADER_PATH) && r.url().includes(docId));
  await open();
  return (await response).status();
}

function record(name: string, status: number) {
  test.info().annotations.push({ type: `odin-core status: ${name}`, description: String(status) });
  console.log(`[#1002] odin-core guest header read, ${name}: ${status}`);
}

test('a restricted note\'s link opens for a recipient and says no access to anyone else', async ({ liveSharing, browser, playwright }) => {
  test.setTimeout(360_000);
  const { owner, peer, outsider, circleName } = liveSharing;
  const stamp = Date.now();
  const title = `Restricted link ${stamp}`;
  const body = `Only for the circle ${stamp}`;

  // 1. The owner shares a note with the circle and copies its link from the Share dialog.
  await createNote(owner.page, { title, body });
  const docId = new URL(owner.page.url()).pathname.split('/').pop()!;
  await openShareDialog(owner.page, title);
  await addToShare(owner.page, circleName);
  await saveShare(owner.page);
  await owner.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openShareDialog(owner.page, title);
  await shareDialog(owner.page).getByRole('button', { name: 'Copy link' }).click();
  const link = new URL(await owner.page.evaluate(() => navigator.clipboard.readText()));
  expect(link.pathname).toBe(`/share/${owner.identity}/${docId}`);
  await owner.page.keyboard.press('Escape');

  // 2. What odin-core answers an anonymous read: the restricted note, and a missing one.
  const anon = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  try {
    await expect.poll(async () => (await anon.get(headerUrl(docId))).status(), { timeout: 60_000 }).toBe(403);
    record('anonymous, restricted note', 403);
    const missing = (await anon.get(headerUrl(MISSING_ID))).status();
    record('anonymous, missing note', missing);
    expect(missing).toBe(404);
  } finally {
    await anon.dispose();
  }

  // 3. The outsider (signed in, connected, not a recipient) sees no access.
  const outsiderStatus = await guestHeaderStatus(outsider.page, docId, () => outsider.page.goto(link.pathname));
  record('signed-in non-recipient, restricted note', outsiderStatus);
  expect(outsiderStatus).toBe(403);
  await expect(outsider.page.getByRole('heading', { level: 1, name: "You don't have access to this note" })).toBeVisible({ timeout: 90_000 });
  await expect(outsider.page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);

  // 4. The circle member lands on the note in their Journal, pulling it first if needed.
  const peerStatus = await guestHeaderStatus(peer.page, docId, () => peer.page.goto(link.pathname));
  record('signed-in recipient, restricted note', peerStatus);
  await expect(peer.page).toHaveURL(new RegExp(`/${docId}$`), { timeout: 90_000 });
  await expect(activeEditor(peer.page)).toContainText(body, { timeout: 60_000 });

  // 5. A signed-out visitor sees no access, with Sign in.
  await withFencedPage(browser, {}, async (anonPage) => {
    await anonPage.goto(link.pathname);
    await assertTestOrigin(anonPage);
    await expect(anonPage.getByRole('heading', { level: 1, name: "You don't have access to this note" })).toBeVisible({ timeout: 30_000 });
    await expect(anonPage.getByRole('link', { name: 'Sign in' })).toBeVisible();
  }, [liveIdentityOrigin()]);

  await stopSharing(owner.page, title);
});

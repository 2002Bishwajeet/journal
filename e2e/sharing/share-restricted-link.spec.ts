import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeTitleInput, createNote, screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { openShareDialog, shareDialog } from '../support/shareDialog';

// #1002: one link for a note, whatever its general access. The share route picks its page
// from the guest read's status: a 403 (the note exists, this viewer can't read it) is
// "You don't have access", a 404 is "Note not found", and a signed-in viewer who has the
// note (their own, or a peer copy under the owner's uniqueId) lands on it in the app.
// Backend-free: guest reads are canned per test; the real statuses are checked against
// odin-core in share-restricted-link.live.spec.ts.

const AUTHOR = 'e2e-author.homebase.test';
const RESTRICTED_ID = '7c2e9a41-5b3d-4f86-a0e1-3d9b6f2c8a57';
const MISSING_ID = '0b8e4c27-5d1a-4f93-a6e2-7c3d9f1b5e40';

/** Answers every *.homebase.test guest read with `status`, as odin-core does for that case. */
async function guestReadsAnswer(page: Page, status: 403 | 404): Promise<void> {
  // A page route takes precedence over the fence's context route.
  await page.route('https://*.homebase.test/api/guest/v1/drive/**', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: '{}',
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
    }),
  );
}

/** Light and dark shots of a page that reads the theme at load: reloaded in each scheme until `heading` shows. */
async function shootThemes(page: Page, name: string, heading: ReturnType<Page['getByRole']>): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await expect(heading).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: test.info().outputPath(`${name}-${theme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
}

const noAccess = (page: Page) => page.getByRole('heading', { level: 1, name: "You don't have access to this note" });

test('a signed-out visitor sees no access with Sign in, or not found for a missing note', async ({ anonPage }) => {
  await guestReadsAnswer(anonPage, 403);
  await anonPage.goto(`/share/${AUTHOR}/${RESTRICTED_ID}`);
  await assertTestOrigin(anonPage);
  await expect(noAccess(anonPage)).toBeVisible({ timeout: 15_000 });
  const signIn = anonPage.getByRole('link', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  await shootThemes(anonPage, 'share-no-access-signed-out', noAccess(anonPage));

  // Signing in returns to the in-app route that opens the note for a recipient.
  await signIn.click();
  await expect(anonPage).toHaveURL(/\/welcome\?returnUrl=/);
  const returnUrl = new URL(anonPage.url()).searchParams.get('returnUrl');
  expect(returnUrl).toBe(`/open-shared?identity=${AUTHOR}&file=${RESTRICTED_ID}`);

  await anonPage.unrouteAll();
  await guestReadsAnswer(anonPage, 404);
  await anonPage.goto(`/share/${AUTHOR}/${MISSING_ID}`);
  await expect(anonPage.getByRole('heading', { level: 1, name: 'Note not found' })).toBeVisible({ timeout: 15_000 });
  await expect(anonPage.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await shootThemes(anonPage, 'share-not-found', anonPage.getByRole('heading', { level: 1, name: 'Note not found' }));
});

test('a signed-in viewer without the note sees no access, with no Sign in', async ({ app }) => {
  await guestReadsAnswer(app, 403);
  await app.goto(`/share/${AUTHOR}/${RESTRICTED_ID}`);
  await assertTestOrigin(app);
  // The pull from the author finds nothing (there is no backend), so: no access.
  await expect(noAccess(app)).toBeVisible({ timeout: 30_000 });
  await expect(app).toHaveURL(/\/open-shared\?/);
  await expect(app.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await shootThemes(app, 'share-no-access-signed-in', noAccess(app));
});

test('the Share dialog copies a restricted note\'s link, and a viewer who has the note lands on it', async ({ app }) => {
  test.setTimeout(90_000);
  await assertTestOrigin(app);
  await app.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const title = `Restricted link ${Date.now()}`;
  await createNote(app, { title, body: 'Only for the people it is shared with.' });
  const notePath = new URL(app.url()).pathname;
  const docId = notePath.split('/').pop()!;

  await openShareDialog(app, title);
  const dialog = shareDialog(app);
  await expect(dialog.getByText('Restricted (only people with access)')).toBeVisible();
  await expect(dialog.getByText('Only people with access can open this link.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `share-dialog-restricted-copy-link-${theme}.png`);
  const link = new URL(await app.evaluate(() => navigator.clipboard.readText()));
  expect(link.origin).toBe(new URL(app.url()).origin);
  expect(link.pathname).toMatch(new RegExp(`^/share/[^/]+/${docId}$`));
  await app.keyboard.press('Escape');

  // The note is not public (403), and this Journal has it: the link opens it here.
  await guestReadsAnswer(app, 403);
  await app.goto(link.pathname);
  await expect(app).toHaveURL(new RegExp(`${notePath}$`), { timeout: 30_000 });
  await expect(activeTitleInput(app)).toHaveValue(title);
});

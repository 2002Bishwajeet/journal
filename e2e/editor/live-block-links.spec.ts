import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, inBothThemes, openNote, pastePlainText, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #975: an html block runs as soon as a note opens, also in a note shared with you. A link from
// a block you may not have written shows where it goes before it opens, and the block's frame
// has an edge, so a fake sign-in form in it does not pass as the app's own.

const LINK = 'https://example.com/collect?user=me&pw=hunter2';
const FAKE_SIGN_IN =
  '<style>body{font-family:system-ui;margin:16px}</style><h2>Session expired</h2><p>Sign in again to keep editing.</p>' +
  `<a href="${LINK}">Sign in</a>`;
const AUTHOR = 'e2e-author.homebase.test';

const block = (app: Page) => activeEditor(app).locator('[data-live-block="html"]');
const frame = (app: Page) => block(app).locator('iframe').contentFrame();
const heading = (app: Page) => frame(app).getByRole('heading', { name: 'Session expired' });

/** Screenshots `target` with a little of the page around it, or the whole page. */
async function shoot(app: Page, name: string, target?: Locator): Promise<void> {
  const box = target && (await target.boundingBox());
  const margin = 24;
  await app.screenshot({
    path: test.info().outputPath(name),
    clip: box ? { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin } : undefined,
  });
}

/** Closes the note's tab, so its editor unmounts, and opens it again from the note list. */
async function reopenNote(app: Page, title: string): Promise<void> {
  const main = app.locator('#main-content');
  await main.getByRole('button', { name: `Close ${title}`, exact: true }).click();
  await expect(main.locator('.ProseMirror')).toHaveCount(0);
  await openNote(app, title);
  await expect(activeEditor(app)).toBeVisible();
  await expect(block(app)).toBeVisible();
}

test('html block: in a note shared with you it runs without a click, and its link shows the URL before it opens', async ({ app }) => {
  // Two openings, two viewports and eight screenshots: past the 30 s default on a loaded machine.
  test.setTimeout(90_000);
  await assertTestOrigin(app);
  // Answered here, so the new tab never meets the fixture's network fence.
  await app.context().route(LINK, (route) => route.fulfill({ contentType: 'text/html', body: 'linked page' }));
  const title = `Block links ${Date.now()}`;
  await createNote(app, { title, body: 'Intro' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```html\n' + FAKE_SIGN_IN + '\n```');

  // The owner's own note: no edge.
  await expect(heading(app)).toBeVisible();
  await expect(block(app)).not.toHaveAttribute('data-live-block-untrusted');
  await waitForNoteSaved(app);

  const { docId } = (await app.evaluate(() => window.__journalE2E!.openNoteJSON()))!;
  await app.evaluate(([id, author]) => window.__journalE2E!.markSharedWithMe(id, author), [docId, AUTHOR] as const);
  // Opened again, not reloaded: a boot sync pull of the owner's own copy on the fake drive
  // would write the note's author back.
  await reopenNote(app, title);
  // The note now reads as shared with this identity: a peer note has no version history.
  await expect(app.getByRole('button', { name: 'Version history' })).toHaveCount(0);

  // It runs with no click, and no Run button is there; its frame has an edge.
  await expect(heading(app)).toBeVisible();
  await expect(block(app).getByRole('button', { name: /^Run / })).toHaveCount(0);
  await expect(block(app)).toHaveAttribute('data-live-block-untrusted', '');
  const sheet = app.getByRole('dialog', { name: 'Open this link?' });

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    await app.setViewportSize(viewport);
    await expect(heading(app)).toBeVisible();
    await inBothThemes(app, (theme) => shoot(app, `block-edge-${theme}-${viewport.name}.png`, block(app)));

    // The user's click on the block's link: no tab yet, but the host and the whole URL.
    await frame(app).getByRole('link', { name: 'Sign in' }).click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('example.com');
    await expect(sheet).toContainText(LINK);
    await expect(sheet.getByText('pw=hunter2', { exact: false })).toBeVisible();
    for (const name of ['Cancel', 'Open link']) {
      const box = (await sheet.getByRole('button', { name }).boundingBox())!;
      // A touch target on the phone; a desktop with a mouse keeps the 36px button.
      expect(box.height).toBeGreaterThanOrEqual(viewport.name === 'mobile' ? 44 : 36);
    }
    await inBothThemes(app, async (theme) => {
      await expect(sheet).toBeVisible();
      await shoot(app, `link-confirm-${theme}-${viewport.name}.png`);
    });

    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toHaveCount(0);
    expect(app.context().pages()).toHaveLength(1);
  }

  // Open link opens it in a new tab, and the block's page stays.
  await frame(app).getByRole('link', { name: 'Sign in' }).click();
  const [tab] = await Promise.all([app.context().waitForEvent('page'), sheet.getByRole('button', { name: 'Open link' }).click()]);
  await expect(tab).toHaveURL(LINK);
  await tab.close();
  await expect(sheet).toHaveCount(0);
  await expect(heading(app)).toBeVisible();
});

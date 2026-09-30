import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #173: pasting a lone URL on an empty line inserts a link preview card.
// The SDK's extract endpoint (on the fake *.homebase.test identity, which the
// network fence would otherwise abort) is answered here with canned metadata.

const URL_TO_PASTE = 'https://example.com/article';
const TITLE = 'An example article';
const DESCRIPTION = 'A short description of the article.';
const IMAGE = `data:image/png;base64,${readFileSync('public/apple-touch-icon.png').toString('base64')}`;

/** Answers the SDK's link extract call; returns a counter of calls seen. */
async function mockExtract(page: Page): Promise<{ calls: number }> {
  const seen = { calls: 0 };
  // A page route takes precedence over the fence's context route.
  await page.route('**/api/apps/v1/utils/links/extract*', (route) => {
    seen.calls++;
    return route.fulfill({
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      body: JSON.stringify({ title: TITLE, description: DESCRIPTION, imageUrl: IMAGE, imageWidth: 180, imageHeight: 180, url: URL_TO_PASTE }),
    });
  });
  return seen;
}

/** Pastes `text` as plain text into the active editor at the cursor. */
async function pasteText(page: Page, text: string): Promise<void> {
  await activeEditor(page).evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Creates a note with an intro line and leaves the cursor on an empty line below it. */
async function noteWithEmptyLine(page: Page, title: string): Promise<void> {
  await createNote(page, { title, body: 'Intro line' });
  await page.keyboard.press('Enter');
}

test('paste a URL → card → convert to link → undo brings the card back', async ({ app }, testInfo) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  const extract = await mockExtract(app);
  await noteWithEmptyLine(app, `Link preview ${Date.now()}`);

  await pasteText(app, URL_TO_PASTE);

  const card = activeEditor(app).locator('[data-link-preview]');
  await expect(card).toContainText(TITLE);
  await expect(card).toContainText(DESCRIPTION);
  await expect(card).toContainText('example.com');
  await expect(card.locator('img')).toBeVisible();
  expect(extract.calls).toBe(1);
  await testInfo.attach('ready card (desktop)', { body: await app.screenshot(), contentType: 'image/png' });


  // y-prosemirror's UndoManager merges changes less than 500 ms apart into one
  // undo step, so an immediate convert would be undone together with the paste.
  // No DOM signal marks the end of that window; wait it out like a user would.
  await app.waitForTimeout(600);
  await card.getByRole('button', { name: 'Convert to link' }).click();
  await expect(card).toHaveCount(0);
  const link = activeEditor(app).getByRole('link', { name: TITLE });
  await expect(link).toHaveAttribute('href', URL_TO_PASTE);
  await testInfo.attach('converted to link', { body: await app.screenshot(), contentType: 'image/png' });

  await app.keyboard.press('ControlOrMeta+z');
  await expect(card).toContainText(TITLE);
  await expect(link).toHaveCount(0);
});

test('offline paste shows an offline card that fills in once online', async ({ app }, testInfo) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  const extract = await mockExtract(app);
  await noteWithEmptyLine(app, `Offline preview ${Date.now()}`);

  await app.context().setOffline(true);
  await pasteText(app, URL_TO_PASTE);

  const card = activeEditor(app).locator('[data-link-preview]');
  await expect(card).toContainText("Preview will load when you're online");
  await expect(card).toContainText(URL_TO_PASTE);
  // The search/preview text carries the URL, so seeing it in the note list
  // means the card has been written locally.
  await expect(app.getByRole('button').filter({ hasText: URL_TO_PASTE }).first()).toBeVisible();
  expect(extract.calls).toBe(0);
  await testInfo.attach('offline card', { body: await app.screenshot(), contentType: 'image/png' });

  await app.context().setOffline(false);
  await app.reload();
  await waitForAppReady(app);

  const reopened = activeEditor(app).locator('[data-link-preview]');
  await expect(reopened).toContainText(TITLE);
  await expect(reopened.locator('img')).toBeVisible();
  expect(extract.calls).toBe(1);
  await testInfo.attach('filled-in card after going online', { body: await app.screenshot(), contentType: 'image/png' });

  // The mobile layout remounts the editor, so wait for the card to come back.
  await app.setViewportSize({ width: 375, height: 800 });
  await expect(app.getByText('Loading document...')).toBeHidden();
  await expect(activeEditor(app).locator('[data-link-preview]')).toContainText(TITLE);
  expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await testInfo.attach('ready card (375 px)', { body: await app.screenshot(), contentType: 'image/png' });
});

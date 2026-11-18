import { test, expect } from '../fixtures';
import { createNote, pasteHtml } from '../support/actions';

// Find brings the current match into view when typing and on next/previous, also with one result (#1417).

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>Filler paragraph number ${i + 1} with some ordinary words.</p>`).join('');

test('typing in Find and Enter on "1 of 1" bring a far match into view', async ({ app }) => {
  await createNote(app, { title: 'Long note', body: 'start' });
  await pasteHtml(app, filler(80) + '<p>The zorbleflux sits at the very end.</p>');

  await app.keyboard.press('ControlOrMeta+f');
  const find = app.getByRole('textbox', { name: 'Find in note' });
  await find.fill('zorbleflux');
  await expect(app.getByRole('search').getByText('1 of 1')).toBeVisible();
  await expect(app.locator('.search-highlight-current:visible')).toBeInViewport();

  // Scroll the note back to the top, then Enter brings the only match back.
  await app.locator('.search-highlight-current:visible').evaluate((el) => {
    el.closest('[data-note-scroller]')!.scrollTop = 0;
  });
  await expect(app.locator('.search-highlight-current:visible')).not.toBeInViewport();
  await find.press('Enter');
  await expect(app.locator('.search-highlight-current:visible')).toBeInViewport();
});

test('a match inside a closed toggle opens it', async ({ app }) => {
  await createNote(app, { title: 'Toggle note', body: 'start' });
  await pasteHtml(app, '<div data-type="toggle" data-summary="Hidden"><p>The quuxplorg is inside.</p></div>');

  const toggle = app.locator('[data-type="toggle"]').first();
  await toggle.getByRole('button', { name: 'Collapse' }).click();
  await expect(toggle.getByRole('button', { name: 'Expand' })).toBeVisible();

  await app.keyboard.press('ControlOrMeta+f');
  await app.getByRole('textbox', { name: 'Find in note' }).fill('quuxplorg');
  await expect(toggle.getByRole('button', { name: 'Collapse' })).toBeVisible();
  await expect(app.locator('.search-highlight-current:visible')).toBeInViewport();
});

test('a match at the end of a long code line scrolls sideways into view', async ({ app }) => {
  await createNote(app, { title: 'Code note', body: 'start' });
  const longLine = 'const padding = "' + 'x'.repeat(600) + '"; // glimmerzonk';
  await pasteHtml(app, `<pre><code>${longLine}</code></pre>`);

  await app.keyboard.press('ControlOrMeta+f');
  await app.getByRole('textbox', { name: 'Find in note' }).fill('glimmerzonk');
  await expect(app.getByRole('search').getByText('1 of 1')).toBeVisible();
  await expect(app.locator('.search-highlight-current:visible')).toBeInViewport();
});

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';

// Pasting markup or a fenced block into an empty paragraph makes a live block,
// instead of leaving the source as literal text.

async function noteWithEmptyLine(app: Page, title: string) {
  await createNote(app, { title: `${title} ${Date.now()}`, body: 'Intro' });
  await app.keyboard.press('Enter');
}

test('pasting bare html into an empty paragraph previews it as an html block', async ({ app }) => {
  await noteWithEmptyLine(app, 'Paste html');
  await pastePlainText(app, '<div style="padding:16px">\n  <h2>Hello</h2>\n  <p>From a div</p>\n</div>');

  const frame = activeEditor(app).frameLocator('iframe[title="HTML preview"]');
  await expect(frame.locator('h2')).toHaveText('Hello');
  // The source lives in the block's (hidden) code view, not in a paragraph of literal text.
  await expect(activeEditor(app).locator('p', { hasText: '<div' })).toHaveCount(0);
  await app.screenshot({ path: test.info().outputPath('paste-html.png') });
});

test('pasting a fenced mermaid block previews the diagram', async ({ app }) => {
  await noteWithEmptyLine(app, 'Paste fence');
  await pastePlainText(app, '```mermaid\ngraph TD; A-->B\n```');

  await expect(activeEditor(app).locator('[data-live-block="mermaid"] svg').first()).toBeVisible();
  await expect(activeEditor(app)).not.toContainText('```');
});

test('pasting markup into a paragraph that already has text stays text', async ({ app }) => {
  await createNote(app, { title: `Paste inline ${Date.now()}`, body: 'See ' });
  await pastePlainText(app, '<div>literal</div>');

  await expect(activeEditor(app)).toContainText('See <div>literal</div>');
  await expect(activeEditor(app).locator('iframe')).toHaveCount(0);
});

test('a blockquote uses the body font, upright', async ({ app }) => {
  await createNote(app, { title: `Quote ${Date.now()}`, body: '> Status. Experimental, with `inline code` inside the quote.' });

  const quote = activeEditor(app).locator('blockquote');
  await expect(quote).toHaveCSS('font-style', 'normal');
  const fonts = await quote.evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el.parentElement!).fontFamily]);
  expect(fonts[0]).toBe(fonts[1]);
  await app.screenshot({ path: test.info().outputPath('blockquote.png') });
});

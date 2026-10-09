import { writeFileSync } from 'node:fs';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, createNote, openNote } from '../support/actions';

// #561: a note link and a link preview card written as markdown (the syntax the MCP tools
// use) render as a note link and a card. Markdown import goes through the same parser as
// the agent edit engine, so it brings that markdown into the app without a backend.

const PREVIEW_URL = 'https://example.com/article';
const PREVIEW_TITLE = 'An example article';

test('markdown note link opens its target, and a preview line renders as a card', async ({ app }, testInfo) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  // The SDK's link extract call, on the fake identity the network fence would otherwise abort.
  await app.route('**/api/apps/v1/utils/links/extract*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': new URL(app.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      body: JSON.stringify({ title: PREVIEW_TITLE, description: 'A short description.', url: PREVIEW_URL }),
    })
  );

  const target = `Link target ${Date.now()}`;
  await createNote(app, { title: target, body: 'The target note.' });
  const targetUrl = app.url();
  const targetId = new URL(targetUrl).pathname.split('/').pop();

  const linker = `Linker ${Date.now()}`;
  const file = testInfo.outputPath(`${linker}.md`);
  writeFileSync(file, `Go to [the target](journal:note/${targetId}) now.\n\n<${PREVIEW_URL}><!-- preview -->\n`);

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data' }).click();
  await dialog.locator('input[type="file"][accept=".md,.zip"]').setInputFiles(file);
  await expect(app.getByText('Successfully imported 1 notes')).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await openNote(app, linker);
  await expect(activeTitleInput(app)).toHaveValue(linker);
  const card = activeEditor(app).locator('[data-link-preview]');
  await expect(card).toContainText(PREVIEW_TITLE);
  // The link shows the target's live title, not the label in the markdown.
  const link = activeEditor(app).locator(`button.note-link[data-note-id="${targetId}"]`);
  await expect(link).toHaveText(target);
  await testInfo.attach('note link and card from markdown', { body: await app.screenshot(), contentType: 'image/png' });

  await link.click();
  await expect(app).toHaveURL(targetUrl);
  await expect(activeTitleInput(app)).toHaveValue(target);
});

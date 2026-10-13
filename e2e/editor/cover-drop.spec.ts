import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote } from '../support/actions';
import { makeSolidPng } from '../support/png';

// An image file dropped on the cover (or on the Add cover row) sets the cover.

/** Drags a file over `target` and drops it there, as the OS would. */
async function dropFile(page: Page, target: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, mimeType, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
      return dt;
    },
    { name: file.name, mimeType: file.mimeType, bytes: [...file.buffer] },
  );
  await target.dispatchEvent('dragover', { dataTransfer });
  return {
    drop: () => target.dispatchEvent('drop', { dataTransfer }),
  };
}

const coverSrc = (page: Page) => page.getByRole('img', { name: 'Note cover' }).locator('img').first().getAttribute('src');

test('dropping an image adds the cover, and dropping another replaces it', async ({ app }) => {
  await createNote(app, { title: `Cover drop ${Date.now()}`, body: 'Cover above.' });
  await assertTestOrigin(app);

  // No cover yet: the Add cover row takes the drop and shows where it will land.
  const addRow = app.getByRole('button', { name: 'Add cover' }).locator('..');
  const first = await dropFile(app, addRow, { name: 'red.png', mimeType: 'image/png', buffer: makeSolidPng(32, 32, [200, 40, 40]) });
  await expect(addRow.getByText('Drop image to add a cover')).toBeVisible();
  await addRow.screenshot({ path: test.info().outputPath('cover-drop-add-light-1280.png') });
  await first.drop();
  const cover = app.getByRole('img', { name: 'Note cover' });
  await expect(cover).toBeVisible();
  await expect.poll(() => coverSrc(app)).toMatch(/^blob:/);
  const before = await coverSrc(app);

  // With a cover: dropping on it replaces it.
  const band = cover.locator('..');
  const second = await dropFile(app, band, { name: 'blue.png', mimeType: 'image/png', buffer: makeSolidPng(32, 32, [40, 80, 200]) });
  await expect(band.getByText('Drop image to replace the cover')).toBeVisible();
  await band.screenshot({ path: test.info().outputPath('cover-drop-replace-light-1280.png') });
  await second.drop();
  await expect.poll(() => coverSrc(app)).not.toBe(before);
  await expect(band.getByText('Drop image to replace the cover')).toHaveCount(0);
});

test('dropping a file that is not an image leaves the cover alone and says why', async ({ app }) => {
  await createNote(app, { title: `Cover drop text ${Date.now()}`, body: 'No cover.' });
  await assertTestOrigin(app);

  const addRow = app.getByRole('button', { name: 'Add cover' }).locator('..');
  const text = await dropFile(app, addRow, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await text.drop();
  await expect(app.getByText('Drop an image file to use it as the cover.')).toBeVisible();
  await expect(app.getByRole('img', { name: 'Note cover' })).toHaveCount(0);
});

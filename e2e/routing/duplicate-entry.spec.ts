import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// Navigating to the path the app is already on must not push a history entry,
// or Back needs two presses to leave the note (#858).

const pathOf = (page: import('@playwright/test').Page) => new URL(page.url()).pathname;

test('tapping Today on today\'s note, then Back, leaves the note in one step', async ({ app }) => {
  await app.goto('/');
  // The Today button is behind the dailyNotes flag; the shortcut is not.
  await app.locator('#main-content').getByRole('heading', { level: 2 }).click();
  const today = { click: () => app.keyboard.press('Control+Shift+T') };
  await today.click();
  await expect.poll(() => pathOf(app).split('/').length).toBe(3);
  const notePath = pathOf(app);

  await today.click();
  // Let a (wrongly) pushed entry land before checking.
  await app.waitForTimeout(300);
  expect(pathOf(app)).toBe(notePath);

  await app.goBack();
  await expect.poll(() => pathOf(app)).not.toBe(notePath);
});

test('clicking the active tab does not add a history entry', async ({ app }) => {
  await createNote(app, { title: 'Dup tab', body: 'Body' });
  const notePath = pathOf(app);
  const idx = () => app.evaluate(() => (history.state as { idx?: number } | null)?.idx ?? 0);
  const before = await idx();

  await app.locator('#main-content').getByRole('button', { name: 'Dup tab', exact: true }).click();
  await app.waitForTimeout(300);

  expect(pathOf(app)).toBe(notePath);
  expect(await idx()).toBe(before);
});

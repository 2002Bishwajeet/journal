import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import type { Page } from '@playwright/test';

// #580: the emoji and slash menus accept spaces, rank the obvious match first,
// find aliases, and close (leaving Enter alone) when the text matches nothing.

const menuItems = (page: Page) => page.locator('[data-index]');
const highlighted = (page: Page) => menuItems(page).and(page.locator('.bg-accent'));

test('emoji menu: ":thumbs up" highlights 👍 and inserts it', async ({ app }) => {
  await createNote(app, { title: `Emoji search ${Date.now()}`, body: ':thumbs up' });
  await expect(highlighted(app)).toHaveText(/👍\s*thumbs up/i);
  await app.keyboard.press('Enter');
  await expect(menuItems(app)).toHaveCount(0);
  await expect(activeEditor(app).locator('p').first()).toHaveText(/^👍\s*$/);
});

test('emoji menu: ":lol" lists a laughing face in the top 3', async ({ app }) => {
  await createNote(app, { title: `Emoji lol ${Date.now()}`, body: ':lol' });
  await expect(menuItems(app).first()).toBeVisible();
  const top3 = (await menuItems(app).allTextContents()).slice(0, 3).join(' ');
  expect(top3).toMatch(/😂|🤣/);
});

test('slash menu: "/heading 4" highlights Heading 4 and inserts it', async ({ app }) => {
  await createNote(app, { title: `Slash search ${Date.now()}`, body: '/heading 4' });
  await expect(highlighted(app)).toContainText('Heading 4');
  await app.keyboard.press('Enter');
  await expect(menuItems(app)).toHaveCount(0);
  await app.keyboard.type('Sub-section');
  await expect(activeEditor(app).locator('h4')).toHaveText('Sub-section');
});

test('slash menu: aliases "/todo" and "/img" find Task List and Image', async ({ app }) => {
  await createNote(app, { title: `Slash alias ${Date.now()}`, body: '/todo' });
  await expect(highlighted(app)).toContainText('Task List');
  for (let n = 0; n < 4; n++) await app.keyboard.press('Backspace');
  await app.keyboard.type('img');
  await expect(highlighted(app)).toContainText('Image');
});

test('slash menu: "/ this is prose" closes the menu and Enter makes a new line', async ({ app }) => {
  await createNote(app, { title: `Slash prose ${Date.now()}`, body: '/ this is prose' });
  await expect(menuItems(app)).toHaveCount(0);
  await app.keyboard.press('Enter');
  await app.keyboard.type('next line');
  const paragraphs = activeEditor(app).locator('p');
  await expect(paragraphs.nth(0)).toHaveText('/ this is prose');
  await expect(paragraphs.nth(1)).toHaveText('next line');
});

test('emoji menu: ":" followed by prose closes the menu and Enter makes a new line', async ({ app }) => {
  await createNote(app, { title: `Emoji prose ${Date.now()}`, body: ':this is prose' });
  await expect(menuItems(app)).toHaveCount(0);
  await app.keyboard.press('Enter');
  await app.keyboard.type('next line');
  const paragraphs = activeEditor(app).locator('p');
  await expect(paragraphs.nth(0)).toHaveText(':this is prose');
  await expect(paragraphs.nth(1)).toHaveText('next line');
});

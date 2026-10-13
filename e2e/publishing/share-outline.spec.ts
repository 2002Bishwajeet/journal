import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #643: a shared note with 3+ h2-h4 headings gets an "On this page" panel (from xl) or an inline
// toggle (below xl); it jumps to a section, follows the reading position, can be hidden (remembered),
// and a note with fewer headings shows none. Canned guest reads on a *.homebase.test identity.

const AUTHOR = 'e2e-author.homebase.test';
const PUBLISHED = Date.UTC(2026, 9, 12, 9, 0);

type Block = ['h2' | 'h3' | 'h4', string] | ['p'];

function content(blocks: Block[]): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push(
    blocks.map((b, i) => {
      const el = new Y.XmlElement(b[0] === 'p' ? 'paragraph' : 'heading');
      if (b[0] !== 'p') el.setAttribute('level', b[0][1] as never);
      const text = b[0] === 'p' ? `Paragraph ${i}. A shared note is read by people who may never have heard of Journal, so the page around it should be quiet and finished.` : b[1];
      el.insert(0, [new Y.XmlText(text)]);
      return el;
    }),
  );
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

const fill = (n: number): Block[] => Array.from({ length: n }, () => ['p'] as Block);

const NOTES = {
  four: {
    noteId: '4a1d7c20-5b3e-4f86-9a12-c0e8d3b7f541',
    fileId: '4b2e8d31-6c4f-4097-8b23-d1f9e4c8a652',
    title: 'Four sections',
    body: content([['p'], ['h2', 'Intro'], ...fill(14), ['h3', 'Background'], ...fill(14), ['h2', 'Results'], ...fill(14), ['h3', 'Intro'], ...fill(20)]),
  },
  two: {
    noteId: '2a1d7c20-5b3e-4f86-9a12-c0e8d3b7f542',
    fileId: '2b2e8d31-6c4f-4097-8b23-d1f9e4c8a653',
    title: 'Two sections',
    body: content([['h2', 'One'], ...fill(10), ['h2', 'Two'], ...fill(10)]),
  },
  odd: {
    noteId: '3a1d7c20-5b3e-4f86-9a12-c0e8d3b7f543',
    fileId: '3b2e8d31-6c4f-4097-8b23-d1f9e4c8a654',
    title: 'Odd headings',
    body: content([['h2', 'Intro'], ['h2', 'Intro'], ['h4', '🚀'], ['h3', 'What’s new?']]),
  },
};

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const KEY = 'share.outlineHidden';

/** Screenshots in light and dark. The share page's theme class does not follow a live media change, so flip it directly. */
async function shots(page: Page, name: (theme: string) => string): Promise<void> {
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
    await page.evaluate((t) => document.documentElement.classList.remove('light', 'dark', t), theme);
    await page.evaluate((t) => document.documentElement.classList.add(t), theme);
    await page.waitForTimeout(400); // let the header's colour transition finish
    await page.screenshot({ path: test.info().outputPath(name(theme)) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'));
}

test.beforeEach(async ({ anonPage: page }) => {
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = route.request().url();
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    const note = Object.values(NOTES).find((n) => url.includes(n.noteId) || url.includes(n.fileId));
    if (!note) return route.fulfill({ status: 403, headers, contentType: 'application/json', body: '{}' });
    if (new URL(url).pathname.endsWith('/payload')) return route.fulfill({ contentType: 'application/octet-stream', headers, body: note.body });
    return route.fulfill({
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        fileId: note.fileId,
        fileSystemType: 'Standard',
        fileMetadata: {
          isEncrypted: false,
          updated: PUBLISHED,
          payloads: [{ key: 'jrnl_txt' }],
          appData: { uniqueId: note.noteId, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: note.title }) },
        },
      }),
    });
  });
});

async function open(page: Page, note: { noteId: string; title: string }, hash = ''): Promise<void> {
  await page.goto(`/share/${AUTHOR}/${note.noteId}${hash}`);
  await assertTestOrigin(page);
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: note.title })).toBeVisible({ timeout: 15_000 });
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'On this page' });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** The heading sits at or below the sticky header (56px) and inside the viewport. */
async function expectBelowHeader(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await page.locator(`#${id}`).boundingBox())!.y, { timeout: 5_000 }).toBeGreaterThanOrEqual(56);
  await expect.poll(async () => (await page.locator(`#${id}`).boundingBox())!.y).toBeLessThan(200);
}

test('outline panel at 1440px: entries, jump, scroll-spy, hide and show', async ({ anonPage: page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, NOTES.four);

  await expect(panel(page)).toBeVisible();
  const links = panel(page).getByRole('link');
  await expect(links).toHaveText(['Intro', 'Background', 'Results', 'Intro']);
  // Duplicate texts get distinct ids.
  await expect(page.locator('#intro')).toHaveCount(1);
  await expect(page.locator('#intro-2')).toHaveCount(1);
  // h3 entries are indented against h2.
  const x = async (i: number) => links.nth(i).locator('span').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(await x(1)).toBeGreaterThan(await x(0));
  // The article column is not narrowed and nothing scrolls sideways.
  const article = (await page.getByRole('article').boundingBox())!;
  expect(article.width).toBeGreaterThan(800);
  expect(await noOverflow(page)).toBe(true);
  // No inline toggle beside the panel.
  await expect(page.getByRole('button', { name: 'On this page' })).toBeHidden();

  await shots(page, (theme) => `share-outline-panel-${theme}-1440.png`);

  // Click: scrolls below the header and sets the hash.
  await links.nth(2).click();
  await expectBelowHeader(page, 'results');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#results');
  await expect(links.nth(2)).toHaveAttribute('aria-current', 'location');
  await expect(links.nth(0)).not.toHaveAttribute('aria-current', 'location');

  // Scroll-spy: reading the first section moves the highlight back.
  await page.evaluate(() => document.getElementById('background')!.scrollIntoView());
  await expect(links.nth(1)).toHaveAttribute('aria-current', 'location');
  await page.evaluate(() => document.getElementById('intro-2')!.scrollIntoView());
  await expect(links.nth(3)).toHaveAttribute('aria-current', 'location');
  await shots(page, (theme) => `share-outline-active-${theme}-1440.png`);

  // Hide: remembered across a reload; the icon button stays to bring it back.
  await panel(page).getByRole('button', { name: 'Hide contents' }).click();
  await expect(links).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Show contents' })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('1');
  await shots(page, (theme) => `share-outline-hidden-${theme}-1440.png`);
  await page.reload();
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: NOTES.four.title })).toBeVisible({ timeout: 15_000 });
  await expect(links).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Show contents' }).click();
  await expect(links).toHaveCount(4);
  await expect(panel(page).getByRole('button', { name: 'Hide contents' })).toHaveAttribute('aria-expanded', 'true');
});

test('outline panel fits at the xl edge, 1280px', async ({ anonPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, NOTES.four);
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shots(page, (theme) => `share-outline-panel-${theme}-1280.png`);
});

test('outline at 390px: inline toggle, no side panel', async ({ anonPage: page }) => {
  await page.setViewportSize(PHONE);
  await open(page, NOTES.four);

  await expect(panel(page)).toBeHidden();
  const toggle = page.getByRole('button', { name: 'On this page' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // Below the byline, above the body.
  const byline = (await page.getByText('min read').or(page.getByText('Published')).first().boundingBox())!;
  const toggleBox = (await toggle.boundingBox())!;
  expect(toggleBox.y).toBeGreaterThan(byline.y);
  expect(toggleBox.height).toBeGreaterThanOrEqual(44);
  expect(await noOverflow(page)).toBe(true);
  await shots(page, (theme) => `share-outline-collapsed-${theme}-390.png`);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const links = page.getByRole('navigation', { name: 'On this page' }).getByRole('link');
  await expect(links).toHaveText(['Intro', 'Background', 'Results', 'Intro']);
  expect((await links.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noOverflow(page)).toBe(true);
  await shots(page, (theme) => `share-outline-open-${theme}-390.png`);

  await links.nth(2).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expectBelowHeader(page, 'results');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#results');
});

for (const [name, size] of [['1440', DESKTOP], ['390', PHONE]] as const) {
  test(`a note with 2 headings has no outline, ${name}px`, async ({ anonPage: page }) => {
    await page.setViewportSize(size);
    await open(page, NOTES.two);
    await expect(page.getByRole('heading', { level: 2, name: 'Two' })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'On this page' })).toHaveCount(0);
  });
}

test('a #slug in the share URL lands on that heading', async ({ anonPage: page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, NOTES.four, '#results');
  await expectBelowHeader(page, 'results');
  await expect(panel(page).getByRole('link').nth(2)).toHaveAttribute('aria-current', 'location');
});

test('emoji-only and punctuated headings still get ids', async ({ anonPage: page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, NOTES.odd);
  await expect(page.locator('h2').nth(0)).toHaveAttribute('id', 'intro');
  await expect(page.locator('h2').nth(1)).toHaveAttribute('id', 'intro-2');
  await expect(page.locator('h4')).toHaveAttribute('id', 'section');
  await expect(page.locator('h3')).toHaveAttribute('id', 'whats-new');
  await expect(panel(page).getByRole('link')).toHaveCount(4);
});

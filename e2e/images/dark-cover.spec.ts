import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #512: a note can have a dark-mode cover next to its normal one. The app shows
// it while the theme is dark and swaps back without a reload; the share page in
// dark mode shows it too. A cover under 1200×630 still becomes the cover, with
// a hint toast. Screenshots of each theme, in the editor and on the share page.

const DESKTOP = { width: 1280, height: 800 };
const shoot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(name), animations: 'disabled' });

/** The <img> the cover band shows, and its natural width (which cover it is). */
function coverImg(page: Page) {
  return page.getByRole('img', { name: 'Note cover' }).locator('img').first();
}
const naturalWidth = (page: Page) =>
  coverImg(page).evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0));

async function pickFile(page: Page, open: () => Promise<void>, name: string, buffer: Buffer): Promise<void> {
  await assertTestOrigin(page);
  const chooser = page.waitForEvent('filechooser');
  await open();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
}

test('light and dark covers swap with the theme, with no reload', async ({ app }) => {
  await app.setViewportSize(DESKTOP);
  await app.emulateMedia({ colorScheme: 'light' });
  await createNote(app, { title: `Dark cover ${Date.now()}`, body: 'Covers for both themes.' });

  // A 600×300 light cover: below the minimum, so a hint, but it still becomes the cover.
  await pickFile(app, () => app.getByRole('button', { name: 'Add cover' }).click({ force: true }), 'light.png',
    makeSolidPng(600, 300, [236, 200, 120]));
  await expect(app.getByText(/This image is 600×300\. Covers look best at 2400×1260 or larger\./)).toBeVisible();
  await expect.poll(() => naturalWidth(app)).toBe(600);
  const lightSrc = await coverImg(app).getAttribute('src');

  // A 1300×700 dark cover, added from the cover's dark mode menu.
  await app.getByRole('img', { name: 'Note cover' }).hover({ force: true });
  await app.getByRole('button', { name: 'Dark mode cover' }).click();
  await pickFile(app, () => app.getByRole('menuitem', { name: 'Add dark mode cover' }).click(), 'dark.png',
    makeSolidPng(1300, 700, [30, 40, 90]));

  // Still light: the light cover stays.
  await app.getByRole('img', { name: 'Note cover' }).hover({ force: true });
  await expect(app.getByRole('button', { name: 'Dark mode cover' })).toBeVisible();
  await app.getByRole('button', { name: 'Dark mode cover' }).click();
  await expect(app.getByRole('menuitem', { name: 'Change dark mode cover' })).toBeVisible();
  await app.keyboard.press('Escape');
  await expect.poll(() => naturalWidth(app)).toBe(600);
  expect(await coverImg(app).getAttribute('src')).toBe(lightSrc);
  await shoot(app, 'dark-cover-light-desktop.png');

  // Dark theme: the dark cover, with no reload.
  await app.emulateMedia({ colorScheme: 'dark' });
  await expect(app.locator('html')).toHaveClass(/\bdark\b/);
  await expect.poll(() => naturalWidth(app)).toBe(1300);
  const darkSrc = await coverImg(app).getAttribute('src');
  expect(darkSrc).not.toBe(lightSrc);
  await shoot(app, 'dark-cover-dark-desktop.png');

  // Reposition in dark mode moves the dark cover, so the dark cover stays shown.
  await app.getByRole('img', { name: 'Note cover' }).hover({ force: true });
  await app.getByRole('button', { name: 'Reposition cover' }).click();
  await expect(app.getByText('Drag to reposition the dark mode cover')).toBeVisible();
  expect(await coverImg(app).getAttribute('src')).toBe(darkSrc);
  await app.getByRole('button', { name: 'Done repositioning' }).click();

  // Back to light, then remove the dark cover: dark mode falls back to the light one.
  await app.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => coverImg(app).getAttribute('src')).toBe(lightSrc);
  await app.getByRole('img', { name: 'Note cover' }).hover({ force: true });
  await app.getByRole('button', { name: 'Dark mode cover' }).click();
  await app.getByRole('menuitem', { name: 'Remove dark mode cover' }).click();
  await app.emulateMedia({ colorScheme: 'dark' });
  await expect(app.locator('html')).toHaveClass(/\bdark\b/);
  await expect.poll(() => coverImg(app).getAttribute('src')).toBe(lightSrc);
});

// Canned guest reads on a *.homebase.test identity, as in share-header.spec.ts.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5c2e9a41-7b3d-4f68-a1c0-2d8e6f4b9a37';
const FILE_ID = '8a4f1c63-2e9b-4d70-b5a8-6c3e1f7d2b94';
const NOTE_TITLE = 'A note with two covers';
const PUBLISHED = Date.UTC(2026, 9, 1, 9, 0);

const svg = (width: number, height: number, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`;
const COVERS: Record<string, { width: number; body: string }> = {
  jrnl_img0: { width: 2400, body: svg(2400, 1260, '#ecc878') },
  jrnl_img1: { width: 2000, body: svg(2000, 1050, '#1e285a') },
};

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('A shared note with a light and a dark cover.')]);
  doc.getXmlFragment('prosemirror').push([paragraph]);
  doc.getMap('journalMeta').set('cover', {
    src: `attachment://${FILE_ID}/jrnl_img0`,
    positionY: 50,
    dark: { src: `attachment://${FILE_ID}/jrnl_img1`, positionY: 50 },
  });
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: PUBLISHED,
      payloads: [{ key: 'jrnl_txt' }, { key: 'jrnl_img0' }, { key: 'jrnl_img1' }],
      appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  // A page route takes precedence over the fence's context route.
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    const cover = COVERS[url.searchParams.get('key') ?? ''];
    return cover
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: cover.body })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
}

for (const [theme, key] of [['light', 'jrnl_img0'], ['dark', 'jrnl_img1']] as const) {
  test(`the share page shows the ${theme} cover in ${theme} mode`, async ({ anonPage: page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize(DESKTOP);
    await mockPublicNote(page);
    await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(page);
    await expect(page.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });

    const cover = page.locator('main img').first();
    await expect
      .poll(() => cover.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
      .toBe(COVERS[key].width);
    await shoot(page, `dark-cover-share-${theme}-desktop.png`);
  });
}

import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #425: the share page's header and footer carry the logo. The header is a
// sticky, translucent bar that stays in view while a long note scrolls, fits
// one row on a phone, and its actions are keyboard-reachable; the footer says
// what Journal is and links into the app; the not-found state gets the same
// header. Takes the screenshots the issue asks for: top, scrolled, footer and
// error state, light and dark, 1280px and 390px.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { 1280: { width: 1280, height: 800 }, 390: { width: 390, height: 844 } } as const;

// Canned guest reads on a *.homebase.test identity, as in share-save-copy.spec.ts (#393, no fake drive per #196).
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3f6a2d18-9c4b-4e71-b5a0-8d2e7c1f4b93';
const MISSING_ID = '0b8e4c27-5d1a-4f93-a6e2-7c3d9f1b5e40';
const FILE_ID = '6d1b8f42-0e7a-4c35-9b26-a4f3e8c7d519';
const NOTE_TITLE = 'A long walk through the share page';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

// Long enough to scroll well past 600px at any viewport.
const PARAGRAPHS = Array.from(
  { length: 24 },
  (_, i) =>
    `Paragraph ${i + 1}. A shared note is read by people who may never have heard of Journal, so the page around it should be quiet, finished and clearly someone's own writing.`,
);

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push(
    PARAGRAPHS.map((text) => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText(text)]);
      return paragraph;
    }),
  );
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/** Answers the author's guest reads: a 404 on the MISSING_ID page, the note otherwise. */
async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: PUBLISHED,
      payloads: [{ key: 'jrnl_txt' }],
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
    if (page.url().includes(MISSING_ID)) return route.fulfill({ status: 404, headers, body: '' });
    return url.pathname.endsWith('/payload')
      ? route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() })
      : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
  });
}

async function openNote(page: Page): Promise<void> {
  await mockPublicNote(page);
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
}

const pageHeader = (page: Page) => page.getByRole('banner');
const homeLink = (page: Page) => pageHeader(page).getByRole('link', { name: 'Journal', exact: true });

/** The header's logo has loaded, sits next to the wordmark, and is inside the viewport. */
async function expectLogoHeader(page: Page): Promise<void> {
  const logo = homeLink(page).locator('img');
  await expect(logo).toHaveAttribute('src', /\/logo\.webp$/);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(homeLink(page)).toContainText('Journal');
  await expect(pageHeader(page)).toBeInViewport();
}

const shoot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(name) });

for (const theme of THEMES) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`share header and footer, ${theme} theme, ${width}px`, async ({ anonPage: page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(viewport);
      await openNote(page);
      await expect(page.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));

      // Top of page: the logo and wordmark; no hairline yet.
      await expectLogoHeader(page);
      await expect(pageHeader(page)).toHaveAttribute('data-scrolled', 'false');
      await expect(pageHeader(page).getByRole('link', { name: 'Save a copy' })).toBeVisible();
      await expect(pageHeader(page).getByRole('link', { name: 'Open Journal' })).toBeVisible();

      // One row, and nothing sideways.
      const { height } = (await pageHeader(page).boundingBox())!;
      expect(height).toBeLessThan(72);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await shoot(page, `share-header-top-${theme}-${width}.png`);

      // Scrolled 600px: still in view, now with its hairline.
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
      await expect(pageHeader(page)).toHaveAttribute('data-scrolled', 'true');
      const scrolled = (await pageHeader(page).boundingBox())!;
      expect(scrolled.y).toBe(0);
      await expect(pageHeader(page)).toBeInViewport();
      await shoot(page, `share-header-scrolled-${theme}-${width}.png`);

      // Footer: the logo and a link into the app.
      const footer = page.getByRole('contentinfo');
      await footer.scrollIntoViewIfNeeded();
      const footerLogo = footer.locator('img');
      await expect(footerLogo).toHaveAttribute('src', /\/logo\.webp$/);
      await expect.poll(() => footerLogo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      await expect(footer.getByRole('link', { name: 'Start your journal' })).toHaveAttribute('href', '/');
      await expect(footer).toContainText('private notes you own, stored on your Homebase identity');
      await expect(pageHeader(page)).toBeInViewport();
      await shoot(page, `share-header-footer-${theme}-${width}.png`);

      // Error state: the same header.
      await page.goto(`/share/${AUTHOR}/${MISSING_ID}`);
      await expect(page.getByRole('heading', { name: 'Note Not Found' })).toBeVisible({ timeout: 15_000 });
      await expectLogoHeader(page);
      await expect(pageHeader(page).getByRole('link', { name: 'Open Journal' })).toBeVisible();
      await expect(pageHeader(page).getByRole('link', { name: 'Save a copy' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await shoot(page, `share-header-error-${theme}-${width}.png`);
    });
  }
}

test('share header: the logo, "Save a copy" and "Open Journal" are reachable by keyboard, in order', async ({ anonPage: page }) => {
  await page.setViewportSize(VIEWPORTS[390]);
  await openNote(page);
  await expect(page.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });

  // At 390px "Open Journal" is an icon; its accessible name is still the label.
  const order = [
    homeLink(page),
    pageHeader(page).getByRole('link', { name: 'Save a copy' }),
    pageHeader(page).getByRole('link', { name: 'Open Journal' }),
  ];
  for (const link of order) {
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
  }
  await expect(order[2]).toHaveAttribute('href', '/');
});

test('share header: the logo goes to "/"', async ({ app }) => {
  await openNote(app);
  await expect(app.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  await homeLink(app).click();
  await expect.poll(() => new URL(app.url()).pathname).toBe('/');
});

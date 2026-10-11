import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #577: every heading level H1-H6 is distinct from body text and steps down,
// whichever way it was inserted (input rule, slash menu, toolbar), in the
// editor and on the real share page, light and dark. Screenshots of both.

const THEMES = ['light', 'dark'] as const;
const LEVELS = [1, 2, 3, 4, 5, 6] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;
// A slash query that lists only that heading (no spaces: the menu closes on one).
const SLASH_QUERY = { 4: 'sub-section', 5: 'minor', 6: 'smallest' } as const;

type Style = { size: number; weight: number; color: string; transform: string };

const style = (loc: Locator): Promise<Style> =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), color: s.color, transform: s.textTransform };
  });

/** H1-H6 (by text) each differ from the paragraph in size and weight; size strictly and weight weakly decrease. */
async function expectScale(root: Locator, label: (n: number) => string): Promise<Style[]> {
  const para = await style(root.locator('p', { hasText: 'Body text' }));
  const hs: Style[] = [];
  for (const n of LEVELS) hs.push(await style(root.locator(`h${n}`, { hasText: label(n) })));
  for (const h of hs) {
    expect(h.size).not.toBe(para.size);
    expect(h.weight).toBeGreaterThan(para.weight);
  }
  for (let i = 1; i < hs.length; i++) {
    expect(hs[i].size).toBeLessThan(hs[i - 1].size);
    expect(hs[i].weight).toBeLessThanOrEqual(hs[i - 1].weight);
  }
  // H6, the smallest, is also set apart by case and colour.
  expect(hs[5].transform).toBe('uppercase');
  expect(hs[5].color).not.toBe(para.color);
  return hs;
}

test('H1-H6 from input rules, slash menu and toolbar are distinct from body text and step down', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  await createNote(app, { title: `Headings ${Date.now()}`, body: '' });
  const editor = activeEditor(app);
  await editor.click();

  for (const n of LEVELS) {
    await editor.pressSequentially(`${'#'.repeat(n)} Rule ${n}`);
    await editor.press('Enter');
  }
  for (const n of [4, 5, 6] as const) {
    await app.keyboard.type(`/${SLASH_QUERY[n]}`);
    await expect(app.getByRole('button', { name: new RegExp(`^Heading ${n} `) })).toBeVisible();
    await app.keyboard.press('Enter');
    await app.keyboard.type(`Slash ${n}`);
    await app.keyboard.press('Enter');
  }
  for (const n of [4, 5, 6] as const) {
    await app.keyboard.type(`Toolbar ${n}`);
    await app.getByRole('button', { name: `Heading ${n}`, exact: true }).click();
    await app.keyboard.press('End');
    await app.keyboard.press('Enter');
  }
  await app.keyboard.type('Body text');

  for (const theme of THEMES) {
    await app.emulateMedia({ colorScheme: theme });
    const byRule = await expectScale(editor, (n) => `Rule ${n}`);
    for (const n of [4, 5, 6] as const) {
      expect(await style(editor.locator(`h${n}`, { hasText: `Slash ${n}` }))).toEqual(byRule[n - 1]);
      expect(await style(editor.locator(`h${n}`, { hasText: `Toolbar ${n}` }))).toEqual(byRule[n - 1]);
    }
    await app.screenshot({ path: test.info().outputPath(`headings-editor-${theme}-1280.png`), fullPage: true });
  }
});

// Share page: same canned-GET approach as footnotes.spec.ts (#196: no fake drive).
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5c1e7a90-2b4d-4f3a-8e61-7d9b0c2a4e15';
const FILE_ID = 'e4a8b2c6-1d3f-4a5b-9c7e-0f2d4b6a8c19';
const NOTE_TITLE = 'Headings on the share page';
const PUBLISHED = Date.UTC(2026, 9, 1, 9, 0);

function block(name: string, value: string, attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, v] of Object.entries(attributes)) el.setAttribute(key, v);
  el.insert(0, [new Y.XmlText(value)]);
  return el;
}

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    ...LEVELS.map((n) => block('heading', `Level ${n}`, { level: String(n) })),
    block('paragraph', 'Body text'),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function openSharedNote(page: Page): Promise<Locator> {
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
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!new URL(route.request().url()).pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  return article;
}

for (const theme of THEMES) {
  test(`share page renders H1-H6 with the same scale, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    const article = await openSharedNote(anonPage);
    await expect(article.getByRole('heading', { level: 6, name: 'Level 6' })).toBeVisible();

    await expectScale(article, (n) => `Level ${n}`);
    await anonPage.screenshot({ path: test.info().outputPath(`headings-share-${theme}-1280.png`) });

    await anonPage.setViewportSize(VIEWPORTS.mobile);
    await expectScale(article, (n) => `Level ${n}`);
    await anonPage.screenshot({ path: test.info().outputPath(`headings-share-${theme}-390.png`), fullPage: true });
  });
}

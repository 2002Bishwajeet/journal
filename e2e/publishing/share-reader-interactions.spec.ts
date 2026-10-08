import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #517: on the share page a reader can tick task checkboxes and open or close
// toggles, by mouse and by keyboard. The state is local: it is never written
// back and a reload resets it. Callouts keep their icon and colour. Takes the
// screenshots the issue asks for: light, dark and 390px.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

// Same canned-GET approach as share-wide-blocks.spec.ts: no fake drive (#196).
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '7c1d4b8e-2f63-4a90-8e57-5b9a0c3d6f21';
const FILE_ID = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const NOTE_TITLE = 'Reader interactions on the share page';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const paragraph = (text: string) => element('paragraph', [new Y.XmlText(text)]);
const taskItem = (text: string, checked: boolean) => element('taskItem', [paragraph(text)], { checked: String(checked) });
const toggle = (summary: string, inner: string) => element('toggle', [paragraph(inner)], { summary });
const callout = (variant: string, text: string) => element('callout', [paragraph(text)], { variant });

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    paragraph('A checklist and a toggle a reader can play with.'),
    element('taskList', [taskItem('Buy milk', false), taskItem('Write the report', true), taskItem('Call the bank', false)]),
    toggle('More details', 'Hidden until the reader opens it.'),
    callout('info', 'An info callout.'),
    callout('warning', 'A warning callout.'),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function openNote(page: Page): Promise<Locator> {
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
  const writes: string[] = [];
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!new URL(request.url()).pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  (page as Page & { writes?: string[] }).writes = writes;
  return article;
}

const writesOf = (page: Page) => (page as Page & { writes?: string[] }).writes ?? [];

for (const theme of THEMES) {
  test(`share page: a reader ticks checkboxes and opens toggles, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    const article = await openNote(anonPage);
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));

    const milk = article.getByRole('checkbox').nth(0);
    const report = article.getByRole('checkbox').nth(1);
    const bank = article.getByRole('checkbox').nth(2);
    await expect(article.getByRole('checkbox')).toHaveCount(3);
    for (const box of [milk, report, bank]) await expect(box).toBeEnabled();
    await expect(milk).not.toBeChecked();
    await expect(report).toBeChecked();

    // Mouse.
    await milk.click();
    await expect(milk).toBeChecked();
    await report.click();
    await expect(report).not.toBeChecked();

    // Keyboard: focus shows a ring, Space ticks.
    // Tab, not focus(): a ring is for keyboard focus only.
    await report.focus();
    await anonPage.keyboard.press('Tab');
    await expect(bank).toBeFocused();
    expect(await bank.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await anonPage.keyboard.press('Space');
    await expect(bank).toBeChecked();

    // Toggle: closed at first; click opens and closes.
    const details = article.locator('details');
    const summary = details.locator('summary');
    const inner = article.getByText('Hidden until the reader opens it.');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(inner).toBeHidden();
    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await expect(inner).toBeVisible();
    await summary.click();
    await expect(inner).toBeHidden();

    // Toggle by keyboard: Enter opens, Space closes; the summary shows a focus ring.
    await bank.focus();
    await anonPage.keyboard.press('Tab');
    await expect(summary).toBeFocused();
    expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await anonPage.keyboard.press('Enter');
    await expect(inner).toBeVisible();
    await anonPage.keyboard.press('Space');
    await expect(inner).toBeHidden();

    // Callouts keep their icon and colour.
    for (const variant of ['info', 'warning']) {
      const aside = article.locator(`aside[data-variant="${variant}"]`);
      await expect(aside).toBeVisible();
      await expect(aside.locator('svg')).toBeVisible();
      expect(await aside.evaluate((el) => getComputedStyle(el).borderLeftColor)).not.toBe('rgba(0, 0, 0, 0)');
    }

    // Local only: nothing was written, and a reload resets it.
    expect(writesOf(anonPage)).toEqual([]);
    await summary.click();
    await anonPage.screenshot({ path: test.info().outputPath(`share-reader-interactions-${theme}-1280.png`) });
    await anonPage.setViewportSize(VIEWPORTS.mobile);
    await anonPage.screenshot({ path: test.info().outputPath(`share-reader-interactions-${theme}-390.png`) });
    await anonPage.reload();
    await expect(article.getByRole('checkbox').nth(0)).not.toBeChecked();
    await expect(article.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(article.locator('details')).not.toHaveAttribute('open', '');
  });
}

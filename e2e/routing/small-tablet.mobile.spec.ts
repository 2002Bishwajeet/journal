import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { foldersNav, inBothThemes, openSettingsSection } from '../support/actions';

// #1289: iPhone Duo. The outer display (466x678) is a phone; the inner one (669x951) is a small
// tablet with the list and the note side by side. On both, search is the full-screen sheet with
// no keyboard hints and no block source in its snippets, the share sheet's link card spans the
// sheet with its picture filled, and the tags are not cut off. Touch, @3x, light and dark.

const OUTER = { width: 466, height: 678 };
const INNER = { width: 669, height: 951 };
const TAGS = ['books', 'garden', 'health', 'ideas', 'recipes', 'travel', 'work'];
const CHART = 'Weekly run chart';

const seedFiles = () => [
  ...TAGS.map((tag) => ({
    name: `${tag}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`---\ntitle: Notes on ${tag}\ntags: [${tag}]\n---\nA few lines about ${tag}, which runs on for a while.\n`),
  })),
  {
    name: 'chart.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      `---\ntitle: ${CHART}\n---\nMy weekly run totals, a bar per week.\n\n\`\`\`react\nimport { BarChart } from "recharts";\nexport default function App() { return <BarChart data={[]} /> }\n\`\`\`\n`,
    ),
  },
];

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const isInner = (page: Page) => page.viewportSize()!.width === INNER.width;

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function shots(page: Page, what: string) {
  const { width, height } = page.viewportSize()!;
  await inBothThemes(page, async (theme) => {
    await settle(page);
    await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${width}x${height}.png`) });
  });
  await page.emulateMedia({ colorScheme: 'light' });
}

async function importNotes(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).last().click();
  const dialog = page.getByRole('dialog');
  await openSettingsSection(dialog, 'Data & storage');
  await dialog.locator('input[type="file"]').setInputFiles(seedFiles());
  const toast = page.getByText(/Successfully imported 8 notes/);
  await expect(toast).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toast).toBeHidden({ timeout: 15_000 });
}

/** The sidebar: the home screen on the phone, the folders overlay on the small tablet. */
async function showSidebar(page: Page) {
  if (isInner(page)) await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
}

async function checkHome(page: Page) {
  const { width } = page.viewportSize()!;
  if (isInner(page)) {
    // The list and the note sit side by side, the note wider than a phone screen.
    await showSidebar(page);
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).click();
    await expect(sidebar(page)).toBeHidden();
    await page.locator('[data-testid=note-row]:visible').filter({ hasText: CHART }).click();
    await expect(page.locator('.tiptap').first()).toBeVisible();
    const list = (await page.locator('[data-pane="note-list"]').boundingBox())!;
    const note = (await page.locator('#main-content').boundingBox())!;
    expect(list.width).toBeCloseTo(256, 0);
    expect(note.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
    expect(note.width).toBeGreaterThan(400);
    expect(list.width + note.width).toBeGreaterThanOrEqual(width - 1);
    await shots(page, 'two-pane');
  }
  await showSidebar(page);
  // Every tag scrolls fully into view, clear of the tab bar, with Archive and Trash after it.
  const last = sidebar(page).getByRole('navigation', { name: 'Tags' }).getByRole('button').last();
  await expect(last).toHaveText(TAGS.at(-1)!);
  await shots(page, 'home');
  await sidebar(page).locator('[data-slot=scroll-area-viewport]').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const trash = sidebar(page).getByRole('button', { name: 'Trash' });
  for (const row of [last, trash]) await expect(row).toBeInViewport({ ratio: 1 });
  const tabBar = page.getByRole('navigation', { name: 'Tabs' });
  if (await tabBar.isVisible()) {
    const bar = (await tabBar.boundingBox())!;
    for (const row of [last, trash]) {
      const box = (await row.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    }
  }
  await shots(page, 'home-tags');
}

async function checkSearch(page: Page) {
  const { width, height } = page.viewportSize()!;
  await sidebar(page).getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search notes' });
  await expect(dialog).toBeVisible();
  await settle(page);
  const box = (await dialog.boundingBox())!;
  expect(box).toEqual({ x: 0, y: 0, width, height });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await dialog.getByPlaceholder('Search notes...').fill('run');
  const hit = dialog.locator('#search-result-0');
  await expect(hit).toContainText(CHART);
  await expect(hit).toContainText('weekly run totals');
  await expect(dialog).not.toContainText(/BarChart|recharts|import \{/);
  await expect(dialog.locator('kbd')).toHaveCount(0);
  await shots(page, 'search');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
}

async function checkShare(page: Page) {
  if (!isInner(page)) await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).click();
  else await page.getByRole('button', { name: 'Close folders' }).click({ position: { x: INNER.width - 20, y: INNER.height / 2 } });
  const row = page.locator('[data-testid=note-row]:visible').filter({ hasText: CHART });
  await row.click({ button: 'right', position: { x: 12, y: 12 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await settle(page);
  await menu.getByRole('menuitem', { name: 'Share…', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Share Note' });
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBe(0);

  // The card spans the sheet's body, and its picture area shows a loaded image.
  const preview = sheet.getByRole('region', { name: 'Link preview' });
  const card = (await preview.boundingBox())!;
  const body = (await sheet.boundingBox())!;
  expect(card.width).toBeGreaterThanOrEqual(body.width - 2 * 24 - 1);
  const picture = preview.locator('img').first();
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await shots(page, 'share');
  await page.goBack();
  await expect(sheet).toBeHidden();
}

test('the Duo outer and inner displays: home, search and share', async ({ browser }) => {
  test.setTimeout(120_000);
  await withFencedPage(
    browser,
    { viewport: OUTER, deviceScaleFactor: 3, isMobile: true, hasTouch: true, storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'block' },
    async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await importNotes(page);

      for (const size of [OUTER, INNER]) {
        await page.setViewportSize(size);
        await checkHome(page);
        await checkSearch(page);
        await checkShare(page);
      }
    },
  );
});

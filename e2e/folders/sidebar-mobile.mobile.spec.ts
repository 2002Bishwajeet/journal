import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';

// The sidebar on phones and tablets (#776): no collapse rail, an overlay on
// tablets (#832), and tap targets of at least 44px.

const SIDEBAR_COLLAPSE_KEY = 'journal-sidebar-collapse';

const sidebarOf = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });

async function shoot(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const { width, height } = page.viewportSize()!;
    await page.screenshot({ path: test.info().outputPath(`${name}-${scheme}-${width}x${height}.png`), animations: 'disabled' });
  }
}

test('a phone has no collapse button', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await expect(sidebarOf(page).getByRole('button', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeHidden();
    await shoot(page, 'sidebar');
  });
});

test('a saved collapsed state does not shrink the phone sidebar', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.evaluate(
      (key) => localStorage.setItem(key, JSON.stringify({ sidebar: true, folders: false, tags: false })),
      SIDEBAR_COLLAPSE_KEY,
    );
    await page.reload();
    const sidebar = sidebarOf(page);
    await expect(sidebar.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeHidden();
    const box = await sidebar.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(392); // the wrapper has a 1px border
    await shoot(page, 'sidebar-saved-collapsed');
  });
});

// A tablet shows the list and the note side by side; the sidebar is a 320px overlay opened from the list header (#832).
test('a tablet sidebar is an overlay opened from the list header', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const sidebar = sidebarOf(page);
    await expect(sidebar).toBeHidden();
    await page.getByRole('button', { name: 'Show folders', exact: true }).click();
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeGreaterThanOrEqual(319); // the wrapper has a 1px border
    await shoot(page, 'sidebar');
  });
});

test('every sidebar button is at least 44px', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const buttons = sidebarOf(page).locator('button:visible');
    await expect(buttons.first()).toBeVisible();
    const small: string[] = [];
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      if (box && (box.width < 44 || box.height < 44)) {
        small.push(`${(await button.innerText()) || (await button.getAttribute('aria-label'))} ${box.width}x${box.height}`);
      }
    }
    expect(small).toEqual([]);
  });
});

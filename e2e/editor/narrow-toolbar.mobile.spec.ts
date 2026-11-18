import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { withMobilePage, withTabletPage } from '../support/mobile';

// Touch devices keep the bottom toolbar at narrow widths, and get no top toolbar (#1392): controls
// follow the input device, so a finger never gets the mouse toolbar.

const topToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const bottomToolbar = (page: Page) => page.locator('[data-mobile-toolbar]');

test('a touch tablet in portrait keeps the bottom toolbar and has no top toolbar', async ({ browser }) => {
  // Landscape is a desktop width: make the note there, then turn the iPad upright.
  await withTabletPage(browser, { width: 1180, height: 820 }, async (page) => {
    await createNote(page, { title: `Tablet ${Date.now()}`, body: 'Touch tablet body' });
    await page.setViewportSize({ width: 820, height: 1180 });
    await activeEditor(page).tap();
    await expect(bottomToolbar(page)).toBeVisible();
    await expect(topToolbar(page)).toHaveCount(0);
  });
});

test('a phone keeps the bottom toolbar and has no top toolbar', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await activeEditor(page).tap();
    await expect(bottomToolbar(page)).toBeVisible();
    await expect(topToolbar(page)).toHaveCount(0);
  });
});

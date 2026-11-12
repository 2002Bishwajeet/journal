import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openSettingsSection } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// The iOS edge swipe is the browser's Back: each section page needs its own history entry,
// every time it opens, not only the first time.

const sectionRow = (dialog: Locator, name: string) => dialog.getByRole('listitem').getByRole('button', { name, exact: true });
const overlayCount = (page: Page) => page.evaluate(() => history.state?.usr?.overlays?.length ?? 0);

test('Back from several section pages in a row returns to the list each time', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const route = page.url();
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => overlayCount(page)).toBe(1);

    for (const section of ['Appearance', 'Data & storage', 'Appearance', 'About']) {
      await openSettingsSection(dialog, section);
      await expect(dialog.getByRole('region', { name: section })).toBeVisible();
      await expect.poll(() => overlayCount(page)).toBe(2);
      await page.goBack();
      await expect(dialog.getByRole('region')).toHaveCount(0);
      await expect(sectionRow(dialog, section)).toBeVisible();
      expect(await overlayCount(page)).toBe(1);
    }

    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(route);
  });
});

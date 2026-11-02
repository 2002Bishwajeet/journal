import { test, expect } from '../fixtures';
import { foldersNav, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #831: on a phone, Settings is a grouped section list that drills into one page per section.

const SECTIONS = ['Account', 'Appearance', 'AI', 'Agent access', 'Notifications', 'Data & storage', 'Diagnostics', 'About'];

test('the section list drills into a page; Back returns to the list, then closes Settings', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const route = page.url();
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

    // Every section is a row, whole on screen, at least 44 px tall.
    for (const name of SECTIONS) {
      const row = dialog.getByRole('listitem').getByRole('button', { name, exact: true });
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(393);
    }
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await screenshotInBothThemes(page, (theme) => `settings-list-${theme}-393.png`);

    await dialog.getByRole('listitem').getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Appearance' })).toBeVisible();
    const back = dialog.getByRole('button', { name: 'Settings', exact: true });
    const backBox = (await back.boundingBox())!;
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await screenshotInBothThemes(page, (theme) => `settings-appearance-${theme}-393.png`);

    await page.goBack();
    await expect(dialog.getByRole('region')).toHaveCount(0);
    await expect(dialog.getByRole('listitem').getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(route);
  });
});

test('the Back button goes to the list and the stack still closes cleanly', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const route = page.url();
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('listitem').getByRole('button', { name: 'About', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'About' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(dialog.getByRole('region')).toHaveCount(0);
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(route);
  });
});

test('openSettings from the sync status opens Diagnostics with the list underneath', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.evaluate(() => window.__journalE2E!.seedPendingSync());
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    const noteListRoute = page.url();
    await page.locator('button[aria-label="Sync status"]:visible').first().tap();
    await page.getByRole('button', { name: /Pending items|Diagnostics/ }).tap();

    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('region', { name: 'Diagnostics' })).toBeVisible();
    await page.goBack();
    await expect(dialog.getByRole('region')).toHaveCount(0);
    await expect(dialog.getByRole('listitem').getByRole('button', { name: 'Diagnostics', exact: true })).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(noteListRoute);
  });
});

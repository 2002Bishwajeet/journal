import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { foldersNav, openSettingsSection, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #831: on a phone, Settings is a grouped section list that drills into one page per section.

const SECTIONS = ['Account', 'Appearance', 'Notifications', 'Data & storage', 'Agent access', 'About'];

const sectionRow = (dialog: Locator, name: string) =>
  dialog.getByRole('listitem').getByRole('button', name === 'Account' ? { name: /^Account/ } : { name, exact: true });
const overlayCount = (page: Page) => page.evaluate(() => history.state?.usr?.overlays?.length ?? 0);
const animationsDone = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

async function openSettings(page: Page) {
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens Diagnostics from the sync status over the note list; returns the note list's URL. */
async function openDiagnosticsFromSyncStatus(page: Page) {
  await page.evaluate(() => window.__journalE2E!.seedPendingSync());
  await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
  // The folder opens inside the slide's view transition, a frame later.
  await expect(page).not.toHaveURL(/\/$/);
  const noteListRoute = page.url();
  await page.locator('button[aria-label="Sync status"]:visible').first().tap();
  // A phone's sync status is a sheet whose row is "Open diagnostics" (#828).
  await page.getByRole('button', { name: 'Open diagnostics' }).tap();
  return noteListRoute;
}

test('the section list drills into a page; Back returns to the list, then closes Settings', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const route = page.url();
    const dialog = await openSettings(page);
    await animationsDone(page);

    // Every section is a row, whole on screen, at least 44 px tall.
    for (const name of SECTIONS) {
      const row = sectionRow(dialog, name);
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(393);
    }
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await openSettingsSection(dialog, 'Appearance');
    await expect(dialog.getByRole('region', { name: 'Appearance' })).toBeVisible();
    await animationsDone(page);
    const back = dialog.getByRole('button', { name: 'Settings', exact: true });
    const backBox = (await back.boundingBox())!;
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);

    await page.goBack();
    await expect(dialog.getByRole('region')).toHaveCount(0);
    await expect(sectionRow(dialog, 'Appearance')).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(route);
  });
});

test('the Back button goes to the list and the stack still closes cleanly', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const route = page.url();
    const dialog = await openSettings(page);
    await openSettingsSection(dialog, 'About');
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
    const noteListRoute = await openDiagnosticsFromSyncStatus(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('region', { name: 'Diagnostics' })).toBeVisible();
    // The page's history entry follows the dialog's; a real Back gesture comes well after both.
    await expect.poll(() => overlayCount(page)).toBe(2);
    await page.goBack();
    await expect(dialog.getByRole('region')).toHaveCount(0);
    await expect(sectionRow(dialog, 'About')).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(noteListRoute);
  });
});

test('a note opened from a section page leaves no Settings entries behind Back', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const noteListRoute = await openDiagnosticsFromSyncStatus(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect.poll(() => overlayCount(page)).toBe(2);
    await dialog.getByRole('button', { name: 'Seeded note A', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/00000000-0000-4000-8000-000000000001/);
    expect(await overlayCount(page)).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(noteListRoute);
    expect(await overlayCount(page)).toBe(0);
    await expect(dialog).toBeHidden();
  });
});

test('Escape on a section page closes Settings and clears both history entries', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const route = page.url();
    const dialog = await openSettings(page);
    await openSettingsSection(dialog, 'About');
    await expect(dialog.getByRole('region', { name: 'About' })).toBeVisible();
    await expect.poll(() => overlayCount(page)).toBe(2);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => overlayCount(page)).toBe(0);
    expect(page.url()).toBe(route);
  });
});

// Evidence at the audit's 390 px width: the list, a section page and the Account page.
test('screenshots at 390 px', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await openSettings(page);
    await animationsDone(page);
    await screenshotInBothThemes(page, (theme) => `settings-list-${theme}-390.png`);
    for (const section of ['Appearance', 'Account']) {
      await openSettingsSection(dialog, section);
      await expect(dialog.getByRole('region', { name: section })).toBeVisible();
      await animationsDone(page);
      await screenshotInBothThemes(page, (theme) => `settings-${section.toLowerCase()}-${theme}-390.png`);
    }
  });
});

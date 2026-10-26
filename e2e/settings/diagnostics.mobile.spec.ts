import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import type { Page } from '@playwright/test';
import { foldersNav } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #870: on a phone, the "Share notifications are off" notice has one primary button that fixes
// the journal drive through the owner console's extend-permissions page. The manual owner
// console steps stay behind a toggle. The backend is unreachable here, so the drive's state is
// unknown and the notice shows after a refused push.

// `screenshotInBothThemes` waits for every CSS transition to leave `document.getAnimations()`. Chromium keeps
// the finished colour transitions of a link in that list, so that wait never ends here. Wait for running ones.
async function screenshotBothThemes(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await page.screenshot({ path: test.info().outputPath(`${name}-${theme}-393x852.png`) });
  }
}

test('the share notifications notice has one Fix in owner console button and the manual steps behind a toggle', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    await page.evaluate(() => window.__journalE2E!.seedPendingSync());
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.locator('button[aria-label="Sync status"]:visible').first().tap();
    await page.getByRole('button', { name: /Pending items|Diagnostics/ }).tap();

    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const panel = dialog.getByRole('tabpanel');
    await expect(panel.getByRole('list', { name: 'Pending sync items' })).toBeVisible();
    await page.evaluate(() => window.__journalE2E!.refuseSharePush());

    const notice = panel.getByTestId('share-notifications-off');
    const fix = notice.getByRole('link', { name: 'Fix in owner console' });
    await expect(fix).toBeVisible();
    await expect(fix).toHaveAttribute('href', /\/owner\/appupdate\?/);
    expect((await fix.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Only the fix and the toggle: the manual link and steps are hidden until the toggle opens.
    await expect(notice.getByRole('link')).toHaveCount(1);
    await expect(notice.getByRole('listitem')).toHaveCount(0);
    await expect(notice.getByRole('link', { name: 'Open drive settings' })).toBeHidden();

    await notice.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await screenshotBothThemes(page, 'diagnostics-share-fix');

    await notice.getByText('Do it by hand').tap();
    await expect(notice.getByRole('listitem')).toHaveCount(2);
    await expect(notice.getByRole('link', { name: 'Open drive settings' })).toBeVisible();
    await notice.getByText('Do it by hand').scrollIntoViewIfNeeded();
    await screenshotBothThemes(page, 'diagnostics-share-fix-manual');
  });
});

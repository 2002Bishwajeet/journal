import { test, expect } from '../fixtures';
import { foldersNav } from '../support/actions';
import { withMobilePage } from '../support/mobile';
import { measureSwitch, setUpSwitching, switchColdThenWarm } from '../support/folderSwitch';

// #1219 on a phone: opening a folder from home renders each row once, and reopening
// one already visited shows its notes with no "Loading..." or empty flash.

test('opening a folder on a phone renders each row once and a warm open never flashes empty', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP metrics are Chromium only');
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    const cdp = await setUpSwitching(page);
    await switchColdThenWarm(async (name) => {
      const folder = foldersNav(page).getByRole('button', { name, exact: true });
      await expect(folder).toBeVisible();
      const sample = await measureSwitch(page, cdp, name, () => folder.tap());
      await page.getByRole('button', { name: 'Back to notes' }).tap();
      return sample;
    }, 'folder-switch-mobile.json');
  });
});

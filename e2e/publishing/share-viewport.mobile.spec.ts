import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { assertTestOrigin } from '../support/origin-guard';

// #894: the public note's "Note Not Found" screen is as tall as the screen (svh), not taller, and
// its message is centred below the header. Chromium emulation has no URL bar, so this proves the
// layout, not the svh behaviour itself (that is e2e/ios/safari-check.ts).

const AUTHOR = 'e2e-author.homebase.test';
const MISSING_ID = '0b8e4c27-5d1a-4f93-a6e2-7c3d9f1b5e40';

for (const theme of ['light', 'dark'] as const) {
  test(`share not-found fits the screen, ${theme} theme`, async ({ browser }) => {
    await withMobilePage(browser, async (page) => {
      await page.emulateMedia({ colorScheme: theme });
      // A page route takes precedence over the fence's context route.
      await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) =>
        route.fulfill({
          status: 404,
          body: '',
          headers: {
            'access-control-allow-origin': new URL(page.url()).origin,
            'access-control-allow-credentials': 'true',
          },
        }),
      );
      await page.goto(`/share/${AUTHOR}/${MISSING_ID}`);
      await assertTestOrigin(page);
      const heading = page.getByRole('heading', { name: 'Note Not Found' });
      await expect(heading).toBeVisible({ timeout: 15_000 });

      const wrapper = heading.locator('xpath=ancestor::div[contains(@class,"min-h-svh")][1]');
      await expect(wrapper).toHaveCSS('min-height', '852px');
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);

      const header = (await page.getByRole('banner').boundingBox())!;
      const below = header.y + header.height;
      // The icon, heading, text and button are centred as one group.
      const group = (await heading.locator('xpath=..').boundingBox())!;
      expect(Math.abs(group.y + group.height / 2 - (below + 852) / 2)).toBeLessThanOrEqual(8);

      await page.screenshot({ path: test.info().outputPath(`share-not-found-${theme}-393.png`) });
    });
  });
}

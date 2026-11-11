import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { foldersNav, inBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone, home, a note list and Shared show sync in a pill above the large title (#1162).

async function shots(page: Page, what: string) {
  await inBothThemes(page, (theme) => page.screenshot({ path: test.info().outputPath(`${what}-${theme}-390x844.png`) }));
}

const largeTitle = (page: Page) => page.locator('[data-large-title]:visible');

// The pill is in the bar above the large title, and the title has not moved for it.
async function expectAboveTitle(page: Page, titleY: number) {
  const pill = (await page.locator('.sync-pill:visible').boundingBox())!;
  const title = (await largeTitle(page).boundingBox())!;
  expect(title.y).toBe(titleY);
  expect(pill.y + pill.height).toBeLessThanOrEqual(title.y);
  expect(pill.x).toBeGreaterThanOrEqual(0);
  expect(pill.x + pill.width).toBeLessThanOrEqual(390);
}

test('home and a note list show a sync pill above the title while offline and syncing, none when idle', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const pill = page.locator('.sync-pill:visible');
    await expect(largeTitle(page)).toHaveText('Journal');
    await expect(pill).toHaveCount(0);
    const titleY = (await largeTitle(page).boundingBox())!.y;
    await page.screenshot({ path: test.info().outputPath('idle-390x844.png') });

    await page.context().setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await expectAboveTitle(page, titleY);
    await shots(page, 'offline');

    // Hold the drive requests, so the sync that coming back online starts keeps running.
    // The fence still aborts them (*.homebase.test has no drive); this only delays that.
    const held: Route[] = [];
    await page.context().route('https://*.homebase.test/**', (route) => void held.push(route));
    await page.context().setOffline(false);
    await expect(pill).toHaveText('Syncing…');
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
    );
    await expectAboveTitle(page, titleY);
    await shots(page, 'syncing');

    // A note list has the same bar, with Back and its buttons on either side.
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await expect(largeTitle(page)).toHaveText('Main');
    await expect(pill).toHaveText('Syncing…');
    await expectAboveTitle(page, (await largeTitle(page).boundingBox())!.y);
    await shots(page, 'syncing-list');

    // The sync ends (the requests fail and sync retries later): the pill goes.
    await page.context().unroute('https://*.homebase.test/**');
    for (const route of held) await route.abort('internetdisconnected').catch(() => {});
    await expect(pill).toHaveCount(0);
  });
});

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { inBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone, home and the other tab-bar screens show sync in a pill above the tab bar (#1162).

async function shots(page: Page, what: string) {
  await inBothThemes(page, (theme) => page.screenshot({ path: test.info().outputPath(`${what}-${theme}-390x844.png`) }));
}

test('home shows a sync pill while offline and while syncing, and none when idle', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const pill = page.locator('.sync-pill');
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
    await expect(pill).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
    await shots(page, 'offline');

    // Hold the drive requests, so the sync that coming back online starts keeps running.
    // The fence still aborts them (*.homebase.test has no drive); this only delays that.
    const held: Route[] = [];
    await page.context().route('https://*.homebase.test/**', (route) => void held.push(route));
    await page.context().setOffline(false);
    await expect(pill).toHaveText('Syncing…');
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));

    // On the New note button's row, clear of it and of the tab bar.
    const box = (await pill.boundingBox())!;
    const fab = (await page.getByRole('button', { name: 'New note' }).boundingBox())!;
    const bar = (await page.getByRole('navigation', { name: 'Tabs' }).boundingBox())!;
    expect(box.x + box.width).toBeLessThan(fab.x);
    expect(box.y + box.height).toBeLessThan(bar.y);
    expect(Math.abs(box.y + box.height / 2 - (fab.y + fab.height / 2))).toBeLessThanOrEqual(1);
    await shots(page, 'syncing');

    // The sync ends (the requests fail and sync retries later): the pill goes.
    await page.context().unroute('https://*.homebase.test/**');
    for (const route of held) await route.abort('internetdisconnected').catch(() => {});
    await expect(pill).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('idle-390x844.png') });
  });
});

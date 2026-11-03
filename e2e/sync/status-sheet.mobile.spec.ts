import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { foldersNav, inBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// The sync status and the "Shared" pill open bottom sheets on a phone, with 44 px controls (#828).

async function shots(page: Page, what: string) {
  await inBothThemes(page, (theme) => page.screenshot({ path: test.info().outputPath(`${what}-${theme}-393x852.png`) }));
}

// The sheet slides in; wait until its top edge stops moving.
async function settled(el: Locator) {
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await el.boundingBox())?.y ?? -2;
      const same = y === last;
      last = y;
      return same;
    })
    .toBe(true);
  return (await el.boundingBox())!;
}

test('the sync icon opens a bottom sheet with a 44 px Sync now and a link to Diagnostics', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    await page.evaluate(() => window.__journalE2E!.seedPendingSync());
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();

    const icon = page.locator('button[aria-label="Sync status"]:visible').first();
    const hit = (await icon.boundingBox())!;
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);

    await icon.tap();
    const sheet = page.getByRole('dialog', { name: 'Sync status' });
    const box = await settled(sheet);
    expect(Math.round(box.y + box.height)).toBe(852);
    const syncNow = sheet.getByRole('button', { name: 'Sync now' });
    expect((await syncNow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shots(page, 'sync-sheet');

    await page.goBack();
    await expect(sheet).toBeHidden();

    await icon.tap();
    await sheet.getByRole('button', { name: 'Open diagnostics' }).tap();
    // A phone's Settings is a section list with a page per section (#831), not tabs.
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Diagnostics' })).toBeVisible();
    // The sheet's history pop must not take Settings down with it.
    await page.waitForTimeout(800);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  });
});

test('the Shared pill opens a "Shared with" sheet on a collaborative note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    await page.evaluate(() => window.__journalE2E!.seedCollaborativeNote('Team plan'));
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.getByTestId('note-row').filter({ hasText: 'Team plan' }).tap();

    const pill = page.getByRole('button', { name: 'Show who can access this note' });
    await expect(pill).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    const hit = (await pill.boundingBox())!;
    // The pill's ::after grows its tap area; a point 6 px below the pill must still hit it.
    const label = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('button')?.getAttribute('aria-label') ?? `${el?.tagName}.${el?.className}@${y}`;
      },
      [hit.x + hit.width / 2, hit.y - 6],
    );
    expect(label).toBe('Show who can access this note');
    await pill.tap();

    const sheet = page.getByRole('dialog', { name: 'Shared with' });
    const box = await settled(sheet);
    expect(Math.round(box.y + box.height)).toBe(852);
    const rows = sheet.getByRole('list', { name: 'People with access' }).getByRole('listitem');
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    expect((await rows.first().boundingBox())!.height).toBeGreaterThanOrEqual(52);
    await expect(sheet.getByText(/Last edited by/)).toBeVisible();
    await shots(page, 'collaborators-sheet');
  });
});

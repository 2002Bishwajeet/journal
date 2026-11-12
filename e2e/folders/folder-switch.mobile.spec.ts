import { test, expect } from '../fixtures';
import { foldersNav } from '../support/actions';
import { withMobilePage } from '../support/mobile';
import { assertTestOrigin } from '../support/origin-guard';
import { installSwitchProbes, measureSwitch, type SwitchSample } from '../support/folderSwitch';

// #1219 on a phone: opening a folder from home renders each row once, and reopening
// one already visited shows its notes with no "Loading..." or empty flash.

const FOLDERS = [
  { name: 'Alpha', count: 50 },
  { name: 'Bravo', count: 200 },
  { name: 'Charlie', count: 500 },
];

test('opening a folder on a phone renders each row once and a warm open never flashes empty', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP metrics are Chromium only');
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    await installSwitchProbes(page);
    await page.reload();
    await page.evaluate(() => window.__journalE2E!.ready());
    await page.evaluate((folders) => window.__journalE2E!.seedFolders(folders), FOLDERS);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    const run = async (name: string) => {
      const folder = foldersNav(page).getByRole('button', { name, exact: true });
      await expect(folder).toBeVisible();
      const sample = await measureSwitch(page, cdp, name, () => folder.tap());
      await page.getByRole('button', { name: 'Back to notes' }).tap();
      return sample;
    };

    const cold: SwitchSample[] = [];
    for (const { name } of FOLDERS) cold.push(await run(name));
    const warm: SwitchSample[] = [];
    for (const { name } of FOLDERS) warm.push(await run(name));

    const table = [...cold.map((s) => ({ pass: 'cold', ...s })), ...warm.map((s) => ({ pass: 'warm', ...s }))];
    console.table(table);
    await test.info().attach('folder-switch-mobile.json', { body: JSON.stringify(table, null, 2), contentType: 'application/json' });

    for (const s of warm) expect(s.flashed, `${s.folder}: warm open flashed empty`).toBe(false);
    // Each row renders once, when it mounts: the layout's re-renders on the way never reach the rows.
    for (const s of [...cold, ...warm]) expect(s.rowRenders, `${s.folder}: rows re-rendered`).toBe(s.rowMounts);
  });
});

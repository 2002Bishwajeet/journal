import { test, expect } from '../fixtures';
import { foldersNav, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { installSwitchProbes, measureSwitch, type SwitchSample } from '../support/folderSwitch';

// #1219: a folder switch renders each note row once (timings are recorded, not asserted),
// and switching back to a folder already visited shows its notes with no "Loading..."
// or empty flash in between.

const FOLDERS = [
  { name: 'Alpha', count: 50 },
  { name: 'Bravo', count: 200 },
  { name: 'Charlie', count: 500 },
];

test('a folder switch renders each row once and a warm switch never flashes empty', async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);
  await installSwitchProbes(app);
  await app.reload();
  await app.evaluate(() => window.__journalE2E!.ready());
  await app.evaluate((folders) => window.__journalE2E!.seedFolders(folders), FOLDERS);
  for (const { name } of FOLDERS) await expect(foldersNav(app).getByRole('button', { name, exact: true })).toBeVisible();

  const cdp = await app.context().newCDPSession(app);
  await cdp.send('Performance.enable');
  const run = async (name: string) => measureSwitch(app, cdp, name, () => selectFolder(app, name));

  const cold: SwitchSample[] = [];
  for (const { name } of FOLDERS) cold.push(await run(name));
  const warm: SwitchSample[] = [];
  for (const { name } of FOLDERS) warm.push(await run(name));

  const table = [...cold.map((s) => ({ pass: 'cold', ...s })), ...warm.map((s) => ({ pass: 'warm', ...s }))];
  console.table(table);
  await test.info().attach('folder-switch.json', { body: JSON.stringify(table, null, 2), contentType: 'application/json' });

  for (const s of warm) expect(s.flashed, `${s.folder}: warm switch flashed empty`).toBe(false);
  // Each row renders once, when it mounts: the layout's re-renders on the way never reach the rows.
  for (const s of [...cold, ...warm]) expect(s.rowRenders, `${s.folder}: rows re-rendered`).toBe(s.rowMounts);
});

// Each opened note parks its own backlinks query in the same small cache as the folder
// lists, so reading a dozen notes used to push every visited folder out of it.
test('a visited folder stays warm after reading many notes', async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);
  await installSwitchProbes(app);
  await app.reload();
  await app.evaluate(() => window.__journalE2E!.ready());
  await app.evaluate((folders) => window.__journalE2E!.seedFolders(folders), FOLDERS.slice(0, 2));
  const cdp = await app.context().newCDPSession(app);
  await cdp.send('Performance.enable');

  await measureSwitch(app, cdp, 'Alpha', () => selectFolder(app, 'Alpha'));
  await measureSwitch(app, cdp, 'Bravo', () => selectFolder(app, 'Bravo'));
  const list = app.locator('[data-pane="note-list"]');
  for (let i = 1; i <= 15; i++) {
    await list.getByText(`Bravo ${i}`, { exact: true }).click();
    await expect(list.getByTestId('note-row').filter({ hasText: `Bravo ${i}` }).first().locator('.bg-accent')).toBeVisible();
  }
  const back = await measureSwitch(app, cdp, 'Alpha', () => selectFolder(app, 'Alpha'));
  console.table([back]);
  expect(back.flashed, 'Alpha flashed empty after reading notes').toBe(false);
});

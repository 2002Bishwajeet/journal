import { test, expect } from '../fixtures';
import { selectFolder } from '../support/actions';
import { FOLDERS, measureSwitch, setUpSwitching, switchColdThenWarm } from '../support/folderSwitch';

// #1219: a folder switch renders each note row once (timings are recorded, not asserted),
// and switching back to a folder already visited shows its notes with no "Loading..."
// or empty flash in between.

test('a folder switch renders each row once and a warm switch never flashes empty', async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  const cdp = await setUpSwitching(app);
  await switchColdThenWarm((name) => measureSwitch(app, cdp, name, () => selectFolder(app, name)), 'folder-switch.json');
});

// Each opened note parks its own backlinks query, and the folder lists used to share one
// small cache with them: reading a dozen notes pushed every visited folder out of it.
test('a visited folder stays warm after reading many notes', async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  const cdp = await setUpSwitching(app, FOLDERS.slice(0, 2));
  const list = app.locator('[data-pane="note-list"]');
  for (const name of ['Alpha', 'Bravo']) {
    await selectFolder(app, name);
    await expect(list.getByText(`${name} 1`, { exact: true })).toBeVisible();
  }
  for (let i = 1; i <= 15; i++) {
    await list.getByText(`Bravo ${i}`, { exact: true }).click();
    await expect(list.getByTestId('note-row').filter({ hasText: `Bravo ${i}` }).first().locator('.bg-accent')).toBeVisible();
  }
  const back = await measureSwitch(app, cdp, 'Alpha', () => selectFolder(app, 'Alpha'));
  console.table([back]);
  expect(back.flashed, 'Alpha flashed empty after reading notes').toBe(false);
});

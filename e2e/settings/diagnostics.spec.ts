import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { inBothThemes } from '../support/actions';

// Settings → Diagnostics (#800): from the sync badge, see what is pending and why, retry,
// and copy a redacted report. Six items are seeded (two with errors); the backend is
// unreachable here, so nothing syncs by itself.

async function openDiagnosticsFromSyncBadge(app: Page) {
  await assertTestOrigin(app);
  await app.evaluate(() => window.__journalE2E!.seedPendingSync());
  // A phone starts on the folder list; the sync badge is in the note list.
  if ((app.viewportSize()?.width ?? 1280) < 768) {
    await app.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).click();
  }
  await app.locator('button[aria-label="Sync status"]:visible').first().click();
  await app.getByRole('button', { name: /Pending items|Diagnostics/ }).click();

  const dialog = app.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'true');
  const panel = dialog.getByRole('tabpanel');
  const list = panel.getByRole('list', { name: 'Pending sync items' });
  await expect(list.getByTestId('pending-item')).toHaveCount(6);
  // The popover and dialog finish animating before a screenshot, or the shot is translucent.
  await app.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return { panel, list };
}

test('phone: the sync badge opens Diagnostics with every pending item and its error', async ({ app }) => {
  await app.setViewportSize({ width: 393, height: 852 });
  const { panel, list } = await openDiagnosticsFromSyncBadge(app);

  await expect(list).toContainText('Seeded note A');
  await expect(list).toContainText("Journal doesn't have permission for this");
  await expect(list).toContainText('HTTP 403 · Request failed with status code 403');
  await expect(list).toContainText("Couldn't reach your Homebase");
  await expect(list).toContainText('Network Error');
  await expect(list).toContainText('waiting to delete');
  await expect(list).toContainText('image/png');

  await inBothThemes(app, async (theme) => {
    await app.screenshot({ path: test.info().outputPath(`diagnostics-pending-${theme}-393x852.png`) });
  });

  // The report goes to the clipboard, and holds no titles, tokens or keys.
  await app.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(app.getByText('Copied diagnostics')).toBeVisible();
  const report = await app.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain('Journal diagnostics');
  expect(report).toContain('== Pending items (6) ==');
  expect(report).toContain('Request failed with status code 403');
  expect(report).not.toContain('Seeded note');
  expect(report).not.toMatch(/Bearer|shared.?secret|bx0900/i);

  // Retry now runs a sync, which the log shows.
  await panel.getByRole('button', { name: 'Retry now' }).click();
  const log = panel.getByRole('list', { name: 'Recent log' });
  await expect(log).toContainText('Retry now for the whole queue');
  await expect(log).toContainText('Sync started');
});

test('desktop: Diagnostics lists the pending items with their errors', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  const { panel, list } = await openDiagnosticsFromSyncBadge(app);

  await expect(list).toContainText('Request failed with status code 403');
  await expect(list).toContainText('Network Error');

  await inBothThemes(app, async (theme) => {
    await app.screenshot({ path: test.info().outputPath(`diagnostics-pending-${theme}-1280x800.png`) });
  });

  // A tapped note opens, and Settings closes.
  await panel.getByRole('button', { name: 'Seeded note A', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await expect(app).toHaveURL(/00000000-0000-4000-8000-000000000001/);
});

test('a refused share push lists the three owner console steps for the journal drive (#848)', async ({ app }) => {
  await app.setViewportSize({ width: 393, height: 852 });
  const { panel } = await openDiagnosticsFromSyncBadge(app);
  await expect(panel.getByTestId('share-notifications-off')).toBeHidden();

  // The backend is unreachable here, so the drive's state is unknown and every step shows.
  await app.evaluate(() => window.__journalE2E!.refuseSharePush());
  const notice = panel.getByTestId('share-notifications-off');
  await expect(notice.getByRole('listitem')).toHaveText([
    'Turn on "Allow subscriptions".',
    'Add the attribute IsCollaborativeChannel with the value true.',
    'Choose "Assign to an app" and pick Journal. The drive keeps its id and your notes.',
  ]);
  await expect(notice.getByRole('link', { name: 'Open drive settings' })).toHaveAttribute('href', /\/owner\/drives\//);

  await notice.scrollIntoViewIfNeeded();
  await inBothThemes(app, async (theme) => {
    await app.screenshot({ path: test.info().outputPath(`diagnostics-share-fixes-${theme}-393x852.png`) });
  });
});

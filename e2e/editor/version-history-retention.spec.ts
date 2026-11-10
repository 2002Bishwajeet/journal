import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// #1054: the daily snapshot prune and its byte budget thin out old weekly history, but a note
// with many sessions still lists one version for each recent day.

test('version history keeps every recent day after the daily prune', async ({ app }) => {
  const title = `Long history ${Date.now()}`;
  await createNote(app, { title, body: 'today' });
  const { docId } = (await app.evaluate(() => window.__journalE2E!.openNoteJSON()))!;
  await app.evaluate((id) => window.__journalE2E!.seedSnapshotHistory(id), docId);

  await app.getByRole('button', { name: 'Version history' }).click();
  const history = app.getByRole('dialog', { name: 'Version history' });
  // Each seeded version's preview is its label
  const version = (label: string) => history.getByRole('listitem').getByText(label, { exact: true });

  // Three snapshots a day for days 2-21 ago: the newest of each day stays
  for (let day = 2; day <= 21; day++) await expect(version(`day ${day}`)).toHaveCount(1);
  // One 8 KB snapshot a week for weeks 5-24 ago: the 32 KB budget keeps the two youngest
  await expect(version('week 5')).toHaveCount(1);
  await expect(version('week 6')).toHaveCount(1);
  await expect(history.getByRole('listitem').getByText(/^week \d+$/)).toHaveCount(2);
});

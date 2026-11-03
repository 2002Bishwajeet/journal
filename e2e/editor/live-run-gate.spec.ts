import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, inBothThemes, pastePlainText, reloadNote, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #947: an html block in a note someone else may have written waits for Run instead of
// running when the note opens. Once run, this device runs that code on its own.

const COUNTER =
  '<style>body{font-family:system-ui;margin:24px}</style><h2>Counter</h2><p>Clicked <b id="n">0</b> times.</p><button onclick="n.textContent=+n.textContent+1">Add one</button>';
const AUTHOR = 'e2e-author.homebase.test';

const block = (app: Page) => activeEditor(app).locator('[data-live-block="html"]');
const counter = (app: Page) => block(app).locator('iframe').contentFrame().getByRole('heading', { name: 'Counter' });

/** Screenshots the block with a little of the page around it. */
async function shoot(app: Page, target: Locator, name: string): Promise<void> {
  const box = (await target.boundingBox())!;
  const margin = 24;
  await app.screenshot({
    path: test.info().outputPath(name),
    clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin },
  });
}

test('html block: in a note shared with you it waits for Run, then runs, and runs on its own after a reload', async ({ app }) => {
  await assertTestOrigin(app);
  await createNote(app, { title: `Run gate ${Date.now()}`, body: 'Intro' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```html\n' + COUNTER + '\n```');

  // The owner's own note: the block runs as soon as it is there.
  await expect(counter(app)).toBeVisible();
  await waitForNoteSaved(app);

  const { docId } = (await app.evaluate(() => window.__journalE2E!.openNoteJSON()))!;
  await app.evaluate(([id, author]) => window.__journalE2E!.markSharedWithMe(id, author), [docId, AUTHOR] as const);
  // The note now reads as shared with this identity: a peer note has no version history.
  await expect(app.getByRole('button', { name: 'Version history' })).toHaveCount(0);
  await app.evaluate(() => window.__journalE2E!.syncToDisk());
  await reloadNote(app);
  await expect(app.getByRole('button', { name: 'Version history' })).toHaveCount(0);

  const run = block(app).getByRole('button', { name: 'Run HTML block' });
  await expect(run).toBeVisible();
  await expect(block(app)).toContainText('HTML block');
  await expect(block(app).locator('iframe')).toHaveCount(0);
  await inBothThemes(app, (theme) => shoot(app, block(app), `run-gate-${theme}-desktop.png`));
  await app.setViewportSize({ width: 390, height: 844 });
  await expect(run).toBeVisible();
  await inBothThemes(app, (theme) => shoot(app, block(app), `run-gate-${theme}-mobile.png`));
  await app.setViewportSize({ width: 1280, height: 900 });

  await run.click();
  await expect(counter(app)).toBeVisible();
  await expect(run).toHaveCount(0);
  await shoot(app, block(app), 'run-gate-after-run-dark-desktop.png');

  // This device ran this code: it runs on its own now.
  await reloadNote(app);
  await expect(counter(app)).toBeVisible();
  await expect(run).toHaveCount(0);
});

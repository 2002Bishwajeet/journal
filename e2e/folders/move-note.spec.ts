import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createFolder, createNote, foldersNav, inBothThemes, selectFolder, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #622: "Move to folder…" in a note's context menu. Backend-free: the notes never reach a
// server, so this covers the menu, the picker, the list following the move, and the
// public flag following the folder's. The share URLs themselves, and a second tab after
// sync, are covered by move-note.live.spec.ts.

const SHARED = 'Blog';
const PRIVATE = 'Drafts';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

const noteRow = (page: Page, title: string) => page.getByTestId('note-row').filter({ hasText: title });
const publicBadge = (page: Page, title: string) => noteRow(page, title).locator('svg.lucide-globe');

async function shot(page: Page, what: string, width: number) {
  await inBothThemes(page, (theme) =>
    page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${width}.png`), animations: 'disabled' })
  );
}

async function openPicker(page: Page, title: string, width: number, shoot: boolean) {
  await noteRow(page, title).click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: 'Move to folder…' });
  await expect(item).toBeVisible();
  if (shoot) await shot(page, 'move-note-menu', width);
  await item.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Move to folder');
  if (shoot) await shot(page, 'move-note-picker', width);
  return dialog;
}

test('moving a note to another folder shows it there, and its public state follows the folder', async ({ app }) => {
  // One run through two moves, a reload and the phone-sized views, with 8 screenshots.
  test.setTimeout(90_000);
  await app.setViewportSize(DESKTOP);
  await createFolder(app, SHARED);
  await createFolder(app, PRIVATE);
  await foldersNav(app).getByRole('button', { name: SHARED, exact: true }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Share folder' }).click();
  await expect(app.getByText('Folder shared.')).toBeVisible();

  await selectFolder(app, PRIVATE);
  await createNote(app, { title: 'Traveller', body: 'Moves around' });
  await createNote(app, { title: 'Stayer', body: 'Stays put' });
  await expect(publicBadge(app, 'Traveller')).toHaveCount(0);

  // The picker lists the other folders (not the current one), marking the shared one.
  const picker = await openPicker(app, 'Traveller', DESKTOP.width, true);
  await expect(picker.getByRole('button', { name: PRIVATE })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: /^Blog\s*Shared$/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Main' })).toBeVisible();

  // Into the shared folder: it leaves this list, arrives in the other one, and is public.
  await picker.getByRole('button', { name: /^Blog/ }).click();
  await expect(app.getByText(`Moved to ${SHARED}`)).toBeVisible();
  await expect(noteRow(app, 'Traveller')).toHaveCount(0);
  await expect(noteRow(app, 'Stayer')).toHaveCount(1);
  await selectFolder(app, SHARED);
  await expect(noteRow(app, 'Traveller')).toHaveCount(1);
  await expect(publicBadge(app, 'Traveller')).toHaveCount(1);

  // It stays there after a reload.
  await waitForNoteSaved(app);
  await assertTestOrigin(app);
  await app.reload();
  await waitForAppReady(app);
  await selectFolder(app, SHARED);
  await expect(noteRow(app, 'Traveller')).toHaveCount(1);
  await expect(publicBadge(app, 'Traveller')).toHaveCount(1);

  // Out of the shared folder into a private one: private again.
  const back = await openPicker(app, 'Traveller', DESKTOP.width, false);
  await back.getByRole('button', { name: PRIVATE }).click();
  await expect(app.getByText(`Moved to ${PRIVATE}`)).toBeVisible();
  await expect(noteRow(app, 'Traveller')).toHaveCount(0);
  await selectFolder(app, PRIVATE);
  await expect(noteRow(app, 'Traveller')).toHaveCount(1);
  await expect(publicBadge(app, 'Traveller')).toHaveCount(0);

  // Phone-sized: the same menu and picker. Forget the last note so the cold start stays on the sidebar.
  await waitForNoteSaved(app);
  await app.evaluate(() => localStorage.removeItem('journal-session-state'));
  await app.setViewportSize(MOBILE);
  await app.goto('/');
  await waitForAppReady(app);
  await selectFolder(app, PRIVATE);
  await openPicker(app, 'Traveller', MOBILE.width, true);
});

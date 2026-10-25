import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { activeEditor, activeTitleInput, openNote, screenshotInBothThemes, typeInEditor } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #792: on a phone the toolbar is hidden, so the header's More menu is the way
// into Version history. The dialog is a full-height sheet and closing it must
// not focus the editor (that opens the on-screen keyboard).

const PHONE = { width: 393, height: 852 };

test('on a phone, open Version history from More, restore a version, and keep the keyboard closed', async ({ browser }) => {
  await withFencedPage(
    browser,
    { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: PHONE, hasTouch: true, isMobile: true },
    async (page) => {
      // Snapshots are throttled to one per 5 minutes; a fake clock lets the test jump past that.
      await page.clock.install();
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);

      await page.getByRole('button', { name: 'Main' }).tap(); // the phone boots on the folder list
      const title = `History mobile ${Date.now()}`;
      const back = page.getByRole('button', { name: 'Back' });
      const editor = activeEditor(page);

      // createNote waits for a list row, which the phone hides once the editor is open.
      await page.getByRole('button', { name: 'New', exact: true }).tap();
      await expect(activeTitleInput(page)).toHaveValue('Untitled');
      await activeTitleInput(page).fill(title);
      await typeInEditor(page, 'first');
      await typeInEditor(page, ' draft');
      await back.tap(); // compacts → snapshot of "first draft"

      await openNote(page, title);
      await editor.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('second');
      await page.clock.fastForward('06:00');
      await back.tap(); // compacts → snapshot of "second"
      await openNote(page, title);
      await expect(editor).toHaveText('second');

      const more = page.getByRole('button', { name: 'More' });
      const box = (await more.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await more.tap();
      await page.getByRole('menuitem', { name: 'Version history' }).tap();

      const history = page.getByRole('dialog', { name: 'Version history' });
      await expect(history).toBeVisible();
      const sheet = (await history.boundingBox())!;
      expect(sheet.x).toBeGreaterThanOrEqual(0);
      expect(sheet.y).toBeGreaterThanOrEqual(0);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(PHONE.width);
      expect(sheet.y + sheet.height).toBeLessThanOrEqual(PHONE.height);

      const firstVersion = history.getByRole('listitem').filter({ hasText: 'first' });
      await expect(firstVersion).toHaveCount(1);
      const restore = firstVersion.getByRole('button', { name: 'Restore' });
      // Polled: the dialog's open animation scales it for its first 200 ms.
      await expect.poll(async () => (await restore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await screenshotInBothThemes(page, (theme) => `version-history-${theme}-393.png`, undefined, { animations: 'disabled' });

      await restore.tap();
      const confirm = page.getByRole('dialog', { name: 'Restore this version?' });
      await expect(confirm).not.toContainText('Cmd+Z');
      await confirm.getByRole('button', { name: 'Restore' }).tap();

      await expect(history).toBeHidden();
      await expect(confirm).toBeHidden();
      await expect(editor).toHaveText('first draft');
      expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(false);
    },
  );
});

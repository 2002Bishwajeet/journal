import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { createFolder, createNote, foldersNav, screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { withMobilePage } from '../support/mobile';

// #787: screenshots of every dialog, sheet and action sheet the polish pass touches, at a
// 393 px phone with a notch and at 1280 px, in both themes. Run it on main for the "before" set.

const PHONE = '393';
const DESKTOP = { width: 1280, height: 800 };
const JOURNAL_DRIVE = { alias: 'd5f411fa83fd4854a3bd7e974cc9bca9', type: '30743710039d4b97bbd352f343d1c9df' };

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP safe-area emulation is Chromium only');
});

const shoot = (page: Page, what: string, size: string) =>
  screenshotInBothThemes(page, (theme) => `${what}-${theme}-${size}.png`, undefined, { animations: 'disabled' });

async function settled(dialog: Locator) {
  await expect(dialog).toBeVisible();
  // A page that remounts cancels its animation, which rejects `finished`; that one has settled too.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
}

async function rowMenu(page: Page, title: string, item?: string) {
  await page.locator('[data-testid=note-row]:visible').filter({ hasText: title }).first().click({ button: 'right', position: { x: 12, y: 12 } });
  const menu = page.getByRole('menu');
  await settled(menu);
  // Not exact: on desktop an item carries its shortcut ("Move to Trash ⌫").
  if (item) await menu.getByRole('menuitem', { name: item }).click();
  return menu;
}

async function folderMenu(page: Page, name: string, item: string) {
  const box = (await foldersNav(page).getByRole('button', { name, exact: true }).boundingBox())!;
  await page.mouse.click(box.x + 24, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

async function close(page: Page, dialog: Locator) {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** Opens and shoots each surface on `page`, which is already at the size named by `size`. */
async function shootAll(page: Page, size: string, phone: boolean) {
  // Settings: the list (phone) and every section.
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settled(settings);
  if (phone) {
    await shoot(page, 'settings-list', size);
    const rows = settings.locator('ul button');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const label = (await rows.nth(i).locator('[id^=settings-row-]').textContent())!;
      await rows.nth(i).click();
      await settled(settings.getByRole('region', { name: label }));
      await shoot(page, `settings-${label.toLowerCase().replace(/\W+/g, '-')}`, size);
      await settings.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(settings.getByRole('region')).toHaveCount(0);
    }
    await settings.getByRole('button', { name: 'Done' }).click();
    await expect(settings).toBeHidden();
  } else {
    const tabs = settings.getByRole('tab');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const label = (await tabs.nth(i).textContent())!.trim();
      await tabs.nth(i).click();
      await shoot(page, `settings-${label.toLowerCase().replace(/\W+/g, '-')}`, size);
    }
    await close(page, settings);
  }

  // Folders: New folder, then Share folder on the new one.
  await page.getByRole('button', { name: 'New folder' }).click();
  const newFolder = page.getByRole('dialog', { name: /folder/i });
  await settled(newFolder);
  await shoot(page, 'new-folder', size);
  await close(page, newFolder);
  await createFolder(page, `Trips ${size}`);
  await folderMenu(page, `Trips ${size}`, 'Share folder…');
  const shareFolder = page.getByRole('dialog', { name: 'Share Folder' });
  await settled(shareFolder);
  await shoot(page, 'share-folder', size);
  await close(page, shareFolder);

  const title = `Polish note ${size}`;
  if (phone) {
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await page.getByRole('textbox', { name: 'Note title' }).fill(title);
    await page.getByRole('button', { name: /^Back to (?!notes$)/ }).tap();
    await expect.poll(() => new URL(page.url()).pathname.split('/').filter(Boolean).length).toBe(1);
  } else {
    await createNote(page, { title, body: 'body' });
  }

  // Share Note and its row menu (the action sheet on a phone).
  await rowMenu(page, title);
  await shoot(page, 'note-row-actions', size);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Share…', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share Note' });
  await settled(share);
  await shoot(page, 'share-note', size);
  await close(page, share);

  await rowMenu(page, title, 'Move to folder…');
  const move = page.getByRole('dialog');
  await settled(move);
  await shoot(page, 'move-to-folder', size);
  await close(page, move);

  await rowMenu(page, title, 'Move to Trash');
  const trash = page.getByRole('dialog', { name: 'Move to Trash?' });
  await settled(trash);
  await shoot(page, 'trash-confirm', size);
  await close(page, trash);

  // What's new: an older last-seen version shows it on boot.
  await page.evaluate(() => localStorage.setItem('journal-last-seen-version', '2.3.0'));
  await page.reload();
  await waitForAppReady(page);
  const whatsNew = page.getByRole('dialog', { name: "What's new" });
  await settled(whatsNew);
  await shoot(page, 'whats-new', size);
  await whatsNew.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(whatsNew).toBeHidden();

  // The permissions prompt: the security context grants the drive but no permission keys.
  await page.unroute('**/security/context**');
  await page.route('**/security/context**', (route) =>
    route.fulfill({
      json: {
        caller: { odinId: 'e2e-owner.homebase.test', securityLevel: 'owner' },
        permissionContext: {
          permissionGroups: [{ driveGrants: [{ permissionedDrive: { drive: JOURNAL_DRIVE, permission: 'readWrite' } }], permissionSet: { keys: [] } }],
        },
      },
    }),
  );
  await page.reload();
  await waitForAppReady(page);
  const permissions = page.getByRole('dialog', { name: /^Journal needs/ });
  await settled(permissions);
  await shoot(page, 'permissions', size);
}

test('phone 393: every dialog, sheet and action sheet', async ({ browser }) => {
  test.setTimeout(180_000);
  await withMobilePage(browser, async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
    await shootAll(page, PHONE, true);
  });
});

test('desktop 1280: the same dialogs', async ({ browser }) => {
  test.setTimeout(180_000);
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: DESKTOP }, async (page) => {
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);
    await shootAll(page, '1280', false);
  });
});

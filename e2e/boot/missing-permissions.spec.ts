import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { screenshotInBothThemes } from '../support/actions';

// The "Journal needs N permissions" prompt: it lists each missing permission with
// its reason, "Not now" hides it for this identity and this missing set, Settings keeps
// a way to grant, and a changed missing set brings the prompt back.

const JOURNAL_DRIVE = { alias: 'd5f411fa83fd4854a3bd7e974cc9bca9', type: '30743710039d4b97bbd352f343d1c9df' };

// Plain JSON: the client decrypts a response only when it carries {iv, data}.
async function stubSecurityContext(page: Page, { withDrive }: { withDrive: boolean }): Promise<void> {
  await page.unroute('**/security/context**');
  await page.route('**/security/context**', (route) =>
    route.fulfill({
      json: {
        caller: { odinId: 'e2e-owner.homebase.test', securityLevel: 'owner' },
        permissionContext: {
          permissionGroups: [
            {
              driveGrants: withDrive
                ? [{ permissionedDrive: { drive: JOURNAL_DRIVE, permission: 'readWrite' } }]
                : [],
              // Neither ReadConnections nor SendPushNotifications: the v2.17.0 upgrade case.
              permissionSet: { keys: [] },
            },
          ],
        },
      },
    }),
  );
}

async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await waitForAppReady(page);
}

const prompt = (page: Page) => page.getByRole('dialog', { name: /^Journal needs/ });

test('missing permissions: list, Not now, Settings, and a changed set', async ({ app }) => {
  await stubSecurityContext(app, { withDrive: true });
  await app.setViewportSize({ width: 390, height: 844 });
  await reloadApp(app);

  const dialog = prompt(app);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText('Journal needs 2 permissions');
  const items = dialog.getByRole('list', { name: 'Missing permissions' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('See your connections');
  await expect(items.nth(0)).toContainText('find notes that people share with you');
  await expect(items.nth(1)).toContainText('Send notifications');
  await expect(dialog.getByRole('link', { name: 'Grant permissions' })).toHaveAttribute(
    'href',
    /^https:\/\/e2e-owner\.homebase\.test\/owner\/appupdate\?/,
  );

  // Fits a phone screen without scrolling.
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  // 44px touch targets on a phone (#783).
  for (const target of [dialog.getByRole('link', { name: 'Grant permissions' }), dialog.getByRole('button', { name: 'Not now' })]) {
    expect(Math.round((await target.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  }
  await screenshotInBothThemes(app, (theme) => `prompt-${theme}-mobile.png`, undefined, { animations: 'disabled' });
  await app.setViewportSize({ width: 1280, height: 800 });
  await screenshotInBothThemes(app, (theme) => `prompt-${theme}-desktop.png`, undefined, { animations: 'disabled' });

  await expect(dialog).toContainText("Journal doesn't have some access it needs. Some features won't work until you grant them.");
  // A backdrop tap does not dismiss it.
  await app.mouse.click(10, 10);
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();

  // After a reload it stays hidden; Settings still offers the grant.
  await reloadApp(app);
  await app.getByRole('button', { name: 'Settings' }).click();
  const settings = app.getByRole('dialog');
  await settings.getByRole('tab', { name: 'Account', exact: true }).click();
  await expect(settings.getByText("Journal needs 2 permissions. Some features won't work until you grant them.")).toBeVisible();
  await expect(settings.getByRole('link', { name: 'Grant' })).toHaveAttribute('href', /\/owner\/appupdate\?/);
  await expect(prompt(app)).toHaveCount(0);
  await screenshotInBothThemes(app, (theme) => `settings-${theme}-desktop.png`, undefined, { animations: 'disabled' });
  await app.keyboard.press('Escape');

  // A new missing set (the drive grant is gone too) shows the prompt again.
  await stubSecurityContext(app, { withDrive: false });
  await reloadApp(app);
  await expect(prompt(app).getByRole('heading')).toHaveText('Journal needs 3 permissions');
  await expect(prompt(app).getByRole('listitem').nth(2)).toContainText('Store your notes');
});

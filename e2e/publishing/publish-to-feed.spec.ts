import type { Page } from '@playwright/test';
import { ContactConfig } from '@homebase-id/js-lib/network';
import { BlogConfig } from '@homebase-id/js-lib/public';
import { test, expect } from '../fixtures';
import { createNote, inBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { shareDialog } from '../support/shareDialog';

// #1074: Publish to feed asks for write access to the feed's public channel on the first press,
// not at sign-in. Hermetic: the security context and the owner console's consent page are
// answered here; the post itself is published in the live tier.

const IDENTITY = 'e2e-owner.homebase.test';
const JOURNAL_DRIVE_ALIAS = 'd5f411fa83fd4854a3bd7e974cc9bca9';
const DESKTOP = { width: 1280, height: 720 } as const;
const PHONE = { width: 390, height: 844 } as const;

/** The app holds its grants for sharing with people (journal and contacts drives, collaboration keys), not the feed drive. */
async function serveSecurityContext(page: Page): Promise<void> {
  await page.route(`https://${IDENTITY}/api/apps/v1/security/context**`, (route) =>
    route.fulfill({
      json: {
        caller: { odinId: IDENTITY, securityLevel: 'owner' },
        permissionContext: {
          permissionGroups: [{
            driveGrants: [
              { permissionedDrive: { drive: { alias: JOURNAL_DRIVE_ALIAS, type: '30743710039d4b97bbd352f343d1c9df' }, permission: 'readwrite' } },
              { permissionedDrive: { drive: ContactConfig.ContactTargetDrive, permission: 'read' } },
            ],
            permissionSet: { keys: [10, 50, 210, 305, 405] },
          }],
        },
      },
    }),
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  await test.info().attach(name, { path: test.info().outputPath(`${name}.png`), contentType: 'image/png' });
}

test('the first Publish to feed asks for feed access only, and a refusal leaves the note unpublished', async ({ app }) => {
  await assertTestOrigin(app);
  await serveSecurityContext(app);
  const consentUrls: URL[] = [];
  // The owner console's extend-permissions page; a page route takes precedence over the fence
  await app.route(`https://${IDENTITY}/owner/appupdate**`, (route) => {
    consentUrls.push(new URL(route.request().url()));
    return route.fulfill({ contentType: 'text/html', body: '<h1>Homebase consent</h1>' });
  });

  await app.setViewportSize(DESKTOP);
  const title = `Feed publish ${Date.now()}`;
  await createNote(app, { title, body: 'A note for the feed.' });
  await app.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Share' }).click();

  const dialog = shareDialog(app);
  const publish = dialog.getByRole('button', { name: 'Publish to feed' });
  await expect(publish).toBeEnabled();
  await publish.scrollIntoViewIfNeeded();
  await inBothThemes(app, (theme) => shoot(app, `feed-${theme}-1280`));
  await app.setViewportSize(PHONE);
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await publish.scrollIntoViewIfNeeded();
  await inBothThemes(app, (theme) => shoot(app, `feed-${theme}-390`));
  await app.setViewportSize(DESKTOP);

  await publish.click();
  await expect(app.getByRole('heading', { name: 'Homebase consent' })).toBeVisible();
  const [consent] = consentUrls;
  const drives = JSON.parse(consent.searchParams.get('d')!) as { a: string; p: number }[];
  // Read + Write on the public channel, nothing more
  expect(drives).toEqual([expect.objectContaining({ a: BlogConfig.PublicChannelId, p: 3 })]);
  expect(consent.searchParams.get('d')).not.toContain(JOURNAL_DRIVE_ALIAS);

  // The owner declines and Homebase sends them back to the dialog
  await app.goto(consent.searchParams.get('return')!);
  await assertTestOrigin(app);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Publishing to your feed needs permission')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Publish to feed' })).toBeEnabled();
  await shoot(app, 'feed-declined-1280');

  // Pressing it again asks again
  await dialog.getByRole('button', { name: 'Publish to feed' }).click();
  await expect(app.getByRole('heading', { name: 'Homebase consent' })).toBeVisible();
  expect(consentUrls).toHaveLength(2);
});

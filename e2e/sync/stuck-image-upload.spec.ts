import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { screenshotInBothThemes } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #874: an image upload the server refuses with a 400 (here the 25-payloads-per-file
// limit an owner's photo-heavy note hit) shows the server's reason, is never sent
// again, and Discard takes it out of the queue. The note header and the 400 are
// answered here; the note is on the "server", the images are queued on this device.

const NOTE_ID = '00000000-0000-4000-8000-000000000001';
const REFUSAL = {
    type: 'https://tools.ietf.org/html/rfc7231',
    title: 'Too many Payloads count 26 in FileMetadata max 25',
    status: 400,
    errorCode: 'unhandledScenario',
};

const noteHeader = {
    fileId: 'seeded-remote-note',
    fileState: 'active',
    fileSystemType: 'Standard',
    fileMetadata: {
        isEncrypted: false,
        versionTag: 'seeded-version',
        created: 1,
        updated: 1,
        payloads: [],
        appData: { uniqueId: NOTE_ID, fileType: 605, dataType: 0, content: JSON.stringify({ title: 'Trip photos' }) },
    },
    serverMetadata: { accessControlList: { requiredSecurityGroup: 'Owner' } },
    sharedSecretEncryptedKeyHeader: { iv: '', encryptedAesKey: '', encryptionVersion: 1, type: 11 },
};

const settled = (page: import('@playwright/test').Page) =>
    page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

test('phone: a refused image upload shows the reason, stops retrying, and Discard empties the queue', async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await assertTestOrigin(app);

    let updates = 0;
    await app.route('**/drive/query/specialized/cuid/header**', (route) => route.fulfill({ json: noteHeader }));
    await app.route('**/drive/files/update**', (route) => {
        updates++;
        return route.fulfill({ status: 400, json: REFUSAL });
    });

    const images = [makeSolidPng(800, 600, [200, 60, 60]), makeSolidPng(800, 600, [60, 120, 200])].map((b) => [...b]);
    await app.evaluate(async (bytes) => {
        await window.__journalE2E!.seedImageUploads('Trip photos', bytes);
        await window.__journalE2E!.uploadPendingImages();
    }, images);
    expect(updates).toBe(2);

    // A 4xx is permanent: the next sync pass sends nothing
    await app.evaluate(() => window.__journalE2E!.uploadPendingImages());
    expect(updates).toBe(2);

    // The sync badge says they couldn't sync (the count refreshes with the app's next sync pass)
    await app.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).click();
    const couldntSync = app.getByRole('button', { name: /Couldn't sync/ });
    await expect(async () => {
        await app.keyboard.press('Escape');
        await app.locator('button[aria-label="Sync status"]:visible').first().click();
        await expect(couldntSync).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(couldntSync).toContainText('2');
    await settled(app);
    await screenshotInBothThemes(app, (theme) => `sync-status-couldnt-sync-${theme}-390.png`);

    await couldntSync.click();
    const dialog = app.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'true');
    const list = dialog.getByRole('list', { name: 'Pending sync items' });
    const rows = list.getByTestId('pending-item');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Image in "Trip photos"');
    await expect(rows.first()).toContainText('Failed');
    await expect(rows.first()).toContainText('more images than your Homebase allows');
    await expect(rows.first()).toContainText('unhandledScenario · HTTP 400: Too many Payloads count 26 in FileMetadata max 25');
    // The image itself, from the bytes on this device
    await expect.poll(() => rows.first().locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(800);
    // The log has the reason and the image id
    await expect(dialog.getByRole('list', { name: 'Recent log' })).toContainText(
        'upload of image 00000000-0000-4000-8000-000000000010 failed (unhandledScenario): HTTP 400: Too many Payloads',
    );
    await settled(app);
    await screenshotInBothThemes(app, (theme) => `diagnostics-stuck-images-${theme}-390.png`);

    // Discard all asks first and says what is lost
    await dialog.getByRole('button', { name: 'Discard all 2 failed images' }).click();
    const confirm = app.getByRole('dialog', { name: 'Discard 2 image uploads?' });
    await expect(confirm).toContainText("The images stay in their notes on this device, but they won't sync");
    await settled(app);
    await screenshotInBothThemes(app, (theme) => `diagnostics-discard-confirm-${theme}-390.png`);
    await confirm.getByRole('button', { name: 'Discard', exact: true }).click();

    await expect(dialog.getByText('Nothing is waiting to sync.')).toBeVisible();
    expect(updates).toBe(2);
});

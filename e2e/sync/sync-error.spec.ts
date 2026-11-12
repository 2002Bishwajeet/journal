import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1170: a sync the Homebase fails shows Sync Error until a sync that works. The hermetic
// fence aborting every drive request is not such a failure, or every run would show one.

test('a server error shows Sync Error until a sync works; the fenced-off drive does not', async ({ app }) => {
    await assertTestOrigin(app);
    await app.locator('button[aria-label="Sync status"]:visible').first().click();
    const label = app.getByRole('dialog').locator('span.font-medium').first();
    const syncNow = app.getByRole('button', { name: 'Sync now' });

    // Booted: the boot sync's requests were all aborted by the fence
    await expect(label).toHaveText('Synced', { timeout: 15_000 });

    await app.route('https://*.homebase.test/**', (route) => route.fulfill({ status: 503, json: {} }));
    await expect(async () => {
        await syncNow.click();
        await expect(label).toHaveText('Sync Error', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    // Fenced off again: no error (the 503 run may have left a change waiting)
    await app.unroute('https://*.homebase.test/**');
    await expect(async () => {
        await syncNow.click();
        await expect(label).toHaveText(/^(Synced|Changes Pending)$/, { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
});

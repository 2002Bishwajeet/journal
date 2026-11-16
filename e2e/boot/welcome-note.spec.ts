import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { waitForNoteSaved } from '../support/actions';

// #1283: the first sign-in of an identity with no notes gets one "Welcome to Journal" note, opened.
// The hermetic storage state skips it for every other spec (e2e-skip-welcome-note); this one lifts that.
test('a fresh identity gets one welcome note, opened, and never a second', async ({ browser }) => {
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
    await page.context().addInitScript(() => localStorage.removeItem('e2e-skip-welcome-note'));
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);

    const rows = page.getByTestId('note-row').filter({ hasText: 'Welcome to Journal' });
    await expect(rows).toHaveCount(1);
    await expect(page.locator('.ProseMirror:visible').getByText('Start here')).toBeVisible();
    await expect(page.locator('.ProseMirror:visible').getByRole('table')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('welcome-note.png') });

    await waitForNoteSaved(page);
    await page.reload();
    await assertTestOrigin(page);
    await waitForAppReady(page);
    await expect(rows).toHaveCount(1);
    // Give a second seed attempt time to (wrongly) happen: the sync pass settles after boot.
    await expect(page.getByTestId('note-row')).toHaveCount(1);
  });
});

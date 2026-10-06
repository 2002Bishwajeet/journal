import { test, expect, waitForAppReady } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

const KEY = 'journal-last-seen-version';

test('shows the skipped versions once after an update', async ({ app }) => {
  await assertTestOrigin(app);
  await app.evaluate((key) => localStorage.setItem(key, '2.1.2'), KEY);
  await app.reload();
  await waitForAppReady(app);

  const dialog = app.getByRole('dialog', { name: "What's new" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^v2\.2\.0/ })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^v2\.1\.2/ })).toHaveCount(0);

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 780 }]] as const) {
      await app.emulateMedia({ colorScheme });
      await app.setViewportSize(size);
      await app.screenshot({ path: test.info().outputPath(`whats-new-${colorScheme}-${label}.png`) });
    }
  }

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await app.reload();
  await waitForAppReady(app);
  await expect(app.getByRole('dialog', { name: "What's new" })).toHaveCount(0);
});

test('a fresh install shows no dialog', async ({ app }) => {
  await assertTestOrigin(app);
  await app.evaluate((key) => localStorage.removeItem(key), KEY);
  await app.reload();
  await waitForAppReady(app);
  await expect(app.getByRole('dialog', { name: "What's new" })).toHaveCount(0);
  expect(await app.evaluate((key) => localStorage.getItem(key), KEY)).not.toBeNull();
});

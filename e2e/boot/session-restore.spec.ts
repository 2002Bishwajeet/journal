import { test, expect } from '../fixtures';

test('signed-in shell renders and survives a reload', async ({ app }) => {
  await expect(app).not.toHaveURL(/\/welcome/);
  await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();

  await app.reload();
  await app.evaluate(() => window.__journalE2E!.ready());

  await expect(app).not.toHaveURL(/\/welcome/);
  await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
});

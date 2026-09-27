import { test, expect, waitForAppReady } from '../fixtures';

test('signed-in shell renders and survives a reload', async ({ app }) => {
  await expect(app).not.toHaveURL(/\/welcome/);
  await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();

  await app.reload();
  await waitForAppReady(app);

  await expect(app).not.toHaveURL(/\/welcome/);
  await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
});

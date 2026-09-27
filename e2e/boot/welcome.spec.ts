import { test, expect } from '../fixtures';

test('signed-out root redirects to /welcome and renders the landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

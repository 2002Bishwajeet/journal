import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

test('throws when the page is not on an allowlisted test origin', async ({ page }) => {
  await page.goto('about:blank');
  await expect(assertTestOrigin(page)).rejects.toThrow('Refusing to run on');
});

test('passes when the page is on an allowlisted test origin', async ({ page }) => {
  await page.goto('/welcome');
  await expect(assertTestOrigin(page)).resolves.toBeUndefined();
});

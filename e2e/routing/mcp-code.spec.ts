import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { decodeMcpLoginCode } from '../../src/lib/mcpLoginCode';

// #498: /mcp/code is public. It turns identity/public_key/salt from the query
// into a paste-able login code, without redirecting a logged-out visitor and
// without booting the database.

test('logged-out visitor sees a decodable code and a Copy button', async ({ anonPage: page }) => {
  await page.goto('/mcp/code?identity=a.example&public_key=PK&salt=S');
  await assertTestOrigin(page);

  const code = page.getByTestId('mcp-login-code');
  await expect(code).toBeVisible();
  expect(decodeMcpLoginCode((await code.textContent()) ?? '')).toEqual({
    identity: 'a.example',
    public_key: 'PK',
    salt: 'S',
  });
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(page).toHaveURL(/\/mcp\/code\?/);

  // No PGlite database was opened.
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
  expect(dbs.filter((n) => /pglite/i.test(n))).toEqual([]);
});

test('missing params show the error state', async ({ anonPage: page }) => {
  await page.goto('/mcp/code');
  await assertTestOrigin(page);
  await expect(page.getByRole('alert')).toContainText('Missing login details');
  await expect(page.getByTestId('mcp-login-code')).toHaveCount(0);
  await expect(page).toHaveURL(/\/mcp\/code$/);
});

import { test, expect } from '../fixtures';

// The 4.8 MB mermaid chunk loads only when a mermaid block is previewed. It once
// rode along on every boot because Vite's dynamic-import helper was bundled into it.

test('booting the app does not fetch the mermaid chunk', async ({ app }) => {
  const loaded = await app.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(loaded.some((url) => /\/assets\/.*\.js$/.test(url))).toBe(true);
  expect(loaded.filter((url) => /\/assets\/mermaid-/.test(url))).toEqual([]);
});

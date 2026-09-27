import { test as base, expect } from '@playwright/test';
import { assertAllowedOrigin } from './support/origin-guard';

export { expect };

// Auto fixture: fails fast, before any test body runs, if the configured
// baseURL isn't one of the allowlisted test origins. Catches a misconfigured
// run (e.g. E2E_SERVER pointed somewhere else) before it can touch a page.
export const test = base.extend<{ assertBaseUrlIsTestOrigin: void }>({
  assertBaseUrlIsTestOrigin: [
    async ({ baseURL }, use) => {
      assertAllowedOrigin(baseURL);
      await use();
    },
    { auto: true },
  ],
});

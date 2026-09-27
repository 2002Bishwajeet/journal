import type { Page } from '@playwright/test';

// Isolation is by HOSTNAME, never by port alone: ports on the same host share
// cookies. A browser-test script once ran against the real dev.dotyou.cloud
// origin and destroyed local data — every mutating test setup must assert
// location.origin against this allowlist before touching storage.
export const TEST_ORIGINS = [
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5174',
  'https://e2e.dotyou.cloud:4443',
];

export function assertAllowedOrigin(origin: string | undefined): void {
  if (!origin || !TEST_ORIGINS.includes(origin)) {
    throw new Error(`Refusing to run on ${origin}`);
  }
}

export async function assertTestOrigin(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  assertAllowedOrigin(origin);

  const inPageOrigin = await page.evaluate(() => location.origin);
  if (inPageOrigin !== origin) {
    throw new Error(`Refusing to run on ${inPageOrigin}`);
  }
}

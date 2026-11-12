import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// #1188: the web signs in by navigating to the identity's YouAuth page and back to
// /auth/finalize, as before. The native app (here, the iOS flag and a stub of Tauri's
// IPC) asks the browser plugin for an auth session that returns on journal://, and
// opens external links through the plugin instead of in its own web view.

const IDENTITY = 'alice.homebase.test';
const AUTHORIZE = `https://${IDENTITY}/api/owner/v1/youauth/authorize`;

async function stubIdentity(page: Page) {
  await page.route(`https://${IDENTITY}/api/guest/v1/auth/ident`, (route) =>
    route.fulfill({ json: { odinId: IDENTITY } }),
  );
}

async function signIn(page: Page) {
  await page.getByLabel('Identity').fill(IDENTITY);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('web: Continue navigates to the YouAuth page, which returns to /auth/finalize', async ({ anonPage: page, baseURL }) => {
  await stubIdentity(page);
  await page.route(`${AUTHORIZE}?**`, (route) => route.fulfill({ body: 'authorize page' }));
  await page.goto('/welcome');
  await signIn(page);

  await page.waitForURL(`${AUTHORIZE}?**`);
  const url = new URL(page.url());
  expect(url.searchParams.get('redirect_uri')).toBe(`${baseURL}/auth/finalize`);
  expect(url.searchParams.get('state')).toBe(`${baseURL}/`);
});

test('iOS app: sign-in runs in an auth session and external links open in the plugin', async ({ anonPage: page, baseURL }) => {
  await stubIdentity(page);
  // Recorded on the test side, so the calls outlive the navigation to /auth/finalize.
  const ipc: { cmd: string; args: Record<string, unknown> }[] = [];
  await page.exposeFunction('recordIpc', (cmd: string, args: Record<string, unknown>) => ipc.push({ cmd, args }));
  await page.addInitScript(() => {
    window.__JOURNAL_NATIVE__ = { platform: 'ios' };
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        await (window as unknown as { recordIpc: (cmd: string, args: unknown) => Promise<void> }).recordIpc(cmd, args);
        // The identity's redirect, as ASWebAuthenticationSession hands it back.
        if (cmd === 'plugin:browser|authenticate') {
          return { url: 'journal://auth/finalize?identity=alice.homebase.test&public_key=pk&salt=s&state=%2F' };
        }
        return null;
      },
    };
  });

  await page.goto('/welcome');
  await page.getByRole('link', { name: 'Create an identity' }).click();
  await expect.poll(() => ipc).toEqual([{ cmd: 'plugin:browser|open_url', args: { url: 'https://homebase.id/' } }]);
  await expect(page).toHaveURL(/\/welcome$/);

  // A full navigation, as the web's return from the identity is.
  const finalize = page.waitForRequest((r) => r.isNavigationRequest() && r.url().includes('/auth/finalize'));
  await signIn(page);
  expect((await finalize).url()).toBe(`${baseURL}/auth/finalize?identity=alice.homebase.test&public_key=pk&salt=s&state=%2F`);

  const [, auth] = ipc as { cmd: string; args: { url: string; callbackScheme: string } }[];
  expect(auth.cmd).toBe('plugin:browser|authenticate');
  expect(auth.args.callbackScheme).toBe('journal');
  const authorize = new URL(auth.args.url);
  expect(`${authorize.origin}${authorize.pathname}`).toBe(AUTHORIZE);
  expect(authorize.searchParams.get('redirect_uri')).toBe('journal://auth/finalize');
});

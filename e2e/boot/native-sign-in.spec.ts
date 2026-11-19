import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { fakeKeychain } from '../support/fakeKeychain';

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
  // A clean profile opens on the welcome step (#1282).
  await page.getByRole('button', { name: 'I have an identity' }).click();
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
  // Only the browser plugin's calls: the app also reads its keychain (#1429), which is not what this is about.
  const browserCalls = () => ipc.filter((call) => call.cmd.startsWith('plugin:browser|'));
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
  // The keychain holds no sign-in on this fake device (#1429).
  await fakeKeychain(page);

  await page.goto('/welcome');
  // The welcome step's sign-up button (#1282) opens in the in-app browser, as links do.
  await page.getByRole('link', { name: 'Create your Homebase identity' }).click();
  await expect.poll(browserCalls).toEqual([{ cmd: 'plugin:browser|open_url', args: { url: 'https://homebase.id/' } }]);
  await expect(page).toHaveURL(/\/welcome$/);
  // The iOS app is Journal. Without the store plugin (journal-iap) it sells nothing: no trial line.
  await expect(page.getByRole('heading', { name: 'Welcome to Journal' })).toBeVisible();
  await expect(page.getByText(/Free for 3 days/)).toHaveCount(0);

  // A full navigation, as the web's return from the identity is.
  const finalize = page.waitForRequest((r) => r.isNavigationRequest() && r.url().includes('/auth/finalize'));
  await signIn(page);
  expect((await finalize).url()).toBe(`${baseURL}/auth/finalize?identity=alice.homebase.test&public_key=pk&salt=s&state=%2F`);

  const [, auth] = browserCalls() as { cmd: string; args: { url: string; callbackScheme: string } }[];
  expect(auth.cmd).toBe('plugin:browser|authenticate');
  expect(auth.args.callbackScheme).toBe('journal');
  const authorize = new URL(auth.args.url);
  expect(`${authorize.origin}${authorize.pathname}`).toBe(AUTHORIZE);
  expect(authorize.searchParams.get('redirect_uri')).toBe('journal://auth/finalize');
});

import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { inBothThemes } from '../support/actions';

// Settings > Notifications "Send test": shown only when this device is subscribed, it asks the
// identity's app push API to push to itself, and it says what failed (403 points to the grant).

// The hermetic project blocks service workers: fake a granted permission and a subscription.
async function fakeSubscribedDevice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    const pushManager = { getSubscription: async () => ({ endpoint: 'https://push.example/e2e' }) };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async () => ({ pushManager }) });
  });
  await page.reload();
  await waitForAppReady(page);
}

test('send test notification: success, then a 403 that points to the grant', async ({ app }) => {
  await fakeSubscribedDevice(app);
  const bodies: unknown[] = [];
  let status = 200;
  await app.route('**/api/apps/v1/notify/push/push', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill(status === 200 ? { json: {} } : { status, json: { errorCode: 'forbidden' } });
  });

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Notifications', exact: true }).click();
  const panel = dialog.getByRole('tabpanel');
  await expect(panel).toContainText('On for this device');
  await expect(panel).toContainText('Every device where you turned on notifications gets it.');

  const send = panel.getByRole('button', { name: 'Send test notification' });
  await send.click();
  await expect(panel).toContainText('Sent. Every device where you turned on notifications gets it.');
  expect(bodies).toHaveLength(1);
  await expect(send).toBeEnabled();

  // No hover state on the button in the shots.
  await app.mouse.move(0, 0);
  const shoot = (name: string) =>
    inBothThemes(app, (theme) =>
      app.screenshot({ path: test.info().outputPath(`${name}-${theme}.png`), animations: 'disabled' }),
    );
  await app.setViewportSize({ width: 1280, height: 800 });
  await shoot('test-push-sent-desktop');
  await app.setViewportSize({ width: 390, height: 844 });
  await shoot('test-push-sent-mobile');

  status = 403;
  await send.click();
  await expect(panel).toContainText(
    'Journal does not have permission to send notifications. Grant it in Settings > Account > Permissions.',
  );
  await shoot('test-push-forbidden-mobile');
});

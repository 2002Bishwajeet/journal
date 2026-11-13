import { test, expect, waitForAppReady } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// /today (the daily reminder's journal://today) mounts at desktop width too (#1213).
test('/today opens today\'s note at desktop width', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.goto('/today');
  await assertTestOrigin(app);
  // goto reloads the app: the redirect runs only after the boot, which can outlast the poll.
  await waitForAppReady(app);
  await expect.poll(() => new URL(app.url()).pathname.split('/').length).toBe(3);
});

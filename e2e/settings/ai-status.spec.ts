import { test, expect } from '../fixtures';

// Settings → AI with the real WebLLM worker and huggingface.co unreachable (#212):
// the status is truthful (no "Model Active"), the error is visible, Retry re-attempts.

test('desktop: AI off shows no status; a blocked model download shows the error, and Retry tries again', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  // Page routes run before the context-level network fence; count and abort every model request.
  let blocked = 0;
  await app.route('https://huggingface.co/**', (route) => {
    blocked++;
    return route.abort();
  });

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'AI', exact: true }).click();
  const toggle = dialog.getByRole('switch', { name: 'Enable on-device AI' });
  const status = dialog.getByRole('status');

  await expect(toggle).not.toBeChecked();
  await expect(status).toHaveCount(0);
  await expect(dialog.getByText(/Model Active/)).toHaveCount(0);

  await toggle.click();
  await expect(status).toContainText("Couldn't load the AI model.");
  const retry = status.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await expect(dialog.getByText(/Model Active|Ready ·/)).toHaveCount(0);
  await expect.poll(() => blocked).toBeGreaterThan(0);

  const before = blocked;
  await retry.click();
  await expect.poll(() => blocked).toBeGreaterThan(before);
  await expect(status).toContainText("Couldn't load the AI model.");
  await expect(retry).toBeVisible();
  await expect(dialog.getByText(/Model Active|Ready ·/)).toHaveCount(0);
});

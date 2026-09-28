import { test, expect, waitForAppReady } from '../fixtures';

// Settings section registry (#210): a left nav / vertical tablist on desktop,
// a full-screen list -> drill-in sheet on mobile.

test('desktop: vertical tablist, arrow-key navigation, Tab into content', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.getByRole('button', { name: 'Settings' }).click();

  const dialog = app.getByRole('dialog');
  const tablist = dialog.getByRole('tablist');
  await expect(tablist).toHaveAttribute('aria-orientation', 'vertical');

  const appearanceTab = dialog.getByRole('tab', { name: 'Appearance' });
  const aiTab = dialog.getByRole('tab', { name: 'AI', exact: true });

  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tabpanel')).toContainText('Appearance');

  await appearanceTab.focus();
  await app.keyboard.press('ArrowDown');
  await expect(aiTab).toHaveAttribute('aria-selected', 'true');
  await expect(aiTab).toBeFocused();
  await expect(dialog.getByRole('tabpanel')).toContainText('AI');

  await app.keyboard.press('ArrowUp');
  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
  await expect(appearanceTab).toBeFocused();

  // Tab moves focus out of the tablist and into the active panel's content
  // (the panel itself is the next stop in the roving-tabindex tab order).
  await app.keyboard.press('Tab');
  await expect(appearanceTab).not.toBeFocused();
  await expect(dialog.getByRole('tabpanel')).toBeFocused();
});

test('mobile: full-screen list drills into a section and back returns to the list', async ({ app }) => {
  // Land on the sidebar root (not a restored note) at a phone viewport.
  await app.evaluate(() => localStorage.removeItem('journal-session-state'));
  await app.setViewportSize({ width: 390, height: 844 });
  await app.goto('/');
  await waitForAppReady(app);

  await app.getByRole('button', { name: 'Settings' }).click();

  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Fills the viewport - no page visible around it. Poll instead of a single
  // read since the dialog's open transition briefly renders it slightly smaller.
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBeGreaterThanOrEqual(385);
  await expect.poll(async () => (await dialog.boundingBox())?.height).toBeGreaterThanOrEqual(800);

  await expect(dialog.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close settings' })).toBeVisible();

  await dialog.getByRole('button', { name: /\bAI\b/ }).click();
  await expect(dialog.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
  const backButton = dialog.getByRole('button', { name: 'Back to settings' });
  await expect(backButton).toBeVisible();

  await backButton.click();
  await expect(dialog.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

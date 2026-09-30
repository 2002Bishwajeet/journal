import { test, expect } from '../fixtures';

// Settings section registry (#210): a left nav / vertical tablist on desktop,
// a horizontal nav strip on mobile.

test('desktop: vertical tablist, arrow-key navigation, Tab into content', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.getByRole('button', { name: 'Settings' }).click();

  const dialog = app.getByRole('dialog');
  const tablist = dialog.getByRole('tablist');
  await expect(tablist).toHaveAttribute('aria-orientation', 'vertical');

  const accountTab = dialog.getByRole('tab', { name: 'Account' });
  const appearanceTab = dialog.getByRole('tab', { name: 'Appearance' });

  await expect(accountTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tabpanel')).toContainText('Account');

  await accountTab.focus();
  await app.keyboard.press('ArrowDown');
  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
  await expect(appearanceTab).toBeFocused();
  await expect(dialog.getByRole('tabpanel')).toContainText('Appearance');

  await app.keyboard.press('ArrowUp');
  await expect(accountTab).toHaveAttribute('aria-selected', 'true');
  await expect(accountTab).toBeFocused();

  // Tab moves focus out of the tablist and into the active panel's content
  // (the panel itself is the next stop in the roving-tabindex tab order).
  await app.keyboard.press('Tab');
  await expect(accountTab).not.toBeFocused();
  await expect(dialog.getByRole('tabpanel')).toBeFocused();
});

test('mobile: nav strip switches sections and long content scrolls', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  await app.getByRole('button', { name: 'Settings' }).click();

  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();

  // Regression: the content pane must be height-bounded so overflow scrolls
  // instead of being clipped by the dialog.
  const panel = dialog.getByRole('tabpanel');
  const scroller = panel.locator('..');
  const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

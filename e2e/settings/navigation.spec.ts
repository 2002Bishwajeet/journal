import { test, expect } from '../fixtures';

// Settings section registry (#210): a left nav / vertical tablist on desktop,
// a horizontal nav strip on mobile.

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

test('mobile: nav strip switches sections and long content scrolls', async ({ app }) => {
  // A short phone viewport (e.g. browser chrome or keyboard showing): no
  // section overflows a full 390x844 screen, so the scroll check needs less height.
  await app.setViewportSize({ width: 390, height: 560 });
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

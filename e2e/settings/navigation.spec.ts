import { test, expect } from '../fixtures';
import { openSettingsSection, settingsPanel } from '../support/actions';

// Settings section registry (#210): a left nav / vertical tablist on desktop,
// a grouped section list on mobile (#831).

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

test('mobile: the section list opens a page and long content scrolls', async ({ app }) => {
  // A short phone viewport (e.g. browser chrome or keyboard showing): no
  // section overflows a full 390x844 screen, so the scroll check needs less height.
  await app.setViewportSize({ width: 390, height: 560 });
  await app.getByRole('button', { name: 'Settings' }).click();

  const dialog = app.getByRole('dialog');
  await openSettingsSection(dialog, 'Data & storage');

  // Regression: the content pane must be height-bounded so overflow scrolls
  // instead of being clipped by the dialog.
  const scroller = settingsPanel(dialog);
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

test('mobile 390px: Done closes the list and does not overlap the title', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  await app.getByRole('button', { name: 'Settings' }).click();

  const dialog = app.getByRole('dialog');
  const done = dialog.getByRole('button', { name: 'Done', exact: true });
  const title = dialog.getByRole('heading', { name: 'Settings', exact: true });
  await expect(done).toBeVisible();
  await expect(dialog.locator('[data-slot=dialog-close]')).toHaveCount(0);
  // Wait for the open animation to finish (no running animations, full opacity).
  await expect
    .poll(() =>
      dialog.evaluate(
        (el) => el.getAnimations({ subtree: true }).length === 0 && getComputedStyle(el).opacity === '1',
      ),
    )
    .toBe(true);

  const doneBox = (await done.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  expect(doneBox.height).toBeGreaterThanOrEqual(44);
  expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(titleBox.y + 1);

  await done.click();
  await expect(dialog).toBeHidden();
});

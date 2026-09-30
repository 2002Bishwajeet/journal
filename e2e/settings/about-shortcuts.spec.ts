import { test, expect } from '../fixtures';

// Settings: Keyboard shortcuts section (desktop only) and a factual About (#215).

test('desktop: shortcuts section lists shortcuts; About shows version and links', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');

  await dialog.getByRole('tab', { name: 'Keyboard shortcuts' }).click();
  await expect(dialog.getByRole('tabpanel')).toContainText('Search');

  await dialog.getByRole('tab', { name: 'About', exact: true }).click();
  const panel = dialog.getByRole('tabpanel');
  await expect(panel.locator('p.font-mono')).toHaveText(/^v\d+\.\d+\.\d+ \(build \w+\)$/);
  await expect(panel.getByRole('link', { name: /Source code/ })).toHaveAttribute(
    'href',
    'https://github.com/2002Bishwajeet/journal',
  );
  await expect(panel.getByRole('link', { name: /Report a problem/ })).toHaveAttribute(
    'href',
    'https://github.com/2002Bishwajeet/journal/issues/new',
  );
});

test('mobile: no Keyboard shortcuts tab', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'About', exact: true })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});

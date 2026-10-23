import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { createFolder, foldersNav, inBothThemes, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// The collapsed sidebar's folder rail: the selected tile and its public badge render in
// full inside the rail, and a long folder list scrolls without clipping tiles.

type Box = { x: number; y: number; width: number; height: number };

const rail = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const railViewport = (page: Page) => rail(page).locator('[data-slot=scroll-area-viewport]');

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

function expectInside(inner: Box, outer: Box) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
}

async function expectFullyVisible(page: Page, tile: Locator) {
  const viewport = await box(railViewport(page));
  expectInside(await box(tile), viewport);
  expectInside(await box(rail(page)), { x: 0, y: 0, ...page.viewportSize()! });
}

async function shareFolder(page: Page, name: string) {
  await foldersNav(page).getByRole('button', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share folder…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share Folder' });
  await dialog.getByRole('button', { name: 'Share folder', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Folder link' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('collapsed rail shows the selected folder tile and its badge in full', async ({ app }) => {
  test.setTimeout(60_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);
  // Initials collide on purpose (Health/Habits, Movies/Main), like the owner's report.
  for (const name of ['Garden', 'Health', 'Habits', 'Movies', 'Projects']) await createFolder(app, name);
  await shareFolder(app, 'Projects');
  // An unselected shared folder too, so the shots show its badge on a plain tile.
  await shareFolder(app, 'Garden');

  await rail(app).getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(rail(app).getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect.poll(() => rail(app).evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(60);
  await selectFolder(app, 'Projects');
  // Off the tile, so the shots show its resting selected state.
  await app.mouse.move(800, 400);

  const tile = foldersNav(app).getByRole('button', { name: 'Projects', exact: true });
  await inBothThemes(app, (theme) =>
    rail(app).screenshot({ path: test.info().outputPath(`collapsed-rail-${theme}.png`), animations: 'disabled' })
  );
  await expect(tile).toHaveAttribute('aria-current', 'page');
  await expectFullyVisible(app, tile);
  // The public badge hangs off the tile's corner but stays inside the rail.
  const viewport = await box(railViewport(app));
  expectInside(await box(tile.getByTestId('folder-public-badge')), viewport);
  const garden = foldersNav(app).getByRole('button', { name: 'Garden', exact: true });
  expectInside(await box(garden.getByTestId('folder-public-badge')), viewport);

  // Keyboard focus names the folder in a tooltip.
  await app.keyboard.press('Shift+Tab');
  await app.keyboard.press('Tab');
  await expect(tile).toBeFocused();
  await expect(app.getByRole('tooltip', { name: 'Projects · Shared publicly' })).toBeVisible();
  await inBothThemes(app, (theme) =>
    app.screenshot({
      path: test.info().outputPath(`collapsed-rail-focus-${theme}.png`),
      clip: { x: 0, y: 0, width: 240, height: 800 },
      animations: 'disabled',
    })
  );
});

test('collapsed rail scrolls a long folder list without clipping tiles', async ({ app }) => {
  test.setTimeout(90_000);
  await app.setViewportSize({ width: 1280, height: 600 });
  await assertTestOrigin(app);
  for (let i = 1; i <= 14; i++) await createFolder(app, `Folder ${String(i).padStart(2, '0')}`);
  await rail(app).getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(rail(app).getByRole('button', { name: 'Expand sidebar' })).toBeVisible();

  // The footer stays on screen while the folder list scrolls.
  await expect(rail(app).getByRole('button', { name: 'Log out' })).toBeInViewport();
  const last = foldersNav(app).getByRole('button', { name: 'Folder 14', exact: true });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveAttribute('aria-current', 'page');
  await expectFullyVisible(app, last);
  await inBothThemes(app, (theme) =>
    rail(app).screenshot({ path: test.info().outputPath(`collapsed-rail-long-${theme}.png`), animations: 'disabled' })
  );
});

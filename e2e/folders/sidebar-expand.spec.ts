import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Expanding the collapsed sidebar grows it straight to its width: it never overshoots and shrinks back.

for (const width of [1280, 1100]) {
  test(`sidebar expands without overshooting (${width}px)`, async ({ app }) => {
    await app.setViewportSize({ width, height: 800 });
    await assertTestOrigin(app);
    const sidebar = app.getByRole('complementary', { name: 'Sidebar' });
    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(60);

    // Sample the sidebar's width every frame while it expands.
    const sampling = app.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const aside = document.querySelector('aside[aria-label="Sidebar"]')!;
          const widths: number[] = [];
          const start = performance.now();
          const tick = () => {
            widths.push(Math.round(aside.getBoundingClientRect().width));
            if (performance.now() - start < 700) requestAnimationFrame(tick);
            else resolve(widths);
          };
          requestAnimationFrame(tick);
        }),
    );
    await sidebar.getByRole('button', { name: 'Expand sidebar' }).click();
    const widths = await sampling;

    const final = widths.at(-1)!;
    expect(final).toBeGreaterThanOrEqual(240);
    expect(Math.max(...widths)).toBeLessThanOrEqual(final);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
  });
}

test('collapsed sidebar: each folder shows its first letter, named for its folder', async ({ app }) => {
  await assertTestOrigin(app);
  const sidebar = app.getByRole('complementary', { name: 'Sidebar' });
  await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
  const folders = sidebar.getByRole('navigation', { name: 'Folders' });
  // Every identity has Main; collapsed, its button is still named and shows "M".
  await expect(folders.getByRole('button', { name: 'Main', exact: true })).toHaveText('M');
});

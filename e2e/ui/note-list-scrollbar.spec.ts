import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// The note list scrollbar must paint above sticky group headers (#1051).

test('note list scrollbar paints above a stuck group header', async ({ app }) => {
  for (const title of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
    await createNote(app, { title, body: `${title} body` });
  }
  await app.getByTestId('note-row').filter({ hasText: 'Alpha' }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Pin' }).click();
  const headers = app.locator('button[aria-expanded]');
  await expect(headers.filter({ hasText: 'Pinned' })).toBeVisible();
  await expect.poll(() => headers.count()).toBeGreaterThan(1);

  await app.setViewportSize({ width: 1280, height: 420 });
  const row = app.getByTestId('note-row').first();
  const box = (await row.boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // A small scroll keeps the Pinned header stuck at the top, where the thumb starts.
  await app.mouse.wheel(0, 40);

  await expect(app.locator('[data-slot=scroll-area]:has([data-testid=note-row]) [data-slot=scroll-area-scrollbar]')).toBeVisible();

  const result = await app.evaluate(() => {
    const root = document.querySelector('[data-testid=note-row]')!.closest('[data-slot=scroll-area]')!;
    const bar = root.querySelector('[data-slot=scroll-area-scrollbar]') as HTMLElement;
    const headers = Array.from(root.querySelectorAll('button[aria-expanded]')) as HTMLElement[];
    const br = bar.getBoundingClientRect();
    const x = br.left + br.width / 2;
    // The stuck header is the one pinned to the viewport top.
    const top = root.querySelector('[data-slot=scroll-area-viewport]')!.getBoundingClientRect().top;
    const stuck = headers.sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top))[0];
    const hr = stuck.getBoundingClientRect();
    const stack = document.elementsFromPoint(x, hr.top + hr.height / 2);
    return { bar: stack.indexOf(bar), header: stack.indexOf(stuck) };
  });
  expect(result.bar).toBeGreaterThanOrEqual(0);
  expect(result.header).toBeGreaterThanOrEqual(0);
  expect(result.bar).toBeLessThan(result.header);
  const sidebar = app.locator('[data-slot=scroll-area]:has([data-testid=note-row])');
  await sidebar.screenshot({ path: test.info().outputPath('note-list-scrollbar-desktop.png') });
});

import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// The note list scrollbar must paint above sticky group headers (#1051).

test('note list scrollbar paints above a stuck group header', async ({ app }) => {
  for (const title of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
    await createNote(app, { title, body: `${title} body` });
  }
  await app.getByTestId('note-row').filter({ hasText: 'Alpha' }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Pin' }).click();

  await app.setViewportSize({ width: 1280, height: 320 });
  await app.evaluate(() => {
    const root = document.querySelector('[data-testid=note-row]')?.closest('[data-slot=scroll-area]');
    const viewport = root?.querySelector('[data-slot=scroll-area-viewport]') as HTMLElement;
    viewport.scrollTop = viewport.scrollHeight;
  });

  const result = await app.evaluate(() => {
    const root = document.querySelector('[data-testid=note-row]')!.closest('[data-slot=scroll-area]')!;
    const bar = root.querySelector('[data-slot=scroll-area-scrollbar]') as HTMLElement;
    const headers = Array.from(root.querySelectorAll('button[aria-expanded]')) as HTMLElement[];
    const br = bar.getBoundingClientRect();
    const x = br.left + br.width / 2;
    // The stuck header is the one pinned to the viewport top.
    const top = root.querySelector('[data-slot=scroll-area-viewport]')!.getBoundingClientRect().top;
    const stuck = headers.find((h) => Math.abs(h.getBoundingClientRect().top - top) < 2)!;
    const hr = stuck.getBoundingClientRect();
    const stack = document.elementsFromPoint(x, hr.top + hr.height / 2);
    return { bar: stack.indexOf(bar), header: stack.indexOf(stuck) };
  });
  expect(result.bar).toBeGreaterThanOrEqual(0);
  expect(result.header).toBeGreaterThanOrEqual(0);
  expect(result.bar).toBeLessThan(result.header);
  await app.screenshot({ path: test.info().outputPath('note-list-scrollbar-desktop.png') });
});

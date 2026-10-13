import { test, expect } from '../fixtures';
import { createFolder } from '../support/actions';

// A long folder name ends in an ellipsis inside the sidebar instead of being clipped
// at its edge, and the full name is in the hover title.

const name = 'P2P Calling — Night report 2026-10-12 and the follow-up notes';

test('a long folder name truncates inside the sidebar', async ({ app }) => {
  await createFolder(app, name);
  const label = app.getByRole('navigation', { name: 'Folders' }).getByText(name, { exact: true });
  await expect(label).toHaveAttribute('title', name);

  const nav = await app.getByRole('navigation', { name: 'Folders' }).boundingBox();
  const box = await label.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(nav!.x + nav!.width);
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

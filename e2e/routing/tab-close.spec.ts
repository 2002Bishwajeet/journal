import { test, expect, waitForAppReady } from '../fixtures';
import { createNote } from '../support/actions';

// Closing the active tab activates exactly one neighbour, the URL follows it,
// and no other editor gets mounted on the way (#191).

test('closing the active tab switches to its right neighbour without mounting others', async ({ app }) => {
  const titles = ['Tab A', 'Tab B', 'Tab C', 'Tab D'];
  const ids: string[] = [];
  for (const title of titles) {
    await createNote(app, { title, body: `${title} body` });
    ids.push(new URL(app.url()).pathname.split('/')[2]);
  }
  const main = app.locator('#main-content');
  const tab = (title: string) => main.getByRole('button', { name: title, exact: true });

  // Activate B and reload, so B is the only mounted editor (tabs mount on
  // activation, and the restored active tab and the URL are both B).
  await tab('Tab B').click();
  await expect(app).toHaveURL(new RegExp(ids[1]));
  await app.reload();
  await waitForAppReady(app);
  await expect(tab('Tab B')).toHaveAttribute('aria-current', 'true');
  await expect(main.locator('.ProseMirror')).toHaveCount(1);

  await main.getByRole('button', { name: 'Close Tab B', exact: true }).click();

  await expect(tab('Tab B')).toHaveCount(0);
  await expect(tab('Tab C')).toHaveAttribute('aria-current', 'true');
  await expect(app).toHaveURL(new RegExp(ids[2]));
  // Only C mounted — not C plus a transiently activated or last tab.
  await expect(main.locator('.ProseMirror')).toHaveCount(1);
});

test('closing the only tab lands on the folder', async ({ app }) => {
  await createNote(app, { title: 'Only tab', body: 'Alone' });
  const folderId = new URL(app.url()).pathname.split('/')[1];
  const main = app.locator('#main-content');

  await main.getByRole('button', { name: 'Close Only tab', exact: true }).click();

  await expect(app).toHaveURL(new RegExp(`/${folderId}$`));
  await expect(main.getByText('No notes open')).toBeVisible();
});

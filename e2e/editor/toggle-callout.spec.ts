import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #159: toggle and callout blocks inserted from the slash menu.

test('toggle block: title, collapse, and reload (open state is not synced)', async ({ app }) => {
  const title = `Toggle ${Date.now()}`;
  await createNote(app, { title, body: '/toggle' });
  await app.keyboard.press('Enter');

  const toggleTitle = app.getByLabel('Toggle title');
  await toggleTitle.fill('My toggle');

  const editor = activeEditor(app);
  await editor.locator('[data-type="toggle"] p').click();
  await app.keyboard.type('Inner text');
  const inner = editor.getByText('Inner text');
  await expect(inner).toBeVisible();
  // Typed after the title, so its preview in the note list means the title has
  // been written too.
  await expect(app.getByRole('button').filter({ hasText: 'Inner text' }).first()).toBeVisible();

  await app.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(inner).toBeHidden();

  await app.reload();
  await waitForAppReady(app);

  await expect(app.getByLabel('Toggle title')).toHaveValue('My toggle');
  // Open/closed is view-local, so the toggle comes back open.
  await expect(activeEditor(app).getByText('Inner text')).toBeVisible();
});

test('callout block: switch variant to warning and reload', async ({ app }) => {
  const title = `Callout ${Date.now()}`;
  await createNote(app, { title, body: '/callout' });
  await app.keyboard.press('Enter');

  await app.getByRole('button', { name: 'Callout type: info' }).click();
  await app.getByRole('button', { name: 'warning', exact: true }).click();
  const callout = activeEditor(app).locator('[data-type="callout"][data-variant="warning"]');
  await expect(callout).toBeVisible();
  await app.keyboard.press('Escape');

  // Typed after the variant switch, so its preview in the note list means the
  // variant has been written too.
  await callout.locator('p').click();
  await app.keyboard.type('Heads up');
  await expect(app.getByRole('button').filter({ hasText: 'Heads up' }).first()).toBeVisible();
  await app.reload();
  await waitForAppReady(app);

  await expect(activeEditor(app).locator('[data-type="callout"][data-variant="warning"]')).toContainText('Heads up');
  await expect(app.getByRole('button', { name: 'Callout type: warning' })).toBeVisible();
});

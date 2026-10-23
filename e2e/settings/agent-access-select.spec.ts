import { test, expect } from '../fixtures';
import { createFolder, inBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// Settings → Agent access: every folder's access select has the same width, and its
// label never runs under the chevron.

test('agent access selects share one width and leave room for the chevron', async ({ app }) => {
  test.setTimeout(60_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);
  for (const name of ['Gym Stuffs', 'Homebase Stuffs']) await createFolder(app, name);

  // Canned drive answers: no grants file yet, and a save that never returns, so each
  // choice stays on screen as the optimistic update (a failed save would roll it back).
  await app.route('**/drive/query/specialized/cuid/header**', (route) => {
    const origin = route.request().headers()['origin'] ?? '*';
    return route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 404,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
      },
    });
  });
  await app.route('**/drive/files/upload**', () => {});

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Agent access' }).click();
  await dialog.getByLabel('Agent access for Homebase Stuffs').selectOption('write');
  await dialog.getByLabel('Agent access for Main').selectOption('read');

  const selects = dialog.getByRole('combobox', { name: /^Agent access for / });
  await expect(selects).toHaveCount(3);
  await expect(dialog.getByLabel('Agent access for Homebase Stuffs')).toHaveValue('write');

  await inBothThemes(app, (theme) =>
    dialog.screenshot({ path: test.info().outputPath(`agent-access-selects-${theme}.png`), animations: 'disabled' })
  );

  const metrics = await selects.evaluateAll((els) =>
    els.map((el) => {
      const select = el as HTMLSelectElement;
      const style = getComputedStyle(select);
      // Width of the chosen label, measured in the select's own font.
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = ctx.measureText(select.selectedOptions[0].text).width;
      const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { width: select.getBoundingClientRect().width, paddingRight: parseFloat(style.paddingRight), text, room };
    })
  );
  for (const m of metrics) {
    expect(m.width).toBe(metrics[0].width);
    // The chevron sits in the right padding; the label fits in what is left.
    expect(m.paddingRight).toBeGreaterThanOrEqual(28);
    expect(m.text).toBeLessThanOrEqual(m.room);
  }
});

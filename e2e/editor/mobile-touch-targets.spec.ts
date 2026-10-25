import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { makeSolidPng } from '../support/png';

// #791: on a phone, the table grips and menus, the image controls and the tag input
// are 44px to touch and 16px to read (iOS zooms a smaller field). Desktop is unchanged.

const PHONE = { width: 393, height: 852 };
const DESKTOP = { width: 1280, height: 800 };
const MIN = 44;
const AUTH = 'e2e/fixtures/hermetic-auth.json';

const TABLE = `<table><tbody>
  <tr><th>Name</th><th>Role</th></tr>
  <tr><td>Ada</td><td>Engineer</td></tr>
  <tr><td>Grace</td><td>Admiral</td></tr>
</tbody></table>`;

async function paste(page: Page, html: string): Promise<void> {
  await activeEditor(page).evaluate((el, h) => {
    const data = new DataTransfer();
    data.setData('text/html', h);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

// The note is made at desktop width, where the New button shows; the caller then shrinks the window.
async function noteWithTable(page: Page): Promise<void> {
  await page.goto('/');
  await assertTestOrigin(page);
  await waitForAppReady(page);
  await createNote(page, { title: `Touch ${Date.now()}`, body: 'Before' });
  await page.keyboard.press('Enter');
  await paste(page, TABLE);
  await expect(activeEditor(page).locator('table')).toHaveCount(1);
}


/** The hit box of a grip: the button with its ::before, found by probing elementFromPoint. */
async function hitSize(page: Page, name: string): Promise<{ w: number; h: number }> {
  const box = (await page.getByRole('button', { name }).boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return page.evaluate(
    ({ cx, cy, label }) => {
      const hits = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') === label;
      const extent = (dx: number, dy: number) => {
        let n = 0;
        while (n < 60 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
        return n;
      };
      return { w: extent(-1, 0) + extent(1, 0) + 1, h: extent(0, -1) + extent(0, 1) + 1 };
    },
    { cx, cy, label: name },
  );
}

test('on a phone, the table grips, table menu and tag input are easy to touch', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: DESKTOP, hasTouch: true }, async (page) => {
    await noteWithTable(page);
    await page.setViewportSize(PHONE);
    await activeEditor(page).locator('table td').first().tap();

    for (const name of ['Column options', 'Row options']) {
      const size = await hitSize(page, name);
      expect(size.w, `${name} width`).toBeGreaterThanOrEqual(MIN);
      expect(size.h, `${name} height`).toBeGreaterThanOrEqual(MIN);
    }

    await page.getByRole('button', { name: 'Column options' }).tap();
    const buttons = page.getByRole('dialog').getByRole('button');
    expect(await buttons.count()).toBeGreaterThan(0);
    // The menu zooms in when it opens: poll until it has its full size.
    for (const button of await buttons.all()) {
      await expect.poll(async () => (await button.boundingBox())!.width).toBeGreaterThanOrEqual(MIN);
      await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(MIN);
    }
    await screenshotInBothThemes(page, (theme) => `table-menu-${theme}-393.png`);
    await page.keyboard.press('Escape');

    const fontSize = await page.getByPlaceholder(/Add tags|^#$/).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });
});

test('on a phone, an image shows 44px controls', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: DESKTOP, hasTouch: true }, async (page) => {
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);
    await createNote(page, { title: `Touch image ${Date.now()}`, body: 'Before' });
    await page.keyboard.press('Enter');
    const png = makeSolidPng(240, 160, [40, 80, 200]).toString('base64');
    await paste(page, `<img src="data:image/png;base64,${png}" alt="blue">`);
    await page.setViewportSize(PHONE);
    const image = activeEditor(page).locator('img[alt="blue"]');
    await expect(image).toBeVisible();
    await image.tap();

    const bar = page.getByRole('button', { name: 'Download image' });
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(MIN);
    expect(box.height).toBeGreaterThanOrEqual(MIN);
    // The wrapped bar stays on the screen.
    const first = (await page.getByRole('button', { name: 'Center' }).boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    await screenshotInBothThemes(page, (theme) => `image-bar-${theme}-393.png`);
  });
});

test('on desktop, the grips and the tag input keep their size', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: DESKTOP }, async (page) => {
    await noteWithTable(page);
    await activeEditor(page).locator('table td').first().hover();

    const column = (await page.getByRole('button', { name: 'Column options' }).boundingBox())!;
    expect([column.width, column.height]).toEqual([24, 16]);
    const row = (await page.getByRole('button', { name: 'Row options' }).boundingBox())!;
    expect([row.width, row.height]).toEqual([16, 24]);

    const fontSize = await page.getByPlaceholder(/Add tags|^#$/).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBe(12);
  });
});

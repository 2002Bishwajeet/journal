import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #584: crop to 16:9, rotate 90° right and flip horizontally, all non-destructive.
// The editor, the lightbox and the share page show the same result: a 9:16 box with
// the picture's four coloured quadrants where the turn and the mirror put them.
// Undo takes back one Apply; Reset brings back the original; resize and float act
// on the edited box.

// 800x400, four quadrants: an asymmetric picture, so a wrong turn or mirror shows.
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="400" height="200" fill="rgb(220,40,40)"/><rect x="400" width="400" height="200" fill="rgb(40,160,40)"/><rect y="200" width="400" height="200" fill="rgb(40,40,220)"/><rect x="400" y="200" width="400" height="200" fill="rgb(220,200,40)"/></svg>`;
const COLORS = { red: [220, 40, 40], green: [40, 160, 40], blue: [40, 40, 220], yellow: [220, 200, 40] } as const;
// Turned right, the top-left (red) goes top-right; mirrored, it comes back to the top left.
const EXPECTED = { topLeft: 'red', topRight: 'blue', bottomLeft: 'green', bottomRight: 'yellow' };

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5c1d7e42-8a3b-4f6e-9d20-b7e4a1c3f058';
const FILE_ID = '2a7f9c31-4d6b-4e8a-b1f0-6c3e5d9a7b14';
const NOTE_TITLE = 'Edited image on the share page';
const PUBLISHED = Date.UTC(2026, 9, 12, 9, 0);

/** The quadrant colour names a screenshot shows, sampled in the page. */
async function quadrants(page: Page, png: Buffer) {
  return page.evaluate(
    async ({ b64, colors }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const at = (fx: number, fy: number) => {
        const [r, g, b] = ctx.getImageData(Math.round(canvas.width * fx), Math.round(canvas.height * fy), 1, 1).data;
        return Object.entries(colors).sort(
          ([, p], [, q]) => Math.hypot(p[0] - r, p[1] - g, p[2] - b) - Math.hypot(q[0] - r, q[1] - g, q[2] - b),
        )[0][0];
      };
      return { topLeft: at(0.25, 0.25), topRight: at(0.75, 0.25), bottomLeft: at(0.25, 0.75), bottomRight: at(0.75, 0.75) };
    },
    { b64: png.toString('base64'), colors: COLORS },
  );
}

const ratio = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return box.width / box.height;
};

async function pasteImage(page: Page) {
  const src = `data:image/svg+xml;base64,${Buffer.from(PICTURE).toString('base64')}`;
  await activeEditor(page).evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, `<img src="${src}" alt="Quadrants" width="320">`);
}

/** The share page's note: the same picture with the edit the editor makes. */
function noteContent(): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const image = new Y.XmlElement('image');
  const attrs: Record<string, unknown> = {
    src: `attachment://${FILE_ID}/jrnl_img0`,
    alt: 'Quadrants',
    width: 320,
    crop: { x: 0.0556, y: 0, w: 0.8889, h: 1 },
    rotate: 90,
    flipH: true,
  };
  for (const [key, value] of Object.entries(attrs)) image.setAttribute(key, value as string);
  paragraph.insert(0, [image]);
  doc.getXmlFragment('prosemirror').push([paragraph]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function openSharePage(page: Page): Promise<Locator> {
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: PUBLISHED,
      payloads: [{ key: 'jrnl_txt' }],
      appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return url.searchParams.get('key') === 'jrnl_img0'
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: PICTURE })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  return article.getByTestId('edited-image');
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`crop 16:9, rotate and flip: editor, lightbox and share page agree; undo and reset (${colorScheme})`, async ({ app, anonPage }) => {
    await app.emulateMedia({ colorScheme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `Crop ${Date.now()}`, body: 'Image below.' });
    await pasteImage(app);
    const img = activeEditor(app).locator('img[alt="Quadrants"]');
    await expect(img).toBeVisible();
    const frame = activeEditor(app).getByTestId('edited-image');

    // Edit: 16:9, rotate right, flip horizontal, Apply
    await img.click();
    await app.getByRole('button', { name: 'Edit image' }).click();
    const dialog = app.getByRole('dialog', { name: 'Edit image' });
    await expect(dialog.getByTestId('edited-image')).toBeVisible();
    await dialog.getByRole('button', { name: '16:9' }).click();
    await dialog.getByRole('button', { name: 'Rotate right' }).click();
    await dialog.getByRole('button', { name: 'Flip horizontal' }).click();
    // The crop now shows turned: a 9:16 rect over the turned 1:2 picture
    expect(await ratio(dialog.getByTestId('crop-area'))).toBeCloseTo(9 / 16, 1);
    await app.screenshot({ path: test.info().outputPath(`crop-dialog-${colorScheme}-1280.png`) });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    // Editor: a 320px wide 9:16 box, quadrants turned and mirrored
    await expect(frame).toBeVisible();
    await expect.poll(() => ratio(frame)).toBeCloseTo(9 / 16, 2);
    expect((await frame.boundingBox())!.width).toBeCloseTo(320, 0);
    await activeEditor(app).getByText('Image below.').click();
    await app.mouse.move(5, 5);
    const editorShot = await frame.screenshot();
    expect(await quadrants(app, editorShot)).toEqual(EXPECTED);
    await app.screenshot({ path: test.info().outputPath(`crop-editor-${colorScheme}-1280.png`) });

    // Lightbox: the same edited view
    await frame.dblclick();
    const lightbox = app.getByRole('dialog', { name: 'Quadrants' });
    const big = lightbox.getByTestId('edited-image');
    await expect(big).toBeVisible();
    await expect.poll(() => ratio(big)).toBeCloseTo(9 / 16, 2);
    expect(await quadrants(app, await big.screenshot())).toEqual(EXPECTED);
    await app.screenshot({ path: test.info().outputPath(`crop-lightbox-${colorScheme}-1280.png`) });
    await app.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    // Undo takes back the Apply (its own step): the original again; redo brings the edit back
    await activeEditor(app).press('ControlOrMeta+z');
    await expect(frame).toHaveCount(0);
    expect(await ratio(img)).toBeCloseTo(2, 1);
    await activeEditor(app).press('ControlOrMeta+Shift+z');
    await expect(frame).toBeVisible();
    await expect.poll(() => ratio(frame)).toBeCloseTo(9 / 16, 2);

    // Resize acts on the edited box and keeps its shape; float still works
    await img.click();
    await app.getByRole('button', { name: 'Resize image (bottom right)' }).focus();
    await app.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await frame.boundingBox())!.width).toBeCloseTo(304, 0);
    expect(await ratio(frame)).toBeCloseTo(9 / 16, 2);
    await app.getByRole('button', { name: 'Float right' }).click();
    await expect(frame.locator('xpath=ancestor::div[contains(@class,"group")][1]')).toHaveCSS('float', 'right');

    // Share page: the same note renders the same way
    await anonPage.emulateMedia({ colorScheme });
    await anonPage.setViewportSize({ width: 1280, height: 900 });
    const shared = await openSharePage(anonPage);
    await shared.scrollIntoViewIfNeeded();
    await expect(shared).toBeVisible();
    await expect.poll(() => ratio(shared)).toBeCloseTo(9 / 16, 2);
    expect((await shared.boundingBox())!.width).toBeCloseTo(320, 0);
    expect(await quadrants(anonPage, await shared.screenshot())).toEqual(EXPECTED);
    await anonPage.screenshot({ path: test.info().outputPath(`crop-share-${colorScheme}-1280.png`) });

    // Reset restores the original
    await img.click();
    await app.getByRole('button', { name: 'Edit image' }).click();
    await dialog.getByRole('button', { name: 'Reset' }).click();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(frame).toHaveCount(0);
    await expect.poll(() => ratio(img)).toBeCloseTo(2, 1);
    await app.screenshot({ path: test.info().outputPath(`crop-reset-${colorScheme}-1280.png`) });
  });
}

import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #601: dropping 3 images at once makes one row gallery: the three side by side at
// one height, surviving a reload. On a phone the row keeps 2 per row, never one column.

const PICTURES = [
  { name: 'wide.png', png: makeSolidPng(900, 450, [143, 163, 173]) },
  { name: 'tall.png', png: makeSolidPng(600, 800, [113, 137, 104]) },
  { name: 'square.png', png: makeSolidPng(700, 700, [190, 120, 90]) },
].map(({ name, png }) => ({ name, base64: png.toString('base64') }));

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** The first `count` images sit in one row at one height; retried, as a viewport change reflows the row. */
async function expectRowOf(images: Locator, count: number) {
  await expect(async () => {
    const boxes = [];
    for (let i = 0; i < count; i++) boxes.push(await box(images.nth(i)));
    for (const b of boxes.slice(1)) {
      // Sub-pixel flex widths round each image's height a little differently
      expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(2);
      expect(Math.abs(b.height - boxes[0].height)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(boxes[0].x);
    }
  }).toPass();
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`gallery: dropping 3 images makes one row that survives a reload (${colorScheme})`, async ({ app }) => {
    await app.emulateMedia({ colorScheme });
    await app.setViewportSize({ width: 1280, height: 800 });
    await createNote(app, { title: `Gallery ${Date.now()}`, body: 'Photos below.' });

    const editor = activeEditor(app);
    const text = await box(editor.getByText('Photos below.'));
    await editor.evaluate(
      (el, { pictures, x, y }) => {
        const data = new DataTransfer();
        for (const { name, base64 } of pictures) {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          data.items.add(new File([bytes], name, { type: 'image/png' }));
        }
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      },
      { pictures: PICTURES, x: text.x + text.width - 1, y: text.y + text.height / 2 },
    );

    const gallery = editor.locator('[data-gallery="row"]');
    const images = gallery.locator('img:not(.ProseMirror-separator)');
    await expect(gallery).toHaveCount(1);
    await expect(images).toHaveCount(3);
    // Every item has its aspect ratio once its image has loaded
    await expect.poll(() => gallery.evaluate((g) => [...g.children].filter((c) => (c as HTMLElement).style.getPropertyValue('--ar')).length)).toBe(3);
    await expectRowOf(images, 3);
    // The row sizes the images: no resize handles or float buttons on them
    await expect(gallery.getByRole('button', { name: /^Resize image/ })).toHaveCount(0);
    await expect(gallery.getByRole('button', { name: 'Float left' })).toHaveCount(0);
    // Widths follow the aspect ratios: the wide one is twice its height, the tall one 3/4
    const [wide, tall] = [await box(images.nth(0)), await box(images.nth(1))];
    expect(wide.width / wide.height).toBeCloseTo(2, 1);
    expect(tall.width / tall.height).toBeCloseTo(0.75, 1);
    await app.screenshot({ path: test.info().outputPath(`gallery-editor-${colorScheme}-1280.png`) });

    // Persists: the same gallery after a reload
    await app.waitForTimeout(2500);
    await app.reload();
    await expect(activeEditor(app).locator('[data-gallery="row"]')).toHaveCount(1);
    const reloaded = activeEditor(app).locator('[data-gallery="row"] img:not(.ProseMirror-separator)');
    await expect(reloaded).toHaveCount(3);
    await expect.poll(() => reloaded.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expectRowOf(reloaded, 3);

    // Phone: 2 per row, the third on the next row, nothing wider than the screen
    await app.setViewportSize({ width: 390, height: 844 });
    await expect(reloaded.first()).toBeVisible();
    await expectRowOf(reloaded, 2);
    await expect.poll(async () => (await box(reloaded.nth(2))).y - (await box(reloaded.nth(0))).y).toBeGreaterThan(10);
    await reloaded.first().scrollIntoViewIfNeeded();
    // A not-yet-uploaded image's status pill stays inside its (narrow) image
    const items = activeEditor(app).locator('[data-gallery="row"] .image-node');
    for (let i = 0; i < 3; i++) {
      const label = items.nth(i).getByTestId('pending-image-label');
      if (!(await label.count())) continue;
      const [l, img] = [await box(label), await box(items.nth(i).locator('img').first())];
      expect(l.x).toBeGreaterThanOrEqual(img.x - 0.5);
      expect(l.x + l.width).toBeLessThanOrEqual(img.x + img.width + 0.5);
    }
    await app.screenshot({ path: test.info().outputPath(`gallery-editor-${colorScheme}-390.png`) });
  });
}

// #602: the toolbar above a gallery switches it between row, grid, masonry and carousel;
// the choice survives a reload, and each layout is drawn as specified.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`gallery: switching layouts grid, masonry, carousel (${colorScheme})`, async ({ app }) => {
    await app.emulateMedia({ colorScheme });
    await app.setViewportSize({ width: 1280, height: 800 });
    await createNote(app, { title: `Gallery layouts ${Date.now()}`, body: 'Photos below.' });

    const editor = activeEditor(app);
    const text = await box(editor.getByText('Photos below.'));
    const pictures = [...PICTURES, { name: 'second.png', base64: PICTURES[0].base64 }, { name: 'third.png', base64: PICTURES[1].base64 }];
    await editor.evaluate(
      (el, { pictures, x, y }) => {
        const data = new DataTransfer();
        for (const { name, base64 } of pictures) {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          data.items.add(new File([bytes], name, { type: 'image/png' }));
        }
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      },
      { pictures, x: text.x + text.width - 1, y: text.y + text.height / 2 },
    );
    const block = editor.locator('.gallery-block');
    const layoutOf = (layout: string) => editor.locator(`[data-gallery="${layout}"]`);
    const images = (layout: string) => layoutOf(layout).locator('img:not(.ProseMirror-separator)');
    await expect(images('row')).toHaveCount(5);
    const pick = async (name: string) => {
      await block.hover();
      await block.getByRole('button', { name, exact: true }).click();
    };

    // Grid: square tiles, 3 across on desktop and 2 on a phone
    await pick('Grid');
    await expect(layoutOf('grid')).toHaveCount(1);
    await expect(async () => {
      const [a, b, c, d] = await Promise.all([0, 1, 2, 3].map((i) => box(images('grid').nth(i))));
      for (const t of [a, b, c, d]) expect(Math.abs(t.width - t.height)).toBeLessThan(2);
      expect(Math.abs(a.y - c.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x);
      expect(d.y).toBeGreaterThan(a.y + a.height);
    }).toPass();
    await app.screenshot({ path: test.info().outputPath(`gallery-grid-${colorScheme}-1280.png`) });
    await app.setViewportSize({ width: 390, height: 844 });
    await expect(async () => {
      const [a, b, c] = await Promise.all([0, 1, 2].map((i) => box(images('grid').nth(i))));
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(c.y).toBeGreaterThan(a.y + a.height);
    }).toPass();
    await expect(() => layoutOf('grid').scrollIntoViewIfNeeded()).toPass();
    await app.screenshot({ path: test.info().outputPath(`gallery-grid-${colorScheme}-390.png`) });

    // Masonry: columns of natural heights (the wide image is shorter than the tall one)
    await app.setViewportSize({ width: 1280, height: 800 });
    await pick('Masonry');
    await expect(layoutOf('masonry')).toHaveCount(1);
    await expect(async () => {
      const boxes = await Promise.all([0, 1, 2, 3, 4].map((i) => box(images('masonry').nth(i))));
      expect(boxes[1].height).toBeGreaterThan(boxes[0].height + 20);
      // Columns, not one tall stack: 2 or 3 distinct left edges
      const columns = new Set(boxes.map((b) => Math.round(b.x)));
      expect(columns.size).toBeGreaterThanOrEqual(2);
      expect(columns.size).toBeLessThanOrEqual(3);
    }).toPass();
    await app.screenshot({ path: test.info().outputPath(`gallery-masonry-${colorScheme}-1280.png`) });
    await app.setViewportSize({ width: 390, height: 844 });
    await expect(() => layoutOf('masonry').scrollIntoViewIfNeeded()).toPass();
    await app.screenshot({ path: test.info().outputPath(`gallery-masonry-${colorScheme}-390.png`) });
    await app.setViewportSize({ width: 1280, height: 800 });

    // Carousel: one image at a time; the buttons, the dots and the arrow keys page through
    await pick('Carousel');
    const carousel = layoutOf('carousel');
    await expect(carousel).toHaveCount(1);
    const nav = block.locator('.gallery-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('.gallery-dots > button')).toHaveCount(5);
    const at = () => carousel.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth));
    await expect.poll(at).toBe(0);
    await nav.scrollIntoViewIfNeeded();
    await app.screenshot({ path: test.info().outputPath(`gallery-carousel-${colorScheme}-1280.png`) });
    await nav.getByRole('button', { name: 'Next image' }).click();
    await expect.poll(at).toBe(1);
    await nav.getByRole('button', { name: 'Show image 4 of 5' }).click();
    await expect.poll(at).toBe(3);
    await nav.getByRole('button', { name: 'Next image' }).focus();
    await app.keyboard.press('ArrowLeft');
    await expect.poll(at).toBe(2);
    await nav.getByRole('button', { name: 'Previous image' }).click();
    await expect.poll(at).toBe(1);
    await app.setViewportSize({ width: 390, height: 844 });
    await expect(() => nav.scrollIntoViewIfNeeded()).toPass();
    await app.screenshot({ path: test.info().outputPath(`gallery-carousel-${colorScheme}-390.png`) });
    await app.setViewportSize({ width: 1280, height: 800 });

    // The layout survives a reload
    await app.waitForTimeout(2500);
    await app.reload();
    await expect(activeEditor(app).locator('[data-gallery="carousel"]')).toHaveCount(1);
    await expect(activeEditor(app).locator('[data-gallery="row"], [data-gallery="grid"]')).toHaveCount(0);
  });
}

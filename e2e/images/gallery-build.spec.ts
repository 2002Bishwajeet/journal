import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, waitForNoteSaved, screenshotInBothThemes } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #603: galleries built by /gallery, by dragging one image beside another (a drop
// indicator on the side it will go), by dragging back out, and reordered by drag or
// by the image toolbar's Move left/right. Each change undoes in one step.

const COLORS: Record<string, [number, number, number]> = {
  A: [190, 120, 90],
  B: [113, 137, 104],
  C: [143, 163, 173],
};
const dataUrl = (alt: string) => `data:image/png;base64,${makeSolidPng(320, 240, COLORS[alt]).toString('base64')}`;
const img = (alt: string) => `<img src="${dataUrl(alt)}" alt="${alt}">`;
const undoKey = 'ControlOrMeta+z';

/** Pastes `html` as the note's body, below its first line. */
async function pasteBody(app: Page, html: string) {
  await activeEditor(app).press('End');
  await activeEditor(app).press('Enter');
  await activeEditor(app).evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

const image = (app: Page, alt: string) => activeEditor(app).locator(`img[alt="${alt}"]`);
const galleryAlts = (app: Page) =>
  activeEditor(app).locator('[data-gallery="row"] img:not(.ProseMirror-separator)').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt')));

/**
 * Drags image `alt` to `side` of `onto` with the mouse (a real HTML5 drag), running
 * `whileOver` while it is held there, before the drop.
 */
async function dragImage(app: Page, alt: string, onto: Locator, side: 'left' | 'right', whileOver?: () => Promise<void>) {
  const from = (await image(app, alt).boundingBox())!;
  const to = (await onto.boundingBox())!;
  await app.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await app.mouse.down();
  await app.mouse.move(to.x + to.width * (side === 'left' ? 0.25 : 0.75), to.y + to.height / 2, { steps: 12 });
  await whileOver?.();
  await app.mouse.up();
}

/** The drop indicator shows on `side` of the image `alt`, and only there. */
async function expectIndicator(app: Page, alt: string, side: 'left' | 'right') {
  const marked = activeEditor(app).locator('[data-drop-side]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveAttribute('data-drop-side', side);
  await expect(marked.locator(`img[alt="${alt}"]`)).toHaveCount(1);
}

test('gallery: /gallery opens a picker that adds several images as one gallery', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Gallery picker ${Date.now()}`, body: 'Photos below.' });
  await activeEditor(app).press('End');
  await activeEditor(app).press('Enter');
  await activeEditor(app).pressSequentially('/gallery');
  await expect(app.getByRole('button', { name: /Gallery/ }).first()).toBeVisible();

  const chooser = app.waitForEvent('filechooser');
  await activeEditor(app).press('Enter');
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(true);
  await picker.setFiles(
    ['A', 'B', 'C'].map((name) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: makeSolidPng(640, 480, COLORS[name]) })),
  );

  const gallery = activeEditor(app).locator('[data-gallery="row"]');
  await expect(gallery).toHaveCount(1);
  await expect(gallery.locator('img:not(.ProseMirror-separator)')).toHaveCount(3);
  await expect(activeEditor(app)).not.toContainText('/gallery');
  await app.screenshot({ path: test.info().outputPath('gallery-picker-light-1280.png') });
});

test('gallery: dragging an image beside another merges them by side, dragging it out unwraps', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Gallery merge ${Date.now()}`, body: 'Two photos.' });
  await pasteBody(app, `<p>${img('A')}</p><p>${img('B')}</p><p>After the photos.</p>`);
  await expect(image(app, 'B')).toBeVisible();
  await expect(activeEditor(app).locator('[data-gallery]')).toHaveCount(0);

  // A onto B's right half: the indicator on B's right edge, then the gallery [B, A]
  await dragImage(app, 'A', image(app, 'B'), 'right', async () => {
    await expectIndicator(app, 'B', 'right');
    await screenshotInBothThemes(app, (colorScheme) => `drop-indicator-right-${colorScheme}-1280.png`);
  });
  await expect.poll(() => galleryAlts(app)).toEqual(['B', 'A']);
  await expect(activeEditor(app).locator('[data-drop-side]')).toHaveCount(0);
  await screenshotInBothThemes(app, (colorScheme) => `merged-${colorScheme}-1280.png`);

  // One undo step: the two plain images again
  await activeEditor(app).press(undoKey);
  await expect(activeEditor(app).locator('[data-gallery]')).toHaveCount(0);
  await expect(activeEditor(app).locator('img:not(.ProseMirror-separator)')).toHaveCount(2);

  // A onto B's left half: [A, B]
  await dragImage(app, 'A', image(app, 'B'), 'left', async () => {
    await expectIndicator(app, 'B', 'left');
    await screenshotInBothThemes(app, (colorScheme) => `drop-indicator-left-${colorScheme}-1280.png`);
  });
  await expect.poll(() => galleryAlts(app)).toEqual(['A', 'B']);

  // Dragged back out into the text below, A is a plain image and the gallery of one unwraps
  await dragImage(app, 'A', activeEditor(app).getByText('After the photos.'), 'right');
  await expect(activeEditor(app).locator('[data-gallery]')).toHaveCount(0);
  await expect(activeEditor(app).locator('img:not(.ProseMirror-separator)')).toHaveCount(2);
  await activeEditor(app).press(undoKey);
  await expect.poll(() => galleryAlts(app)).toEqual(['A', 'B']);
});

test('gallery: reorder by drag and by the toolbar, kept after a reload', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Gallery reorder ${Date.now()}`, body: 'Three photos.' });
  // A line first: pasted first, a gallery would be read into the empty line as plain images
  await pasteBody(app, `<p>Photos:</p><div data-gallery="row">${img('A')}${img('B')}${img('C')}</div><p>After.</p>`);
  await expect.poll(() => galleryAlts(app)).toEqual(['A', 'B', 'C']);

  // Drag C before A
  await dragImage(app, 'C', image(app, 'A'), 'left', async () => {
    await expectIndicator(app, 'A', 'left');
    await app.screenshot({ path: test.info().outputPath('drop-indicator-gallery-light-1280.png') });
  });
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'A', 'B']);

  // Toolbar: B one place left by click, then right again by keyboard
  const toolbarOf = (alt: string) => activeEditor(app).locator('.image-node', { has: app.locator(`img[alt="${alt}"]`) });
  await image(app, 'B').click();
  await toolbarOf('B').getByRole('button', { name: 'Move left' }).click();
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'B', 'A']);
  await app.screenshot({ path: test.info().outputPath('moved-left-light-1280.png') });

  const moveRight = toolbarOf('B').getByRole('button', { name: 'Move right' });
  await moveRight.focus();
  await app.keyboard.press('Enter');
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'A', 'B']);
  // At the end, nothing to move past
  await moveRight.click();
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'A', 'B']);

  // Each move is its own undo step
  await activeEditor(app).press(undoKey);
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'B', 'A']);
  await activeEditor(app).press(undoKey);
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'A', 'B']);

  // Kept after a reload
  await waitForNoteSaved(app);
  await app.reload();
  await expect.poll(() => galleryAlts(app)).toEqual(['C', 'A', 'B']);
});

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #552: OdinImage (attachments) clips to the img's height, so the img's own
// .prose margin pushed its bottom out of view. Plain and aligned images must
// keep exactly the spacing they had before the fix.

async function pasteImage(app: Page, html: string) {
  await activeEditor(app).evaluate((el, h) => {
    const data = new DataTransfer();
    data.setData('text/html', h);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

const marginsOf = (img: ReturnType<Page['locator']>) =>
  img.evaluate((el) => {
    const box = el.closest('.image-node > div') as HTMLElement;
    const s = getComputedStyle(el);
    const b = getComputedStyle(box);
    return {
      img: [s.marginTop, s.marginBottom],
      box: [b.marginTop, b.marginRight, b.marginBottom, b.marginLeft],
    };
  });

async function expectInside(img: ReturnType<Page['locator']>, wrapper: ReturnType<Page['locator']>) {
  const i = (await img.boundingBox())!;
  const w = (await wrapper.boundingBox())!;
  expect(i.y + i.height).toBeLessThanOrEqual(w.y + w.height + 0.5);
  expect(i.y).toBeGreaterThanOrEqual(w.y - 0.5);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`body images sit fully inside their boxes, spacing unchanged (${colorScheme})`, async ({ app }) => {
    await app.emulateMedia({ colorScheme });
    await app.setViewportSize({ width: 1280, height: 800 });
    await createNote(app, { title: `Margin ${Date.now()}`, body: 'Image below.' });

    // Normal image: unchanged from main (img 24px margins, box none).
    await pasteImage(app, '<img src="/pwa-512x512.png" alt="Plain logo">');
    const plain = activeEditor(app).locator('img[alt="Plain logo"]');
    await expect(plain).toBeVisible();
    expect(await marginsOf(plain)).toEqual({ img: ['24px', '24px'], box: ['0px', '0px', '0px', '0px'] });
    await plain.scrollIntoViewIfNeeded();
    await expectInside(plain, plain.locator('xpath=ancestor::div[contains(@class,"group")][1]'));
    await app.screenshot({ path: test.info().outputPath(`normal-image-${colorScheme}-1280.png`) });

    // Left-aligned image with wrapping text: same margins as main's ALIGN_STYLE.left.
    await activeEditor(app).press('ControlOrMeta+End');
    await pasteImage(
      app,
      '<img src="/pwa-512x512.png" alt="Left logo" width="200" data-align="left">' +
        `<p>${'Text wraps beside the floated image. '.repeat(12)}</p>`,
    );
    const left = activeEditor(app).locator('img[alt="Left logo"]');
    await expect(left).toBeVisible();
    expect(await marginsOf(left)).toEqual({ img: ['24px', '24px'], box: ['0px', '16px', '8px', '0px'] });
    await left.scrollIntoViewIfNeeded();
    await expectInside(left, left.locator('xpath=ancestor::div[contains(@class,"group")][1]'));
    await app.screenshot({ path: test.info().outputPath(`aligned-image-${colorScheme}-1280.png`) });

    // Attachment images render inside OdinImage's overflow-hidden wrapper, which
    // needs a real Homebase file; recreate that DOM shape under .prose to check
    // the clip box takes the spacing and the img is no longer cut off.
    const clip = await app.evaluate(() => {
      const host = document.createElement('div');
      host.className = 'prose';
      host.innerHTML =
        '<div class="image-node"><div class="group relative inline-block max-w-full" style="width:200px">' +
        '<div id="clip" class="relative overflow-hidden h-auto w-full"><img id="clipped" class="w-full h-auto" src="/pwa-512x512.png" style="aspect-ratio:1"></div>' +
        '</div></div>';
      document.body.appendChild(host);
      const img = document.getElementById('clipped')!;
      const wrap = document.getElementById('clip')!;
      const r = (el: Element) => el.getBoundingClientRect();
      const out = {
        imgMargin: getComputedStyle(img).marginTop,
        clipMargin: [getComputedStyle(wrap).marginTop, getComputedStyle(wrap).marginBottom],
        imgBottom: r(img).bottom,
        clipBottom: r(wrap).bottom,
      };
      host.remove();
      return out;
    });
    expect(clip.imgMargin).toBe('0px');
    expect(clip.clipMargin).toEqual(['24px', '24px']);
    expect(clip.imgBottom).toBeLessThanOrEqual(clip.clipBottom + 0.5);
  });
}

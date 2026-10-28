import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, screenshotInBothThemes, selectFolder } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #892: on a phone a tap leaves no hover style behind, and the carousel's
// prev/next buttons and dots are 44px targets.

const svg = (fill: string) =>
  `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${fill}"/></svg>`).toString('base64')}`;
const FILLS = ['#8fa3ad', '#718968', '#be785a', '#a58fad', '#c9b27a', '#6f8fa0', '#9a6f5c', '#7c9a6f', '#b07a8f', '#8a8a8a'];
const gallery = (layout: string, count: number) => ({
  type: 'gallery',
  attrs: { layout },
  content: FILLS.slice(0, count).map((fill, i) => ({ type: 'image', attrs: { src: svg(fill), alt: `Slide ${i + 1}` } })),
});

const background = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

type TiptapEditor = { state: { doc: { content: { size: number } } }; commands: { insertContentAt: (pos: number, c: unknown) => void } };

/** Inserts `content` at the end of the note; Tiptap leaves its editor on the DOM node. */
const appendToNote = (editor: Locator, content: unknown) =>
  editor.evaluate((el, content) => {
    const tiptap = (el as unknown as { editor: TiptapEditor }).editor;
    tiptap.commands.insertContentAt(tiptap.state.doc.content.size, content);
  }, content);

async function newNote(page: Page) {
  await selectFolder(page, 'Main');
  const before = page.url();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.waitForURL((url) => url.href !== before);
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeTitleInput(page).fill(`Gallery touch ${Date.now()}`);
}

test('a tap leaves no hover style, and the carousel controls are 44px targets', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    // Every :hover rule with declarations of its own sits inside @media (hover: hover).
    // Tailwind's hover: rules nest the media query inside the :hover rule, so they hold none.
    const ungated = await page.evaluate(() => {
      const found: string[] = [];
      const walk = (rules: CSSRuleList, gated: boolean) => {
        for (const rule of Array.from(rules)) {
          const inHover = gated || (rule instanceof CSSMediaRule && rule.conditionText.includes('hover: hover'));
          if (rule instanceof CSSStyleRule) {
            const s = rule.selectorText;
            if (s.includes(':hover') && rule.style.length > 0 && !inHover && !s.includes('[data-sonner') && !s.includes('::-webkit-scrollbar')) {
              found.push(s);
            }
          }
          if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules, inHover);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules, false);
        } catch {
          // A cross-origin sheet cannot be read
        }
      }
      return found;
    });
    expect(ungated).toEqual([]);

    if (test.info().project.name === 'mobile-webkit') {
      expect(await page.evaluate(() => (getComputedStyle(document.documentElement) as unknown as { webkitTextSizeAdjust: string }).webkitTextSizeAdjust)).toBe('100%');
    }

    await newNote(page);
    const editor = activeEditor(page);
    await appendToNote(editor, gallery('row', 5));
    const block = editor.locator('.gallery-block').first();
    const toolbar = block.locator('.gallery-toolbar > button');
    await expect(toolbar).toHaveCount(4);

    // A tapped layout button does not keep a hover background: one layout looks selected
    const selected = async () => (await Promise.all((await toolbar.all()).map(background))).filter((c) => c !== TRANSPARENT).length;
    await block.getByRole('button', { name: 'Grid', exact: true }).tap();
    await expect(editor.locator('[data-gallery="grid"]')).toHaveCount(1);
    await expect.poll(selected).toBe(1);
    await block.getByRole('button', { name: 'Carousel', exact: true }).tap();
    await expect(editor.locator('[data-gallery="carousel"]')).toHaveCount(1);
    await expect.poll(selected).toBe(1);

    const nav = block.locator('.gallery-nav');
    await expect(nav).toBeVisible();
    await nav.scrollIntoViewIfNeeded();
    const next = nav.getByRole('button', { name: 'Next image' });
    const prev = nav.getByRole('button', { name: 'Previous image' });
    const dots = nav.locator('.gallery-dots > button');
    await expect(dots).toHaveCount(5);

    // Next keeps its own background after a tap
    const carousel = editor.locator('[data-gallery="carousel"]');
    const at = () => carousel.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth));
    const before = await background(next);
    await next.tap();
    await expect.poll(at).toBe(1);
    await expect.poll(() => background(next)).toBe(before);

    // 44x44 hit boxes
    for (const target of [prev, next, ...(await dots.all())]) {
      const b = (await target.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }

    await page.setViewportSize({ width: 390, height: 852 });
    await expect(() => nav.scrollIntoViewIfNeeded()).toPass();
    await screenshotInBothThemes(page, (theme) => `gallery-touch-carousel-${theme}-390.png`);

    // Ten slides still fit on one line at 390px, each dot still a full-height target
    await appendToNote(editor, gallery('carousel', 10));
    const wide = editor.locator('.gallery-block').nth(1).locator('.gallery-nav');
    await expect(wide.locator('.gallery-dots > button')).toHaveCount(10);
    await expect(() => wide.scrollIntoViewIfNeeded()).toPass();
    const navBox = (await wide.boundingBox())!;
    expect(navBox.x).toBeGreaterThanOrEqual(0);
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(390);
    const lastDot = (await wide.locator('.gallery-dots > button').last().boundingBox())!;
    const wideNext = (await wide.getByRole('button', { name: 'Next image' }).boundingBox())!;
    expect(lastDot.height).toBeGreaterThanOrEqual(44);
    expect(lastDot.x + lastDot.width).toBeLessThanOrEqual(wideNext.x + 0.5);
    expect(wideNext.width).toBeGreaterThanOrEqual(44);
    await screenshotInBothThemes(page, (theme) => `gallery-touch-carousel-10-${theme}-390.png`);
  });
});

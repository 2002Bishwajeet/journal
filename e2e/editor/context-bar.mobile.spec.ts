import { devices, type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// The phone editor's bar changes with the selection (#1272): an insert bar at the caret, a
// format bar over a text selection, and Aa swaps the keyboard for the style panel. The keyboard
// is simulated as in mobile-toolbar.spec.ts: a shorter visual viewport (iOS) or none (Android).

const toolbar = (page: Page) => page.locator('[data-mobile-toolbar]');
const bar = (page: Page) => toolbar(page).locator('[data-bar]');
const panel = (page: Page) => page.getByRole('group', { name: 'Format', exact: true });
const editorFocused = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'));
const GAP = 8;

async function newNote(page: Page, body: string) {
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await activeEditor(page).tap();
  await page.keyboard.insertText(body);
  await expect(toolbar(page)).toBeVisible();
}

// The row fits without scrolling and every button is a 44px+ target.
async function expectFits(page: Page) {
  const row = toolbar(page).locator('.overflow-x-auto');
  expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  for (const button of await toolbar(page).getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

const barShot = (what: string, size: string) => (theme: string) => `${what}-${theme}-${size}.png`;
const bottomStrip = (width: number, height: number) => ({ clip: { x: 0, y: height - 160, width, height: 160 } });

test('the bar is the insert bar at the caret and the format bar over a text selection', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await newNote(page, 'Hello world');

    await test.step('caret: the insert bar fits at 390 px', async () => {
      await expect(bar(page)).toHaveAttribute('data-bar', 'insert');
      for (const title of ['Checklist', 'Bullet List', 'Add Image', 'Insert Table', 'Add Link', 'Text Styles', 'Hide keyboard']) {
        await expect(toolbar(page).getByTitle(title, { exact: true })).toBeVisible();
      }
      await expect(toolbar(page).getByTitle('Bold')).toHaveCount(0);
      await expectFits(page);
      await screenshotInBothThemes(page, barShot('insert-bar', '390'), undefined, bottomStrip(390, 844));
    });

    await test.step('a text selection shows the format bar within one frame', async () => {
      const shown = await page.evaluate(async () => {
        const text = document.activeElement!.closest('.ProseMirror')!.querySelector('p')!.firstChild!;
        // The note reads the selection on selectionchange; the bar must follow by the next frame.
        const changed = new Promise((resolve) => document.addEventListener('selectionchange', resolve, { once: true }));
        getSelection()!.setBaseAndExtent(text, 6, text, 11); // "world"
        await changed;
        await new Promise(requestAnimationFrame);
        return document.querySelector<HTMLElement>('[data-mobile-toolbar] [data-bar]')!.dataset.bar;
      });
      expect(shown).toBe('format');
      for (const title of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Add Link', 'Code', 'Clear Formatting', 'Rewrite with AI']) {
        await expect(toolbar(page).getByTitle(title, { exact: true })).toBeVisible();
      }
      await expectFits(page);
    });

    await test.step('Bold and Italic apply to the selection and show their state', async () => {
      const bold = toolbar(page).getByTitle('Bold', { exact: true });
      await expect(bold).toHaveAttribute('aria-pressed', 'false');
      await bold.tap();
      await expect(activeEditor(page).locator('strong')).toHaveText('world');
      await expect(bold).toHaveAttribute('aria-pressed', 'true');
      await toolbar(page).getByTitle('Italic', { exact: true }).tap();
      await expect(activeEditor(page).locator('em')).toHaveText('world');
      expect(await editorFocused(page)).toBe(true);
      await screenshotInBothThemes(page, barShot('format-bar', '390'), undefined, bottomStrip(390, 844));
    });

    await test.step('collapsing the selection brings the insert bar back', async () => {
      await page.keyboard.press('End');
      await expect(bar(page)).toHaveAttribute('data-bar', 'insert');
      await expect(toolbar(page).getByTitle('Text Styles')).toBeVisible();
    });
  });
});

test('Aa swaps the keyboard for the style panel, styles apply, and Close brings back the keyboard and caret', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await newNote(page, 'Big idea');
    // The iOS keyboard: only the visual viewport shrinks, by 328 px.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, 'height', { configurable: true, value: 516 });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect.poll(async () => (await toolbar(page).boundingBox())!.y + 58).toBeCloseTo(516 - GAP, 0);
    // The caret after "Big", where it should be again after the panel.
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');

    await toolbar(page).getByTitle('Text Styles').tap();
    await expect(panel(page)).toBeVisible();
    expect(await editorFocused(page)).toBe(false);
    await test.step('the panel takes the keyboard height and the bar sits on it', async () => {
      const box = (await panel(page).boundingBox())!;
      expect(box.height).toBeCloseTo(328, 0);
      await expect.poll(async () => (await panel(page).boundingBox())!.y).toBeCloseTo(844 - 328, 0);
      const barBox = (await toolbar(page).boundingBox())!;
      expect(barBox.y + barBox.height).toBeCloseTo(844 - 328 - GAP, 0);
      await screenshotInBothThemes(page, barShot('style-panel', '390'));
    });

    await test.step('styles apply to the block and the keyboard stays down', async () => {
      const title = panel(page).getByRole('button', { name: 'Title' });
      await title.tap();
      await expect(activeEditor(page).locator('h1')).toHaveText('Big idea');
      await expect(title).toHaveAttribute('aria-pressed', 'true');
      await panel(page).getByTitle('Align Center').tap();
      await expect(activeEditor(page).locator('h1[style*="text-align: center"]')).toHaveCount(1);
      await panel(page).getByRole('button', { name: 'Body' }).tap();
      await expect(activeEditor(page).locator('p', { hasText: 'Big idea' })).toHaveCount(1);
      await panel(page).getByTitle('Indent', { exact: true }).tap();
      await expect(activeEditor(page).locator('p[data-indent="1"]')).toHaveCount(1);
      await panel(page).getByTitle('Bullet List').tap();
      await expect(activeEditor(page).locator('ul li')).toHaveText('Big idea');
      await expect(panel(page)).toBeVisible();
      expect(await editorFocused(page)).toBe(false);
    });

    await test.step('Close returns focus and the caret to the note', async () => {
      await panel(page).getByRole('button', { name: 'Close format panel' }).tap();
      await expect(panel(page)).toBeHidden();
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.insertText('!');
      await expect(activeEditor(page).locator('ul li')).toHaveText('Big! idea');
      await expect.poll(async () => (await toolbar(page).boundingBox())!.y + 58).toBeCloseTo(516 - GAP, 0);
    });
  });
});

test('on Android, where the keyboard height is unknown, the panel is a sheet under the bar', async ({ browser }) => {
  const { defaultBrowserType: _engine, ...pixel } = devices['Pixel 7'];
  await withMobilePage(
    browser,
    async (page) => {
      const { width, height } = page.viewportSize()!;
      await newNote(page, 'Hello world');
      await expectFits(page);
      await page.keyboard.press('Control+Shift+ArrowLeft');
      await expect(bar(page)).toHaveAttribute('data-bar', 'format');
      await expectFits(page);
      await screenshotInBothThemes(page, barShot('format-bar', `android-${width}`), undefined, bottomStrip(width, height));
      await page.keyboard.press('End');
      await expect(bar(page)).toHaveAttribute('data-bar', 'insert');

      await toolbar(page).getByTitle('Text Styles').tap();
      await expect(panel(page)).toBeVisible();
      await expect.poll(async () => {
        const box = (await panel(page).boundingBox())!;
        return Math.round(box.y + box.height);
      }).toBe(height);
      const sheet = (await panel(page).boundingBox())!;
      expect(sheet.height).toBeGreaterThan(200);
      const barBox = (await toolbar(page).boundingBox())!;
      expect(barBox.y + barBox.height).toBeCloseTo(sheet.y - GAP, 0);
      await screenshotInBothThemes(page, barShot('style-panel', `android-${width}`));

      await panel(page).getByRole('button', { name: 'Subheading' }).tap();
      await expect(activeEditor(page).locator('h3')).toHaveText('Hello world');
      await toolbar(page).getByTitle('Text Styles').tap();
      await expect(panel(page)).toBeHidden();
      await expect.poll(() => editorFocused(page)).toBe(true);
    },
    pixel,
  );
});

import { devices, type Page } from '@playwright/test';
import { test, expect, withFencedPage, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';
import { assertTestOrigin } from '../support/origin-guard';

// The formatting toolbar floats 8px above the keyboard in every keyboard mode and
// its taps never blur the editor (#789). The keyboard is simulated: a smaller
// viewport (the layout resizes, as on Android) or a shorter, scrolled
// visualViewport (the layout stays, as on iOS).

const toolbar = (page: Page) => page.locator('[data-mobile-toolbar]');
const GAP = 8;

const toolbarBottom = async (page: Page) => {
  const box = await toolbar(page).boundingBox();
  return box ? box.y + box.height : -1;
};

test('the toolbar sits on the keyboard in each mode and a tap on Bold keeps the editor focused', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    // On a phone the sidebar shows first: open a folder to reach the notes list.
    await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    const editor = activeEditor(page);
    await editor.tap();
    await expect(toolbar(page)).toBeVisible();

    await test.step('the toolbar is a capsule with side margins, as tall as the caret math assumes', async () => {
      const box = (await toolbar(page).boundingBox())!;
      // MOBILE_TOOLBAR_HEIGHT in src/lib/editor/keyboardOffset.ts
      expect(box.height).toBeCloseTo(58, 0);
      // 12px side margin, then the 1px border and 4px padding of each capsule.
      expect((await toolbar(page).getByTitle('Checklist').boundingBox())!.x).toBeCloseTo(17, 0);
      const hide = (await toolbar(page).getByTitle('Hide keyboard').boundingBox())!;
      expect(hide.x + hide.width).toBeCloseTo(393 - 17, 0);
    });

    await test.step('the layout shrinks for the keyboard: the toolbar floats just above the bottom of the window', async () => {
      await page.setViewportSize({ width: 393, height: 516 });
      await expect(toolbar(page)).toBeVisible();
      await expect.poll(() => toolbarBottom(page)).toBeCloseTo(516 - GAP, 0);
      await screenshotInBothThemes(page, (theme) => `toolbar-resized-layout-${theme}-393x516.png`);
      await page.setViewportSize({ width: 393, height: 852 });
      await expect.poll(() => toolbarBottom(page)).toBeCloseTo(852 - GAP, 0);
    });

    await test.step('only the visual viewport shrinks and scrolls: the toolbar follows the keyboard top', async () => {
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Object.defineProperty(viewport, 'height', { configurable: true, value: 516 });
        Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 200 });
        viewport.dispatchEvent(new Event('resize'));
      });
      await expect.poll(() => toolbarBottom(page)).toBeCloseTo(716 - GAP, 0);
      await screenshotInBothThemes(page, (theme) => `toolbar-visual-viewport-${theme}-393x852.png`);
    });

    await test.step('a tap on Bold does not blur the editor and bolds the selection', async () => {
      await page.evaluate(() => {
        const prose = document.querySelector('.ProseMirror')!;
        (window as unknown as { __blurs: number }).__blurs = 0;
        prose.addEventListener('blur', () => { (window as unknown as { __blurs: number }).__blurs++; });
      });
      // Bold is on the format bar, which shows over a text selection (#1272).
      await page.keyboard.type('bold');
      await page.keyboard.press('Control+Shift+ArrowLeft');
      await toolbar(page).getByTitle('Bold').tap();
      await expect(editor.locator('strong')).toHaveText('bold');
      expect(await page.evaluate(() => (window as unknown as { __blurs: number }).__blurs)).toBe(0);
      await expect(toolbar(page)).toBeVisible();
    });
  });
});

test('an iPad in landscape shows only the top toolbar, not the keyboard toolbar too', async ({ browser }) => {
  const { defaultBrowserType: _engine, ...ipad } = devices['iPad Pro 11 landscape'];
  await withFencedPage(
    browser,
    { ...ipad, storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'block' },
    async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      await createNote(page, { title: `iPad ${Date.now()}`, body: 'Typing on an iPad' });
      await activeEditor(page).tap();
      await expect(activeEditor(page)).toBeFocused();
      await expect(page.getByTitle('Bold (Cmd+B)')).toBeVisible();
      await expect(toolbar(page)).toHaveCount(0);
      await screenshotInBothThemes(page, (theme) => `toolbar-ipad-landscape-${theme}.png`);
    },
  );
});

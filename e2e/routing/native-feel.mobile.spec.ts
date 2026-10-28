import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeEditor, activeTitleInput, createFolder, selectFolder, typeInEditor } from '../support/actions';
import { makeSolidPng } from '../support/png';

// App shell native feel (#856): touch-action, selection and overscroll.

const style = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

const userSelect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.userSelect || cs.getPropertyValue('-webkit-user-select');
  });

const noPageScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, inner: window.innerHeight }));

test('on home, controls are touch friendly, chrome is not selectable and the page does not bounce', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    expect(await style(page, 'button', 'touch-action')).toBe('manipulation');
    expect(await userSelect(page, 'button')).toBe('none');
    expect(await style(page, 'html', 'overscroll-behavior-y')).toBe('none');
    expect(await style(page, 'body', 'overscroll-behavior-y')).toBe('none');
    const home = await noPageScroll(page);
    expect(home.scroll).toBe(home.inner);
    await page.evaluate(() => document.body.appendChild(Object.assign(document.createElement('input'), { id: 'probe-input' })));
    expect(await userSelect(page, '#probe-input')).toBe('text');
  });
});

// On a phone the list is hidden while a note is open, so createNote's row check cannot run.
async function newNote(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const input = activeTitleInput(page);
  await expect(input).toHaveValue('Untitled');
  await input.fill(title);
  await typeInEditor(page, body);
}

// Longest animation running at any frame while `act` runs.
async function longestAnimation(page: Page, act: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __maxAnim: number; __sampling: boolean };
    w.__maxAnim = 0;
    w.__sampling = true;
    const tick = () => {
      for (const a of document.getAnimations()) {
        const d = Number(a.effect?.getTiming().duration ?? 0);
        if (d > w.__maxAnim) w.__maxAnim = d;
      }
      if (w.__sampling) requestAnimationFrame(tick);
    };
    tick();
  });
  await act();
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const w = window as unknown as { __maxAnim: number; __sampling: boolean };
    w.__sampling = false;
    return w.__maxAnim;
  });
}

test('a folder list and a note keep the shell still, selectable and touch friendly', async ({ browser }) => {
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    const folder = `Native ${Date.now()}`;
    const title = `Native note ${Date.now()}`;
    await createFolder(page, folder);
    await selectFolder(page, folder);

    // A long list: the list scrolls inside, the page does not.
    const viewport = page.locator('[data-radix-scroll-area-viewport]').first();
    await newNote(page, title, Array.from({ length: 60 }, (_, i) => `Line ${i}`).join('\n'));
    const png = makeSolidPng(240, 160, [40, 80, 200]).toString('base64');
    await activeEditor(page).evaluate((el, b64) => {
      const data = new DataTransfer();
      data.setData('text/html', `<img src="data:image/png;base64,${b64}" alt="blue">`);
      data.setData('text/plain', '');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, png);
    await expect(activeEditor(page).locator('img[alt="blue"]')).toBeVisible();

    // A long note: still no page scroll, and the editor text is selectable.
    expect(await userSelect(page, '.ProseMirror')).toBe('text');
    const note = await noPageScroll(page);
    expect(note.scroll).toBe(note.inner);

    // No hover on a touch screen: the image controls and tag remove button show.
    const tags = page.getByPlaceholder(/Add tags|^#$/).first();
    await tags.fill('native');
    await tags.press('Enter');
    const remove = page.locator('span.group:has-text("native") button').first();
    await expect(remove).toBeAttached();
    expect(await remove.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await activeEditor(page).locator('img[alt="blue"]').tap();
    const bar = page.getByRole('button', { name: 'Download image' });
    await expect(bar).toBeVisible();
    expect(Number(await bar.locator('xpath=..').evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('touch-controls-visible.png') });

    await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
    await expect(page.getByRole('heading', { name: folder })).toBeVisible();
    for (let i = 0; i < 25; i++) {
      const room = await viewport.evaluate((el) => el.scrollHeight - el.clientHeight);
      if (room > 100) break;
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
    }
    const list = await noPageScroll(page);
    expect(list.scroll).toBe(list.inner);
  });
});

test('with reduced motion, opening a folder and a note runs no animation', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const folder = `Calm ${Date.now()}`;
    const title = `Calm note ${Date.now()}`;
    await createFolder(page, folder);
    await selectFolder(page, folder);
    await newNote(page, title, 'Hello');
    // Before Back: home mounts EmptyEditorPage (#832), and its entrance must not be running when sampling starts.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
    await page.getByRole('button', { name: 'Back to notes' }).click();

    const folderMs = await longestAnimation(page, () => selectFolder(page, folder));
    expect(folderMs, 'opening a folder').toBeLessThanOrEqual(10);
    const noteMs = await longestAnimation(page, () =>
      page.getByTestId('note-row').filter({ hasText: title }).click(),
    );
    expect(noteMs, 'opening a note').toBeLessThanOrEqual(10);
  });
});

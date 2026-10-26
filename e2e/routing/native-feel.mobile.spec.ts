import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';

// App shell native feel (#856): touch-action, selection and overscroll.

const style = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

const userSelect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.userSelect || cs.getPropertyValue('-webkit-user-select');
  });

test('controls do not zoom on double tap and chrome is not selectable', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    expect(await style(page, 'button', 'touch-action')).toBe('manipulation');
    expect(await userSelect(page, 'button')).toBe('none');
  });
});

test('html and body never bounce and the page does not scroll', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    expect(await style(page, 'html', 'overscroll-behavior-y')).toBe('none');
    expect(await style(page, 'body', 'overscroll-behavior-y')).toBe('none');
    const heights = await page.evaluate(() => ({
      scroll: document.scrollingElement!.scrollHeight,
      inner: window.innerHeight,
    }));
    expect(heights.scroll).toBe(heights.inner);
  });
});

test('an input is selectable', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'probe-input';
      document.body.appendChild(input);
    });
    expect(await userSelect(page, '#probe-input')).toBe('text');
  });
});

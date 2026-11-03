import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

const PHONE = { width: 390, height: 844 };

test('on a phone, the What\'s new list scrolls to the oldest version', async ({ browser }) => {
  await withFencedPage(
    browser,
    { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: PHONE, hasTouch: true, isMobile: true },
    async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      // 2.3.0 is the oldest version in RELEASE_NOTES.md, so every later version shows.
      await page.evaluate(() => localStorage.setItem('journal-last-seen-version', '2.3.0'));
      await page.reload();
      await waitForAppReady(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });

      const dialog = page.getByRole('dialog', { name: "What's new" });
      await expect(dialog).toBeVisible();
      const list = dialog.locator('section').first().locator('..');
      const oldest = dialog.getByRole('heading', { name: /^v2\.3\.1/ });

      // The whole dialog fits on the screen and only the list scrolls.
      const box = (await dialog.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
      const { clientHeight, scrollHeight } = await list.evaluate((el) => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight }));
      expect(scrollHeight).toBeGreaterThan(clientHeight);
      await expect(oldest).not.toBeInViewport();

      // A finger swipe up on the list scrolls it. (Input.synthesizeScrollGesture is a no-op in headless Chromium.)
      const listBox = (await list.boundingBox())!;
      const x = listBox.x + listBox.width / 2;
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y = 0) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const [from, to] = [listBox.y + listBox.height * 0.8, listBox.y + listBox.height * 0.2];
      await touch('touchStart', from);
      for (let y = from; y > to; y -= 20) await touch('touchMove', y);
      await touch('touchEnd');
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

      await oldest.scrollIntoViewIfNeeded();
      await expect(oldest).toBeInViewport();
      await expect(dialog.getByRole('heading', { name: "What's new" })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Close' }).last()).toBeInViewport();

      await screenshotInBothThemes(page, (theme) => `whats-new-scrolled-${theme}-390.png`);
    },
  );
});

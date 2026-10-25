import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { createNote, inBothThemes, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import type { Page } from '@playwright/test';

const PHONE = { width: 393, height: 852 };

async function boot(browser: Parameters<typeof withFencedPage>[0], body: (page: Page) => Promise<void>) {
  await withFencedPage(
    browser,
    { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: PHONE, hasTouch: true, isMobile: true },
    async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      await body(page);
    },
  );
}

/** Close box >= 44x44, footer buttons >= 44 tall, title left-aligned. */
async function expectTouchSized(page: Page, dialogName: string | RegExp, footerButtons: string[]) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  // The open animation scales the dialog; measure once it has settled.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const close = (await dialog.getByRole('button', { name: 'Close' }).last().boundingBox())!;
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
  for (const name of footerButtons) {
    const box = (await dialog.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const title = dialog.locator('[data-slot=dialog-title]');
  expect(await title.evaluate((el) => getComputedStyle(el.parentElement!).textAlign)).toBe('left');
  expect(await title.evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
}

test('New folder dialog has 44px targets and a left-aligned header', async ({ browser }) => {
  await boot(browser, async (page) => {
    await page.getByRole('button', { name: 'New folder' }).click();
    await expectTouchSized(page, /folder/i, ['Create', 'Cancel']);
    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`new-folder-${theme}-393.png`) });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: test.info().outputPath('new-folder-light-1280.png') });
  });
});

test('Move to Trash confirm has 44px targets and a visible dark outline', async ({ browser }) => {
  await boot(browser, async (page) => {
    // Make the note at desktop width (the phone layout has no inline "New" list), then go phone-sized.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await waitForAppReady(page);
    await createNote(page, { title: 'Dialog audit note', body: 'body' });
    await waitForNoteSaved(page);
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByTestId('note-row').filter({ hasText: 'Dialog audit note' }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await expectTouchSized(page, 'Move to Trash?', ['Move to Trash', 'Cancel']);
    const dialog = page.getByRole('dialog', { name: 'Move to Trash?' });
    await inBothThemes(page, async (theme) => {
      if (theme === 'dark') {
        expect(await dialog.evaluate((el) => getComputedStyle(el).getPropertyValue('--input').trim().toLowerCase())).toBe('#3e3d3a');
      }
      await page.screenshot({ path: test.info().outputPath(`trash-confirm-${theme}-393.png`) });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: test.info().outputPath('trash-confirm-light-1280.png') });
  });
});

test("What's new fits inside the viewport", async ({ browser }) => {
  await boot(browser, async (page) => {
    await page.evaluate(() => localStorage.setItem('journal-last-seen-version', '2.3.0'));
    await page.reload();
    await waitForAppReady(page);
    const dialog = page.getByRole('dialog', { name: "What's new" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`whats-new-${theme}-393.png`) });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: test.info().outputPath('whats-new-light-1280.png') });
  });
});

test('Search is exposed as a dialog', async ({ browser }) => {
  await boot(browser, async (page) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: /search/i })).toBeVisible();
  });
});

import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { withMobilePage } from '../support/mobile';

// The status bar takes its colour from the active <meta name="theme-color">. It
// follows the in-app Light/Dark choice and the surface at the top of the screen (#893).

const THEME_KEY = 'journal-theme-preference';

// The content of the theme-color meta whose media matches (or has none), as rgb().
const activeThemeColor = (page: Page) =>
  page.evaluate(() => {
    const meta = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
      (m) => !m.media || matchMedia(m.media).matches,
    );
    const probe = document.createElement('div');
    probe.style.color = meta?.content ?? '';
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  });

// The first opaque background under the top-centre pixel of the screen.
const topSurface = (page: Page) =>
  page.evaluate(() => {
    for (let el = document.elementFromPoint(innerWidth / 2, 1); el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return getComputedStyle(document.body).backgroundColor;
  });

const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, name);

const expectBarMatchesTop = async (page: Page) =>
  expect.poll(async () => (await activeThemeColor(page)) === (await topSurface(page))).toBe(true);

async function reloadWithTheme(page: Page, theme: 'light' | 'dark') {
  await assertTestOrigin(page);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, theme]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // First frame: the inline script in index.html has already set the meta, before React mounts.
  expect(await activeThemeColor(page)).toBe(await token(page, '--background'));
  await waitForAppReady(page);
}

async function pickTheme(page: Page, label: 'Light' | 'Dark') {
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await dialog.getByRole('radiogroup', { name: 'Theme' }).getByText(label, { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

for (const [os, app, other] of [
  ['light', 'dark', 'Light'],
  ['dark', 'light', 'Dark'],
] as const) {
  test(`OS ${os}, app ${app}: theme-color follows the app on reload and on a toggle`, async ({ browser }) => {
    await withMobilePage(browser, async (page) => {
      await page.emulateMedia({ colorScheme: os });
      await reloadWithTheme(page, app);
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${app}\\b`));
      await expectBarMatchesTop(page);
      const appColor = await activeThemeColor(page);

      // Toggle in Settings, no reload
      await pickTheme(page, other);
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${os}\\b`));
      await expectBarMatchesTop(page);
      expect(await activeThemeColor(page)).not.toBe(appColor);
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: theme-color is --sidebar on the phone home and --background in a folder`, async ({ browser }, testInfo) => {
    await withMobilePage(browser, async (page) => {
      await reloadWithTheme(page, theme);

      await expect.poll(() => activeThemeColor(page)).toBe(await token(page, '--sidebar'));
      await expectBarMatchesTop(page);
      await testInfo.attach(`home-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });

      await selectFolder(page, 'Main');
      await expect(page.getByRole('heading', { name: 'Main' }).first()).toBeVisible();
      await expect.poll(() => activeThemeColor(page)).toBe(await token(page, '--background'));
      await expectBarMatchesTop(page);
      await testInfo.attach(`folder-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });

      await page.goBack();
      await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
      await expect.poll(() => activeThemeColor(page)).toBe(await token(page, '--sidebar'));
    });
  });
}

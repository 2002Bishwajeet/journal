import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { openSettingsSection } from '../support/actions';

// #1182: Settings per platform at 390 px (phone) and desktop, screenshots of the list and
// each page in both themes. The native shell is faked with window.__JOURNAL_NATIVE__.

const CASES = [
  { name: 'ios', native: 'ios', size: { width: 390, height: 844 }, ai: false, shortcuts: false },
  { name: 'android', native: 'android', size: { width: 390, height: 844 }, ai: false, shortcuts: false },
  { name: 'web-phone', native: null, size: { width: 390, height: 844 }, ai: false, shortcuts: false },
  { name: 'macos', native: 'macos', size: { width: 1280, height: 800 }, ai: true, shortcuts: true },
  { name: 'web-desktop', native: null, size: { width: 1280, height: 800 }, ai: true, shortcuts: true },
] as const;

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

for (const c of CASES) {
  test(`settings on ${c.name}`, async ({ app }) => {
    test.setTimeout(90_000);
    const platform = c.native;
    await app.addInitScript((p) => {
      if (p) window.__JOURNAL_NATIVE__ = { platform: p };
    }, platform);
    await app.setViewportSize(c.size);
    await app.reload();
    await waitForAppReady(app);
    await app.getByRole('button', { name: 'Settings' }).click();
    const dialog = app.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await settle(app);

    const phone = c.size.width < 768;
    const entry = phone ? dialog.getByRole('listitem').getByRole('button', { name: 'AI', exact: true }) : dialog.getByRole('tab', { name: 'AI', exact: true });
    await expect(entry).toHaveCount(c.ai ? 1 : 0);
    await expect(dialog.getByRole('tab', { name: 'Keyboard shortcuts' })).toHaveCount(c.shortcuts ? 1 : 0);

    const shoot = async (what: string) => {
      for (const scheme of ['light', 'dark'] as const) {
        await app.emulateMedia({ colorScheme: scheme });
        await app.screenshot({ path: test.info().outputPath(`${what}-${scheme}-${c.name}.png`), animations: 'disabled' });
      }
    };
    await shoot('list');
    for (const section of ['Account', 'Appearance', 'Data & storage', 'About']) {
      await openSettingsSection(dialog, section);
      await settle(app);
      await shoot(section.toLowerCase().replace(/\W+/g, '-'));
    }
    if (c.native) await expect(dialog.getByText(/browser/i)).toHaveCount(0);
  });
}

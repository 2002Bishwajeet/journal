import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { openSettingsSection } from '../support/actions';

// #1182: Settings per platform at 390 px (phone) and desktop, screenshots of the list and
// each page in both themes. The native shell is faked with window.__JOURNAL_NATIVE__.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
// `notifications`: the phone app has no web push and the hermetic build no reminder scheduler.
const CASES = [
  { name: 'ios', native: 'ios', size: PHONE, ai: false, shortcuts: false, notifications: false },
  { name: 'android', native: 'android', size: PHONE, ai: false, shortcuts: false, notifications: false },
  { name: 'web-phone', native: null, size: PHONE, ai: false, shortcuts: false, notifications: true },
  { name: 'macos', native: 'macos', size: DESKTOP, ai: true, shortcuts: true, notifications: true },
  { name: 'web-desktop', native: null, size: DESKTOP, ai: true, shortcuts: true, notifications: true },
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
    const notifications = phone
      ? dialog.getByRole('listitem').getByRole('button', { name: 'Notifications', exact: true })
      : dialog.getByRole('tab', { name: 'Notifications', exact: true });
    await expect(notifications).toHaveCount(c.notifications ? 1 : 0);
    if (phone) {
      // Android: full-width Material rows; iOS and the web: inset cards.
      const list = await dialog.getByRole('list').first().boundingBox();
      if (c.name === 'android') expect(list?.x).toBe(0);
      else expect(list?.x).toBeGreaterThan(0);
      await expect(dialog.getByText('Privacy & agents', { exact: true })).toBeVisible();
    }

    const shoot = async (what: string) => {
      for (const scheme of ['light', 'dark'] as const) {
        await app.emulateMedia({ colorScheme: scheme });
        await app.screenshot({ path: test.info().outputPath(`${what}-${scheme}-${c.name}.png`), animations: 'disabled' });
      }
    };
    await shoot('list');
    const pages = [
      'Account',
      'Appearance',
      ...(c.ai ? ['AI'] : []),
      'Agent access',
      ...(c.notifications ? ['Notifications'] : []),
      'Data & storage',
      ...(c.shortcuts ? ['Keyboard shortcuts'] : []),
      'About',
      'Diagnostics',
    ];
    for (const section of pages) {
      await openSettingsSection(dialog, section);
      await settle(app);
      await shoot(section.toLowerCase().replace(/\W+/g, '-'));
      // The app never calls itself a browser (#1182).
      if (c.native) await expect(dialog.getByText(/browser/i)).toHaveCount(0);
      // The hermetic seed leaves a change waiting, so the subtitle is "N waiting · last synced …".
      if (section === 'Account') await expect(dialog.getByRole('status').filter({ hasText: /last synced/i })).toBeVisible();
      if (section === 'Keyboard shortcuts') {
        await expect(dialog.getByText(c.native === 'macos' ? '⌘' : 'Ctrl', { exact: true }).first()).toBeVisible();
      }
    }
  });
}

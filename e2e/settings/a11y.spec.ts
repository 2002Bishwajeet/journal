import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Settings controls are keyboard-operable with a visible focus indicator, and
// meet the 44 px touch-target size on mobile (#211).

// Presses Tab until `target` has focus, so the focus is keyboard-driven
// (`:focus-visible`), not programmatic.
async function tabTo(page: Page, target: Locator, maxPresses = 30): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

// Enables AI without touching the switch: turning it on from the UI would start
// loading WebLLM.
async function seedAIEnabled(page: Page): Promise<void> {
  await assertTestOrigin(page);
  await page.evaluate(() => {
    localStorage.setItem('journal-ai-settings', JSON.stringify({ enabled: true, _v: 2 }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
}

const outlineOf = (el: Element) => getComputedStyle(el).outlineStyle;

test('keyboard: theme radios, switches, and Import/Export focus rings', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  // AI on starts a WebLLM model fetch; abort it here (page routes run before the
  // context-level network fence) so the test doesn't depend on its timing.
  await app.route('https://huggingface.co/**', (route) => route.abort());
  await seedAIEnabled(app);
  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Appearance' }).click();

  // Theme: Tab enters the group on the checked radio; ArrowRight picks the next
  // theme immediately.
  const themes = dialog.getByRole('radiogroup', { name: 'Theme' });
  const checkedCard = themes.locator('label').filter({ has: app.locator('input:checked') });
  await expect.poll(() => checkedCard.evaluate(outlineOf)).toBe('none');
  await tabTo(app, themes.getByRole('radio', { checked: true }));
  // Focus is distinct from the selected ring.
  await expect.poll(() => checkedCard.evaluate(outlineOf)).toBe('solid');

  const initial = await themes.getByRole('radio', { checked: true }).getAttribute('value');
  await app.keyboard.press('ArrowRight');
  await expect(themes.getByRole('radio', { checked: true })).not.toHaveAttribute('value', initial!);

  // Cycle to Dark, then on round to Light; each step applies immediately.
  const dark = themes.getByRole('radio', { name: 'Dark' });
  for (let i = 0; i < 2 && !(await dark.isChecked()); i++) await app.keyboard.press('ArrowRight');
  await expect(dark).toBeChecked();
  await expect(dark).toBeFocused();
  await expect(app.locator('html')).toHaveClass(/\bdark\b/);
  await app.keyboard.press('ArrowRight');
  await expect(themes.getByRole('radio', { name: 'System' })).toBeChecked();
  await app.keyboard.press('ArrowRight');
  await expect(themes.getByRole('radio', { name: 'Light' })).toBeChecked();
  await expect(app.locator('html')).not.toHaveClass(/\bdark\b/);

  // AI: Tab reaches each Switch and Space toggles it.
  await dialog.getByRole('tab', { name: 'AI', exact: true }).click();
  for (const name of ['Autocomplete', 'Grammar Check', 'Enable on-device AI']) {
    const toggle = dialog.getByRole('switch', { name });
    const before = await toggle.getAttribute('aria-checked');
    await dialog.getByRole('tab', { name: 'AI', exact: true }).focus();
    await tabTo(app, toggle);
    await app.keyboard.press('Space');
    await expect(toggle).not.toHaveAttribute('aria-checked', before!);
  }

  // Data & storage: Import/Export are reachable by Tab and show a focus ring.
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.getByRole('tab', { name: 'Data & storage' }).focus();
  for (const name of ['Import Archive', 'Export All Notes']) {
    const button = dialog.getByRole('button', { name });
    await tabTo(app, button);
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  }
});

test('mobile: every Settings control is at least 44 x 44 px', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  await seedAIEnabled(app);
  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');

  const sections = ['Account', 'Appearance', 'AI', 'Agent access', 'Data & storage', 'About'];
  for (const section of sections) {
    await dialog.getByRole('tab', { name: section, exact: true }).click();
    const panel = dialog.getByRole('tabpanel');
    // The panel must fit the dialog: a wide nav strip must not widen the grid column.
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), `${section}: horizontal overflow`).toBe(true);
    // A radio or switch is operated through its card / row label, which is the
    // touch target. Links inline in a sentence are exempt (WCAG 2.5.5 "Inline").
    const sizes = await panel.evaluate((root) => {
      const targetOf = (el: Element): Element => {
        if (el.matches('input[type=radio]')) return el.closest('label')!;
        if (el.matches('[role=switch]')) return el.closest('.min-h-14') ?? el;
        return el;
      };
      const controls = root.querySelectorAll(
        'button, a[href]:not(p a), input:not([type=file]), [role=switch], [role=radio]',
      );
      return [...new Set([...controls].map(targetOf))].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      });
    });
    const tooSmall = sizes.filter((s) => s.width < 44 || s.height < 44);
    expect(tooSmall, `${section}: controls under 44 px`).toEqual([]);
  }

  const tabs = await dialog.getByRole('tab').evaluateAll((els) =>
    els.map((el) => ({ name: el.textContent, height: Math.round(el.getBoundingClientRect().height) })),
  );
  expect(tabs.filter((t) => t.height < 44)).toEqual([]);
});

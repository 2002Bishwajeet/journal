import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Screenshot evidence for the settings visual pass (#395): every section, in
// both themes, at desktop and phone width. Written to test-results/ via
// outputPath as <section>-<theme>-<viewport>.png; a section taller than the
// pane also gets -part2, -part3… after scrolling.

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;

const SECTIONS: { id: string; tab: string; desktopOnly?: boolean }[] = [
  { id: 'account', tab: 'Account' },
  { id: 'appearance', tab: 'Appearance' },
  { id: 'ai', tab: 'AI' },
  { id: 'agent-access', tab: 'Agent access' },
  { id: 'data', tab: 'Data & storage' },
  { id: 'shortcuts', tab: 'Keyboard shortcuts', desktopOnly: true },
  { id: 'about', tab: 'About' },
];

async function capture(page: Page, name: string): Promise<void> {
  const scroller = page.getByRole('dialog').getByRole('tabpanel').locator('..');
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  for (let part = 1; ; part++) {
    await page.screenshot({
      path: test.info().outputPath(part === 1 ? `${name}.png` : `${name}-part${part}.png`),
      animations: 'disabled',
    });
    const scrolled = await scroller.evaluate((el) => {
      const before = el.scrollTop;
      el.scrollBy(0, el.clientHeight - 64);
      return el.scrollTop > before;
    });
    if (!scrolled) break;
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    test(`screenshots: every settings section (${colorScheme}, ${viewport})`, async ({ app }) => {
      test.setTimeout(120_000);
      const isMobile = viewport === 'mobile';
      // A model download must never start from a screenshot run.
      await app.route('https://huggingface.co/**', (route) => route.abort());
      await app.emulateMedia({ colorScheme });
      await app.setViewportSize(size);

      const open = async () => {
        await app.getByRole('button', { name: 'Settings' }).click();
        return app.getByRole('dialog');
      };
      let dialog = await open();

      for (const section of SECTIONS) {
        if (isMobile && section.desktopOnly) continue;
        await dialog.getByRole('tab', { name: section.tab, exact: true }).click();
        const panel = dialog.getByRole('tabpanel');
        await expect(panel.getByRole('heading', { name: section.tab, exact: true })).toBeVisible();
        if (section.id === 'data') await expect(panel.getByText('Storage used')).toBeVisible();
        await capture(app, `${section.id}-${colorScheme}-${viewport}`);
      }

      // AI switched on (desktop only: phones can't run it). The model host is
      // blocked, so this is the section with its error + Retry line showing.
      if (isMobile) return;
      await assertTestOrigin(app);
      await app.evaluate(() => {
        localStorage.setItem('journal-ai-settings', JSON.stringify({ enabled: true, _v: 2 }));
      });
      await app.reload();
      await waitForAppReady(app);
      dialog = await open();
      await dialog.getByRole('tab', { name: 'AI', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText("Couldn't load the AI model.");
      await capture(app, `ai-on-${colorScheme}-${viewport}`);
    });
  }
}

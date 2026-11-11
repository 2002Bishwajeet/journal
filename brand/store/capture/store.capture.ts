import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { waitForAppReady } from '../../../e2e/fixtures';
import { OUT, productionHost, statusBar, withSeededApp, type Shot } from './support';

// Raw captures for the store screenshots (brand/store/README.md).
type Target = { name: string; bar: 'ios' | 'android' | 'ipad'; shot: Shot; phone: boolean };
const TARGETS: Target[] = [
  { name: 'iphone', bar: 'ios', phone: true, shot: { width: 440, height: 956, scale: 3, touch: true, insets: { top: 62, bottom: 34 } } },
  { name: 'android', bar: 'android', phone: true, shot: { width: 412, height: 892, scale: 3, touch: true, insets: { top: 36, bottom: 24 } } },
  { name: 'ipad', bar: 'ipad', phone: false, shot: { width: 1032, height: 1376, scale: 2, touch: true, insets: { top: 32, bottom: 20 } } },
];


// Phones restore the last screen on load: Back out of a note, then the active
// Notes tab pops to its root. Tablets show the folders beside the list already.
async function home(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  const folders = page.getByText('Folders', { exact: true }).filter({ visible: true });
  const back = page.getByRole('button', { name: /^Back/ }).filter({ visible: true }).first();
  const notesTab = page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Notes' });
  // Twice: the app may restore the last note a moment after boot.
  for (const pause of [0, 1500]) {
    await page.waitForTimeout(pause);
    for (let i = 0; i < 5 && !(await folders.isVisible()); i++) {
      if (await back.isVisible()) await back.click({ timeout: 2000 }).catch(() => {});
      else if (await notesTab.isVisible()) await notesTab.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(700); // the pane slide-in; nothing to wait on until it ends
    }
  }
}

async function openNote(page: Page, folder: string, title: string) {
  await home(page);
  await page.getByText(folder, { exact: true }).filter({ visible: true }).first().click();
  await page.getByText(title, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('textbox', { name: 'Note title' }).filter({ hasText: title, visible: true }).first().waitFor();
}

async function settle(page: Page, t: Target) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) if (b.textContent?.startsWith('Add cover')) b.style.visibility = 'hidden';
  });
  await statusBar(page, t.bar, t.shot.insets!.top);
  await page.waitForTimeout(1200); // live blocks and fonts paint; nothing observable to wait on
}

for (const t of TARGETS) {
  for (const dark of [false, true]) {
    test(`${t.name} ${dark ? 'dark' : 'light'}`, async ({ browser }) => {
      const dir = join(OUT, t.name, dark ? 'dark' : 'light');
      mkdirSync(dir, { recursive: true });
      const snap = async (page: Page, file: string) => { await settle(page, t); await page.screenshot({ path: join(dir, file) }); };
      // Dark is only used for the list and the live block (the dark slides 2 and 4).
      const want = (n: number) => !dark || n === 2 || n === 4;
      await withSeededApp(browser, { ...t.shot, dark }, async (page) => {
        if (want(1)) {
          await openNote(page, 'Travel', 'Three days in Lisbon');
          await snap(page, '01-lisbon.png');
        }

        if (want(2)) {
          await home(page);
          await page.getByTitle('Journal', { exact: true }).filter({ visible: true }).first().click();
          await page.getByText('Morning pages').filter({ visible: true }).first().waitFor();
          await snap(page, '02-list.png');
        }

        if (want(3)) {
          await openNote(page, 'Kitchen', 'Sourdough, the weekend loaf');
          await page.getByText('Feed the starter').filter({ visible: true }).first().click();
          await page.keyboard.press('End');
          await snap(page, '03-sourdough.png');
          await page.keyboard.press('Escape');
        }

        if (want(4)) {
          await openNote(page, 'Training', 'Half marathon block');
          await page.locator('iframe').filter({ visible: true }).first().contentFrame().getByText('Weekly distance').waitFor({ timeout: 30_000 });
          await snap(page, '04-running.png');
        }

        if (want(5)) {
          await openNote(page, 'Travel', 'Three days in Lisbon');
          if (t.phone) await page.getByRole('button', { name: 'More', exact: true }).filter({ visible: true }).first().click();
          // Tablets show the list beside the note: its row's context menu has Share…
          else await page.getByText(/\d+h ago/).filter({ visible: true }).first().click({ button: 'right' });
          await page.getByRole('menuitem', { name: 'Share…' }).click();
          await page.getByText('Publish to feed').waitFor();
          if (t.phone) await page.getByText('Publish to feed').scrollIntoViewIfNeeded();
          await productionHost(page);
          await snap(page, '05-share.png');
          await page.keyboard.press('Escape');
        }

        if (want(6)) {
          await home(page);
          if (t.phone) await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Search' }).click();
          else await page.getByText('Search', { exact: true }).filter({ visible: true }).first().click();
          await page.getByPlaceholder(/Search notes/).filter({ visible: true }).first().fill('run');
          await page.getByText('Half marathon block').filter({ visible: true }).first().waitFor();
          await snap(page, '06-search.png');
        }
      });
    });
  }
}

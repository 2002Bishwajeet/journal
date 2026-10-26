/**
 * Saves the install-dialog screenshots listed in the manifest (vite.config.ts,
 * `screenshots`) to public/screenshots/.
 *
 * It runs only against the hermetic e2e build (fake identity, seeded notes made
 * through the UI, network fence on). Start that build first, then run:
 *
 *   npx vite build --mode e2e --outDir dist-e2e
 *   npx vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort &
 *   npx vite-node scripts/pwa-screenshots.ts
 *
 * narrow: 390x844 at 3x = 1170x2532; wide: 1280x800 at 2x = 2560x1600. Light theme only.
 */
import { chromium, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { activeEditor, activeTitleInput, createFolder, createNote, typeInEditor, waitForNoteSaved } from '../e2e/support/actions';
import { installNetworkFence, assertNoFenceViolations } from '../e2e/support/network-fence';
import { assertAllowedOrigin, assertTestOrigin } from '../e2e/support/origin-guard';

const BASE_URL = 'http://127.0.0.1:4173';
const OUT = 'public/screenshots';

const NOTES = [
  { title: 'Trip to Lisbon', body: 'Flights booked for May. Pack light, book the tram tour, try the custard tarts.' },
  { title: 'Reading list', body: 'Finish the essays on slow software, then start the book about gardens.' },
  { title: 'Weekly plan', body: 'Monday: draft the proposal. Wednesday: review notes. Friday: tidy the desk.' },
];

const DIAGRAM = '<pre><code class="language-mermaid">graph TD; Idea--&gt;Draft; Draft--&gt;Publish</code></pre>';

async function boot(page: Page) {
  await page.goto(BASE_URL + '/');
  await assertTestOrigin(page);
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
  // Hide the "What's new" dialog.
  await page.evaluate(() => localStorage.setItem('journal-last-seen-version', '999.0.0'));
  await page.reload();
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
  await page.emulateMedia({ colorScheme: 'light' });
}

const shoot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}/${name}.png` });

const back = (page: Page) => page.locator('button[aria-label^="Back"]:visible').first();

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });

async function narrow(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    storageState: 'e2e/fixtures/hermetic-auth.json',
    serviceWorkers: 'block',
  });
  const { violations } = await installNetworkFence(context);
  const page = await context.newPage();
  await boot(page);

  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  await sidebar(page).getByText('Main', { exact: true }).click();
  for (const note of NOTES) {
    // createNote waits for a list row, which a phone hides behind the editor.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(activeTitleInput(page)).toHaveValue('Untitled');
    await activeTitleInput(page).fill(note.title);
    await typeInEditor(page, note.body);
    await back(page).click();
    await page.waitForTimeout(600);
  }
  const search = sidebar(page).getByRole('button', { name: /Search/ });
  const toSidebar = async () => {
    while (!(await search.isVisible())) {
      await back(page).click();
      await page.waitForTimeout(600);
    }
  };
  await toSidebar();
  await shoot(page, 'narrow-notes');

  await sidebar(page).getByText('Main', { exact: true }).click();
  await page.getByRole('button').filter({ hasText: NOTES[0].title }).first().click();
  await expect(activeEditor(page)).toContainText(NOTES[0].body.slice(0, 20));
  await page.waitForTimeout(500);
  await shoot(page, 'narrow-note');

  await toSidebar();
  await search.click();
  const dialog = page.getByRole('dialog', { name: 'Search notes' });
  await dialog.waitFor();
  await dialog.getByRole('searchbox').or(dialog.getByRole('textbox')).first().fill('plan');
  await page.waitForTimeout(800);
  await shoot(page, 'narrow-search');

  await context.close();
  assertNoFenceViolations(violations);
}

async function wide(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    storageState: 'e2e/fixtures/hermetic-auth.json',
    serviceWorkers: 'block',
  });
  const { violations } = await installNetworkFence(context);
  const page = await context.newPage();
  await boot(page);

  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  for (const note of NOTES) await createNote(page, note);
  await page.getByRole('button').filter({ hasText: NOTES[0].title }).first().click();
  await expect(activeEditor(page)).toContainText(NOTES[0].body.slice(0, 20));
  await page.waitForTimeout(500);
  await shoot(page, 'wide-note');

  await createNote(page, { title: 'Publishing flow', body: 'How a note moves from idea to published:\n' });
  const editor = activeEditor(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await editor.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, DIAGRAM);
  await expect(page.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await waitForNoteSaved(page);
  await shoot(page, 'wide-live-block');

  await context.close();
  assertNoFenceViolations(violations);
}

assertAllowedOrigin(BASE_URL);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  await narrow(browser);
  await wide(browser);
} finally {
  await browser.close();
}

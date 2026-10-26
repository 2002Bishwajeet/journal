/**
 * Records the landing page's product media (site/public/media/) from the real app:
 * light and dark screenshots of a note and a live block, phone screenshots,
 * and the hero demo video (desktop, then the phone layout).
 *
 * It runs only against the hermetic e2e build (fake identity, notes made through the
 * UI, network fence on). Needs ffmpeg. Start that build first, then run:
 *
 *   npx vite build --mode e2e --outDir dist-e2e
 *   npx vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 5174 --strictPort &
 *   npx vite-node scripts/landing-media.ts
 */
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activeEditor, activeTitleInput, createFolder, waitForNoteSaved } from '../e2e/support/actions';
import { installNetworkFence, assertNoFenceViolations } from '../e2e/support/network-fence';
import { assertAllowedOrigin, assertTestOrigin } from '../e2e/support/origin-guard';

const BASE_URL = 'http://127.0.0.1:5174';
const OUT = 'site/public/media';
const WORK = mkdtempSync(path.join(tmpdir(), 'landing-media-'));

type Theme = 'light' | 'dark';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const task = (done: boolean, text: string) => `<li data-type="taskItem" data-checked="${done}"><p>${text}</p></li>`;

const TRIP = {
  title: 'Trip plan',
  html: [
    '<h2>Day one</h2>',
    '<p>Land at <strong>10:15</strong>, drop the bags, then walk down to the river for lunch.</p>',
    `<ul data-type="taskList">${task(true, 'Book the flights')}${task(true, 'Reserve the guesthouse')}${task(false, 'Buy tram passes')}</ul>`,
    '<div data-type="callout" data-variant="tip"><p>The castle is quietest before ten in the morning.</p></div>',
    '<table><tr><th><p>Day</p></th><th><p>Plan</p></th></tr>',
    '<tr><td><p>Saturday</p></td><td><p>Alfama and the castle</p></td></tr>',
    '<tr><td><p>Sunday</p></td><td><p>Belém and the river walk</p></td></tr></table>',
  ].join(''),
};

const READING_CHART = [
  "import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';",
  '',
  'const data = [',
  "  { month: 'Jan', books: 3 }, { month: 'Feb', books: 2 }, { month: 'Mar', books: 4 },",
  "  { month: 'Apr', books: 1 }, { month: 'May', books: 5 }, { month: 'Jun', books: 3 },",
  '];',
  '',
  'export default function ReadingLog() {',
  '  return (',
  '    <div className="space-y-2 font-sans">',
  '      <h3 className="text-base font-semibold">Books finished per month</h3>',
  '      <ResponsiveContainer width="100%" height={160}>',
  '        <BarChart data={data}>',
  '          <XAxis dataKey="month" tickLine={false} axisLine={false} />',
  '          <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} />',
  '          <Tooltip cursor={false} />',
  '          <Bar dataKey="books" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />',
  '        </BarChart>',
  '      </ResponsiveContainer>',
  '    </div>',
  '  );',
  '}',
].join('\n');

// A phone column fits a top-down diagram; a desktop note fits one that runs left to right.
const reading = (flow: 'LR' | 'TD') => ({
  title: 'Reading log',
  html: [
    '<p>Built by an agent from my reading list, as live blocks.</p>',
    `<pre><code class="language-react">${esc(READING_CHART)}</code></pre>`,
    `<pre><code class="language-mermaid">${esc(`graph ${flow}; Pick-->Read; Read-->Review`)}</code></pre>`,
  ].join(''),
});
const READING = reading('LR');

const WEEKLY = { title: 'Weekly plan', html: '<p>Monday: draft the proposal. Wednesday: review notes. Friday: tidy the desk.</p>' };

async function boot(page: Page): Promise<void> {
  await page.goto(BASE_URL + '/');
  await assertTestOrigin(page);
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
  // Hide the "What's new" dialog.
  await page.evaluate(() => localStorage.setItem('journal-last-seen-version', '999.0.0'));
  await page.reload();
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
}

async function newContext(browser: Browser, phone: boolean, theme: Theme): Promise<{ context: BrowserContext; page: Page; violations: string[] }> {
  const context = await browser.newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }),
    colorScheme: theme,
    storageState: 'e2e/fixtures/hermetic-auth.json',
    serviceWorkers: 'block',
  });
  const { violations } = await installNetworkFence(context);
  const page = await context.newPage();
  await boot(page);
  return { context, page, violations };
}

const back = (page: Page) => page.locator('button[aria-label^="Back"]:visible').first();
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });

/** New note through the UI; the body is pasted as HTML, so blocks arrive whole. */
async function addNote(page: Page, note: { title: string; html: string }, phone: boolean): Promise<void> {
  await page.getByRole('button', { name: /^New( note)?$/ }).click();
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeTitleInput(page).fill(note.title);
  if (!phone) await expect(page.getByTestId('note-row').filter({ hasText: note.title })).toBeVisible();
  await activeEditor(page).click();
  await activeEditor(page).evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, note.html);
  await waitForNoteSaved(page);
}

async function shot(page: Page, name: string): Promise<void> {
  const png = path.join(WORK, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', `${OUT}/${name}.webp`]);
}

async function openSearch(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search notes' });
  await expect(dialog.getByRole('searchbox').or(dialog.getByRole('textbox')).first()).toBeFocused();
  await page.waitForTimeout(300);
  await page.keyboard.type(query, { delay: 90 });
  await page.waitForTimeout(800);
}

async function wide(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, false, theme);
  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  await addNote(page, WEEKLY, false);
  await addNote(page, READING, false);
  await expect(page.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.frameLocator('iframe').first().locator('.recharts-bar-rectangle').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('ControlOrMeta+Home');
  await page.waitForTimeout(1200);
  await shot(page, `live-block-${theme}`);

  await addNote(page, TRIP, false);
  await page.waitForTimeout(800);
  await shot(page, `note-${theme}`);

  await context.close();
  assertNoFenceViolations(violations);
}

async function narrow(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, true, theme);
  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  await sidebar(page).getByText('Main', { exact: true }).click();
  for (const note of [WEEKLY, reading('TD'), TRIP]) {
    await addNote(page, note, true);
    await back(page).click();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(600);
  await shot(page, `phone-notes-${theme}`);

  await page.getByRole('button').filter({ hasText: TRIP.title }).first().click();
  await expect(activeEditor(page)).toContainText('Land at');
  await page.waitForTimeout(600);
  await shot(page, `phone-note-${theme}`);

  await back(page).click();
  await page.waitForTimeout(600);
  await page.getByRole('button').filter({ hasText: READING.title }).first().click();
  await expect(page.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot(page, `phone-live-block-${theme}`);

  await context.close();
  assertNoFenceViolations(violations);
}

// ---- Demo video: CDP screencast frames, joined by ffmpeg at their real timing ----

type Frame = { file: string; t: number };

async function screencast(page: Page, dir: string) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  return async (): Promise<Frame[]> => {
    await page.waitForTimeout(300);
    await cdp.send('Page.stopScreencast');
    return frames;
  };
}

/** A constant-frame-rate clip from timed frames; `vf` scales and pads it into the shared 1600x1000 stage. */
function encodeClip(frames: Frame[], out: string, vf: string, tail = 1.2): void {
  const list = frames
    .map((f, i) => `file '${f.file}'\nduration ${(i + 1 < frames.length ? frames[i + 1].t - f.t : tail).toFixed(3)}`)
    .join('\n');
  const listFile = out + '.txt';
  writeFileSync(listFile, `${list}\nfile '${frames.at(-1)!.file}'\n`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `${vf},fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', out]);
}

async function demoDesktop(browser: Browser): Promise<string> {
  const { context, page, violations } = await newContext(browser, false, 'light');
  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  await addNote(page, WEEKLY, false);
  await addNote(page, TRIP, false);

  const stop = await screencast(page, path.join(WORK, 'desktop'));
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^New( note)?$/ }).click();
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeTitleInput(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Publishing flow', { delay: 55 });
  await activeEditor(page).click();
  const type = (text: string) => page.keyboard.type(text, { delay: 38 });
  await type('## How a note gets published');
  await page.keyboard.press('Enter');
  await type('Write it on your device, then share it when it is **ready**. ');
  await page.keyboard.press('Enter');
  await type('- Draft offline');
  await page.keyboard.press('Enter');
  await type('Sync to your private space');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type('```mermaid graph LR; Draft-->Sync; Sync-->Share');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Preview', exact: true }).last().click();
  await expect(page.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]').first()).toBeVisible({ timeout: 20_000 });
  await waitForNoteSaved(page);
  await page.waitForTimeout(2200);

  await openSearch(page, 'trip');
  await page.waitForTimeout(1400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await page.waitForTimeout(700);
  // The radio input sits under its preview card, which takes the click.
  await dialog.getByRole('radiogroup', { name: 'Theme' }).getByText('Dark', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2200);
  const frames = await stop();

  await context.close();
  assertNoFenceViolations(violations);
  const out = path.join(WORK, 'desktop.mp4');
  encodeClip(frames, out, 'scale=1600:1000:flags=lanczos');
  return out;
}

async function demoPhone(browser: Browser): Promise<string> {
  const { context, page, violations } = await newContext(browser, true, 'dark');
  await createFolder(page, 'Work');
  await sidebar(page).getByText('Main', { exact: true }).click();
  for (const note of [WEEKLY, TRIP]) {
    await addNote(page, note, true);
    await back(page).click();
    await page.waitForTimeout(600);
  }

  const stop = await screencast(page, path.join(WORK, 'phone'));
  await page.waitForTimeout(1200);
  await page.getByRole('button').filter({ hasText: TRIP.title }).first().click();
  await expect(activeEditor(page)).toContainText('Land at');
  await page.waitForTimeout(1600);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1400);
  await back(page).click();
  await page.waitForTimeout(1400);
  const frames = await stop();

  await context.close();
  assertNoFenceViolations(violations);
  const out = path.join(WORK, 'phone.mp4');
  // The phone stands in the middle of the stage, on the dark app background.
  encodeClip(frames, out, 'scale=-2:920:flags=lanczos,pad=1600:1000:(ow-iw)/2:(oh-ih)/2:color=0x1C1B1A');
  return out;
}

assertAllowedOrigin(BASE_URL);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const only = process.argv[2];
  if (!only || only === 'shots') {
    for (const theme of ['light', 'dark'] as const) {
      await wide(browser, theme);
      await narrow(browser, theme);
    }
  }
  if (!only || only === 'video') {
    const desktop = await demoDesktop(browser);
    const phone = await demoPhone(browser);
    const list = path.join(WORK, 'clips.txt');
    writeFileSync(list, `file '${desktop}'\nfile '${phone}'\n`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an', `${OUT}/demo.mp4`]);
    // Poster: the first frame of the desktop clip.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', desktop, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', `${OUT}/demo-poster.webp`]);
  }
} finally {
  await browser.close();
  rmSync(WORK, { recursive: true, force: true });
}

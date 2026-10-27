/**
 * Records the landing page's product media (site/public/media/) from the real app, light and dark:
 * screenshots of notes and live blocks, phone screenshots, crops of single features (callouts and
 * tables, math and code, version history, the Share dialog, Settings > Agent access, and small
 * pieces for the pricing page), the public page of a published note, and the hero video.
 * The published note's cover is "Alfama Rooftops and Tagus River View, Lisbon" by Dale Cruse,
 * CC BY 4.0, via Wikimedia Commons (scripts/landing-media-cover.jpg).
 *
 * It runs only against the hermetic e2e build (fake identity, notes made through the
 * UI, network fence on). Needs ffmpeg. Start that build first, then run:
 *
 *   npx vite build --mode e2e --outDir dist-e2e
 *   npx vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 5174 --strictPort &
 *   npx vite-node scripts/landing-media.ts [shots|features|video]
 */
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
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
  "import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';",
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

// More notes for the phone's note list, so the list fills the screen the way a used notebook does.
const OLDER = [
  { title: 'Sourdough', html: '<p>Feed the starter at night, mix at eight, bake at four. Less water in summer.</p>' },
  { title: 'Gift ideas', html: '<p>Mum: the blue teapot from the market. Leo: a field guide to birds.</p>' },
  { title: 'Book club', html: '<p>October pick: The Remains of the Day. Bring questions about Stevens and the letter.</p>' },
  { title: 'Garden', html: '<p>Plant the garlic before the first frost. Move the rosemary to the sunny wall.</p>' },
  { title: 'Standup', html: '<p>Shipped the export fix. Today: the import preview. No blockers.</p>' },
];

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

async function newContext(browser: Browser, phone: boolean, theme: Theme, clock = false): Promise<{ context: BrowserContext; page: Page; violations: string[] }> {
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
  // Version history snapshots at most once per 5 minutes; a fake clock jumps past that.
  if (clock) await page.clock.install();
  await boot(page);
  await tidy(page);
  return { context, page, violations };
}

/**
 * Hides app chrome that is noise in a still (the empty "Add cover" and "Add tags..." rows), fits a diagram to
 * its column, and gives the test identity's avatar a palette colour and a believable initial instead of its saturated hash colour.
 */
async function tidy(page: Page): Promise<void> {
  await page.addStyleTag({
    content: [
      '[aria-label="Add cover"], input[placeholder="Add tags..."] { display: none !important; }',
      // A diagram a few pixels wider than the note scrolls sideways in the app; in a still it would look cut off.
      "[data-live-block-preview='mermaid'] svg[style*='max-width'] { width: 100% !important; }",
      '.rounded-full[style*="background-color"] { background-color: #67665E !important; font-size: 0 !important; }',
      ".rounded-full[style*=\"background-color\"]::after { content: 'S'; font-size: 15px; color: #FDFCF8; }",
    ].join('\n'),
  });
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
  // The note without the app around it, for the agents section.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  // Down to the diagram, above the assistant button in the corner.
  await noteCrop(page, `agent-result-${theme}`, 600);

  await context.close();
  assertNoFenceViolations(violations);
}

async function narrow(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, true, theme);
  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  await sidebar(page).getByText('Main', { exact: true }).click();
  for (const note of [...OLDER, WEEKLY, reading('TD'), TRIP]) {
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

// ---- Hero video: CDP screencast frames, joined by ffmpeg at their real timing ----

type Frame = { file: string; t: number };

/**
 * Records the page. `cut()` stops recording until `resume()`: opening a note shows a loading state for a moment, and
 * the clip skips it. Starting the screencast again sends the current screen at once, so the first frame after a cut
 * shows the new screen even when nothing on it moves. Frames are timed on arrival, with the cut time taken out.
 */
async function screencast(page: Page, dir: string) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  let recording = false;
  let pausedAt = 0;
  let offset = 0;
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!recording) return;
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: Date.now() / 1000 - offset });
  });
  const start = async () => {
    recording = true;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: 2560, maxHeight: 1600 });
  };
  await start();
  return {
    cut: async () => {
      recording = false;
      pausedAt = Date.now() / 1000;
      await cdp.send('Page.stopScreencast');
    },
    resume: async () => {
      offset += Date.now() / 1000 - pausedAt;
      await start();
    },
    stop: async (): Promise<Frame[]> => {
      await page.waitForTimeout(300);
      await cdp.send('Page.stopScreencast');
      return frames;
    },
  };
}

/** A constant-frame-rate clip from timed frames, filtered by `vf`. */
function encodeClip(frames: Frame[], out: string, vf: string, tail = 1.2): void {
  const list = frames
    .map((f, i) => `file '${f.file}'\nduration ${(i + 1 < frames.length ? frames[i + 1].t - f.t : tail).toFixed(3)}`)
    .join('\n');
  const listFile = out + '.txt';
  writeFileSync(listFile, `${list}\nfile '${frames.at(-1)!.file}'\n`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `${vf},fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', out]);
}

const PUBLISHING = {
  title: 'Publishing flow',
  html: [
    '<h2>How a note gets published</h2>',
    '<p>Write it on your device, then share it when it is <strong>ready</strong>.</p>',
    '<ul><li><p>Draft offline</p></li><li><p>Sync to your private space</p></li><li><p>Publish it as a public page</p></li></ul>',
  ].join(''),
};

/**
 * The hero loop, desktop only: the finished Reading log, then a diagram added to the Publishing flow note, then
 * back to the Reading log. It starts and ends on the same frame, and the loading states are cut.
 * The clip is the notes list and the note, without the sidebar or the editor toolbar, at device pixels, so the
 * note's text reads at its own size on the landing page.
 */
async function heroVideo(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, false, theme);
  await page.addStyleTag({ content: 'button[aria-label="Open assistant"] { display: none !important; }' });
  await createFolder(page, 'Work');
  await createFolder(page, 'Personal');
  await addNote(page, WEEKLY, false);
  await addNote(page, TRIP, false);
  await addNote(page, READING, false);
  await addNote(page, PUBLISHING, false);
  const openNote = async (title: string) => {
    await page.getByTestId('note-row').filter({ hasText: title }).click();
    await expect(activeTitleInput(page)).toHaveValue(title);
  };
  const chart = () => page.frameLocator('iframe:visible').first().locator('.recharts-bar-rectangle').first();
  await openNote(READING.title);
  await expect(page.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]:visible').first()).toBeVisible({ timeout: 20_000 });
  await expect(chart()).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);

  // The clip: from the notes list's left edge to the window's, and from under the toolbar down.
  const list = (await page.getByTestId('note-row').first().boundingBox())!;
  const toolbar = (await page.locator('button[title^="Undo"]:visible').first().boundingBox())!;
  const top = Math.round(toolbar.y + toolbar.height + 18);
  const crop = { x: Math.round(list.x) * 2, y: top * 2, w: (1280 - Math.round(list.x)) * 2, h: (730 - top) * 2 };

  const rec = await screencast(page, path.join(WORK, `desktop-${theme}`));
  await page.waitForTimeout(3000);

  await rec.cut();
  await openNote(PUBLISHING.title);
  await expect(activeEditor(page)).toContainText('Publish it as a public page');
  await page.waitForTimeout(500);
  await rec.resume();
  await page.waitForTimeout(1400);
  await activeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```mermaid graph LR; Draft-->Sync; Sync-->Publish', { delay: 45 });
  await page.waitForTimeout(500);
  // The diagram's own "Rendering" state is cut too.
  await rec.cut();
  await page.getByRole('button', { name: 'Preview', exact: true }).last().click();
  await expect(page.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]:visible').first()).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await rec.resume();
  await waitForNoteSaved(page);
  await page.waitForTimeout(2600);

  await rec.cut();
  await openNote(READING.title);
  await expect(chart()).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await rec.resume();
  await page.waitForTimeout(1200);
  const frames = await rec.stop();

  await context.close();
  assertNoFenceViolations(violations);
  const clip = path.join(WORK, `desktop-${theme}.mp4`);
  // Frames are scaled to the 1280x800 window at 2x before the crop.
  encodeClip(frames, clip, `scale=2560:1600:flags=lanczos,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, 0.6);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', `${OUT}/hero-${theme}.mp4`]);
  // Poster: the first frame, the finished Reading log.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '86', `${OUT}/hero-poster-${theme}.webp`]);
}

// ---- Feature crops: one block of a real note, light and dark, desktop and phone ----

const MATH = {
  title: 'Physics revision',
  html: [
    '<p>The energy of one photon, from its wavelength <span data-type="inline-math" data-latex="\\lambda"></span>:</p>',
    '<div data-type="block-math" data-latex="E = h\\nu = \\frac{hc}{\\lambda}"></div>',
    `<pre><code class="language-python">${esc([
      'h, c = 6.626e-34, 2.998e8',
      '',
      'def photon_energy(wavelength_nm):',
      '    return h * c / (wavelength_nm * 1e-9)',
      '',
      'print(photon_energy(532))  # green laser, in joules',
    ].join('\n'))}</code></pre>`,
  ].join(''),
};

/** A screenshot of the open note from its title down, `height` CSS pixels tall. */
async function noteCrop(page: Page, name: string, height: number, width?: number): Promise<void> {
  const title = (await activeTitleInput(page).boundingBox())!;
  const editor = (await activeEditor(page).boundingBox())!;
  const x = Math.max(0, Math.min(title.x, editor.x) - 40);
  const png = path.join(WORK, `${name}.png`);
  await page.screenshot({ path: png, clip: { x, y: Math.max(0, title.y - 32), width: width ?? Math.min(editor.width + 80, 1280 - x), height } });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', `${OUT}/${name}.webp`]);
}

async function elementShot(page: Page, selector: ReturnType<Page['locator']>, name: string): Promise<void> {
  const png = path.join(WORK, `${name}.png`);
  await selector.screenshot({ path: png, animations: 'disabled' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', `${OUT}/${name}.webp`]);
}

async function blocks(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, false, theme);
  await addNote(page, TRIP, false);
  await page.waitForTimeout(600);
  await noteCrop(page, `feature-blocks-${theme}`, 560);

  await addNote(page, MATH, false);
  await expect(activeEditor(page).locator('[data-type="block-math"] .katex')).toBeVisible({ timeout: 20_000 });
  await expect(activeEditor(page).locator('pre .hljs-keyword').first()).toBeVisible();
  await page.waitForTimeout(600);
  // Down to the code block, with the same margin on its right as the note has on its left.
  const code = (await activeEditor(page).locator('pre').first().boundingBox())!;
  const titleBox = (await activeTitleInput(page).boundingBox())!;
  const left = Math.min(titleBox.x, code.x) - 40;
  await noteCrop(page, `feature-math-${theme}`, code.y + code.height + 40 - (titleBox.y - 32), code.x + code.width + 40 - left);

  // Share: the dialog as it opens on a private note.
  await page.getByRole('button').filter({ hasText: TRIP.title }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Make Note Public' })).toBeVisible();
  // The link preview names the app's own host; show the one visitors see instead of the test server's.
  await dialog.getByText(new URL(BASE_URL).host, { exact: true }).evaluate((el) => (el.textContent = 'journal.cloudx.run'));
  await page.waitForTimeout(600);
  // The dialog's header and its controls column, down to the Make Note Public button.
  const box = (await dialog.boundingBox())!;
  const button = (await dialog.getByRole('button', { name: 'Make Note Public' }).boundingBox())!;
  const png = path.join(WORK, `share-dialog-${theme}.png`);
  await page.screenshot({ path: png, clip: { x: box.x, y: box.y, width: button.x + button.width + 24 - box.x, height: button.y + button.height + 24 - box.y } });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', `${OUT}/share-dialog-${theme}.webp`]);
  await page.keyboard.press('Escape');

  await context.close();
  assertNoFenceViolations(violations);

  const phone = await newContext(browser, true, theme);
  await sidebar(phone.page).getByText('Main', { exact: true }).click();
  await addNote(phone.page, MATH, true);
  await expect(activeEditor(phone.page).locator('[data-type="block-math"] .katex')).toBeVisible({ timeout: 20_000 });
  await phone.page.waitForTimeout(800);
  await shot(phone.page, `phone-math-${theme}`);
  await phone.context.close();
  assertNoFenceViolations(phone.violations);
}

/** Two snapshots of one note, then the Version history dialog over it. */
async function history(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, false, theme, true);
  const title = 'Packing list';
  const editor = activeEditor(page);
  const open = () => page.getByRole('button').filter({ hasText: title }).first().click();
  const close = () => page.getByRole('button', { name: `Close ${title}` }).click();

  await addNote(page, { title, html: '<p>Passport, charger, rain jacket.</p>' }, false);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Tram passes.');
  await waitForNoteSaved(page);
  await close(); // compacts: the first snapshot
  await open();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Swap the rain jacket for a light coat; the forecast is dry.');
  await waitForNoteSaved(page);
  await page.clock.fastForward('06:00');
  await close(); // the second snapshot
  await open();
  await expect(editor).toContainText('light coat');

  await page.getByRole('button', { name: 'Version history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  // No focus ring on Close, and the panel cropped 8px inside its edge, clear of its rounded corners and of the
  // page behind them: the landing page gives the picture its own corners.
  await dialog.getByRole('button', { name: 'Close' }).evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(800);
  const panel = (await dialog.boundingBox())!;
  const historyPng = path.join(WORK, `feature-history-${theme}.png`);
  await page.screenshot({ path: historyPng, clip: { x: panel.x + 8, y: panel.y + 8, width: panel.width - 16, height: panel.height - 16 } });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', historyPng, '-c:v', 'libwebp', '-quality', '82', `${OUT}/feature-history-${theme}.webp`]);

  await context.close();
  assertNoFenceViolations(violations);
}

/** Settings > Agent access with a grant per folder: what an MCP agent may read or write. On a phone, the whole screen. */
async function agentAccess(browser: Browser, theme: Theme, phone: boolean): Promise<void> {
  const { context, page, violations } = await newContext(browser, phone, theme);
  // The hermetic drive has no grants file: answer "none yet", and let saves hang so each choice stays as set.
  await page.route('**/drive/query/specialized/cuid/header**', (route) =>
    route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 404,
      headers: {
        'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
      },
    }),
  );
  await page.route('**/drive/files/upload**', () => {});
  await createFolder(page, 'Work');
  await createFolder(page, 'Reading');
  await createFolder(page, 'Personal');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Agent access' }).click();
  await dialog.getByLabel('Agent access for Work').selectOption('write');
  await dialog.getByLabel('Agent access for Reading').selectOption('write');
  await dialog.getByLabel('Agent access for Main').selectOption('read');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  if (phone) await shot(page, `phone-agent-access-${theme}`);
  else await elementShot(page, dialog, `agent-access-${theme}`);
  // Just the folder grants, for the home page's agents teaser.
  await elementShot(page, dialog.locator('.rounded-xl.border.bg-card').first(), `${phone ? 'phone-' : ''}agent-grants-${theme}`);
  await context.close();
  assertNoFenceViolations(violations);
}

/** Tight crops of four small pieces of the app for the pricing page: the sidebar, the slash menu, the theme choice and import. */
async function pricingCrops(browser: Browser, theme: Theme): Promise<void> {
  const { context, page, violations } = await newContext(browser, false, theme);
  await createFolder(page, 'Work');
  await createFolder(page, 'Reading');
  await createFolder(page, 'Personal');
  await addNote(page, WEEKLY, false);
  await addNote(page, TRIP, false);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);

  const side = (await sidebar(page).boundingBox())!;
  const last = (await sidebar(page).getByText('Work', { exact: true }).boundingBox())!;
  const sidePng = path.join(WORK, `free-sidebar-${theme}.png`);
  await page.screenshot({ path: sidePng, clip: { x: side.x, y: side.y, width: side.width, height: last.y + last.height + 20 - side.y } });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', sidePng, '-c:v', 'libwebp', '-quality', '82', `${OUT}/free-sidebar-${theme}.webp`]);

  await page.getByRole('button', { name: /^New( note)?$/ }).click();
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeEditor(page).click();
  await page.keyboard.type('/t');
  const slash = page.locator('.w-72.max-h-80');
  await expect(slash).toBeVisible();
  // The menu scrolls; the crop ends under the last whole item, so its edge is left out too.
  await page.addStyleTag({ content: '.w-72.max-h-80 { border-color: transparent !important; box-shadow: none !important; border-radius: 0 !important; }' });
  await page.waitForTimeout(500);
  const menu = (await slash.boundingBox())!;
  const lastWhole = (await slash.getByRole('button').filter({ hasText: 'Table' }).first().boundingBox())!;
  const slashPng = path.join(WORK, `free-slash-${theme}.png`);
  await page.screenshot({ path: slashPng, clip: { x: menu.x, y: menu.y, width: menu.width, height: lastWhole.y + lastWhole.height + 8 - menu.y } });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', slashPng, '-c:v', 'libwebp', '-quality', '82', `${OUT}/free-slash-${theme}.webp`]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await elementShot(page, dialog.getByRole('radiogroup', { name: 'Theme' }).locator('..'), `free-theme-${theme}`);
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  const importBlock = dialog.getByRole('button', { name: 'Import Archive' }).locator('..');
  await importBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await elementShot(page, importBlock, `free-import-${theme}`);

  await context.close();
  assertNoFenceViolations(violations);
}

// ---- The public page: a published note, read the way a visitor reads it ----
// Canned guest reads on a *.homebase.test identity, as in e2e/publishing/share-wide-blocks.spec.ts.
// The byline then shows SHOWN_AUTHOR: the test domain never appears in a picture.

const AUTHOR = 'e2e-author.homebase.test';
const SHOWN_AUTHOR = 'sam.homebase.id';
const PUBLIC_ID = '7c1d4b8e-2f63-4a90-8e57-5b9a0c3d6f21';
const PUBLIC_FILE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const PUBLIC_TITLE = 'Three days in Lisbon';
const COVER = readFileSync('scripts/landing-media-cover.jpg');

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, unknown> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value as never);
  el.insert(0, children);
  return el;
}
const para = (text: string) => element('paragraph', [new Y.XmlText(text)]);
const heading = (text: string) => element('heading', [new Y.XmlText(text)], { level: 2 });

// A phone column fits a top-down diagram; the desktop page fits one that runs left to right.
function publicNote(flow: 'LR' | 'TD'): Buffer {
  const doc = new Y.Doc();
  doc.getMap('journalMeta').set('cover', { src: `attachment://${PUBLIC_FILE}/jrnl_img_cover`, positionY: 72 });
  doc.getXmlFragment('prosemirror').push([
    para('Three days, one small suitcase, and a city built on seven hills. These are the notes I kept on the way, tidied up for anyone going next.'),
    heading('Day one: Alfama'),
    para('Land at 10:15, drop the bags, then walk down to the river for lunch. The castle is quietest before ten in the morning, so it waits for day two.'),
    element('codeBlock', [new Y.XmlText(`graph ${flow}\n  Castle[Castle] --> Alfama[Alfama lanes]\n  Alfama --> River[River lunch]`)], { language: 'mermaid' }),
    heading('Day two: Belém'),
    para('Take the tram out early, before the crowds. The custard tarts are worth the queue; eat them warm on a bench by the water.'),
    heading('Day three: Baixa'),
    para('A slow morning in the lower town, then the long climb to the viewpoint for the last light over the rooftops.'),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page, flow: 'LR' | 'TD'): Promise<void> {
  const published = Date.UTC(2026, 8, 30, 9, 0);
  const header = {
    fileId: PUBLIC_FILE,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: published,
      payloads: [{ key: 'jrnl_txt' }],
      appData: { uniqueId: PUBLIC_ID, userDate: published, archivalStatus: 0, content: JSON.stringify({ title: PUBLIC_TITLE }) },
    },
  };
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    return url.searchParams.get('key') === 'jrnl_img_cover'
      ? route.fulfill({ contentType: 'image/jpeg', headers: { ...headers, decryptedcontenttype: 'image/jpeg' }, body: COVER })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: publicNote(flow) });
  });
}

async function publicPage(browser: Browser, theme: Theme, phone: boolean): Promise<void> {
  const context = await browser.newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }),
    colorScheme: theme,
    serviceWorkers: 'block',
  });
  const { violations } = await installNetworkFence(context);
  const page = await context.newPage();
  await mockPublicNote(page, phone ? 'TD' : 'LR');
  await page.goto(`${BASE_URL}/share/${AUTHOR}/${PUBLIC_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: PUBLIC_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(article.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]')).toBeVisible({ timeout: 30_000 });
  // Name the author with a believable identity, and its initial in the avatar.
  await article.evaluate((el, [from, to]) => {
    for (const span of el.querySelectorAll('span')) {
      if (span.textContent === from) span.textContent = to;
      else if (span.textContent === from[0].toUpperCase() && span.childElementCount === 0) span.textContent = to[0].toUpperCase();
    }
  }, [AUTHOR, SHOWN_AUTHOR]);
  await expect(article).not.toContainText('homebase.test');
  await page.waitForTimeout(1200);
  if (phone) await page.mouse.wheel(0, 0);
  const prefix = phone ? 'phone-' : '';
  await shot(page, `${prefix}public-page-${theme}`);

  // Below the cover: the title down to the first day's diagram, a live block still running on the public page.
  await article.getByRole('heading', { level: phone ? 2 : 1 }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  // Headings keep a scroll margin for the outline; on a phone that already clears the header.
  if (!phone) await page.evaluate(() => window.scrollBy(0, -72));
  await page.waitForTimeout(600);
  await shot(page, `${prefix}public-blocks-${theme}`);
  await context.close();
  assertNoFenceViolations(violations);
}

assertAllowedOrigin(BASE_URL);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const only = process.argv[2];
  for (const theme of ['light', 'dark'] as const) {
    if (!only || only === 'shots') {
      await wide(browser, theme);
      await narrow(browser, theme);
    }
    if (!only || only === 'features') {
      await blocks(browser, theme);
      await history(browser, theme);
      await publicPage(browser, theme, false);
      await publicPage(browser, theme, true);
    }
    if (!only || only === 'video') await heroVideo(browser, theme);
    if (only === 'wide') await wide(browser, theme);
    if (only === 'history') await history(browser, theme);
    if (!only || only === 'features' || only === 'pricing') await pricingCrops(browser, theme);
    if (only === 'public') {
      await publicPage(browser, theme, false);
      await publicPage(browser, theme, true);
    }
    if (!only || only === 'features' || only === 'agents') {
      await agentAccess(browser, theme, false);
      await agentAccess(browser, theme, true);
    }
  }
} finally {
  await browser.close();
  rmSync(WORK, { recursive: true, force: true });
}

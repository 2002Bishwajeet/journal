import type { FrameLocator, Page, Request } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #427: a react block written like a Claude artifact (Tailwind classes, a Recharts chart with
// no colour props, a lucide icon) renders in Journal's colours and font, in light and dark,
// with no network: the sheet and both libraries are inlined into its sandboxed frame.

const ARTIFACT = [
  "import React, { useState } from 'react';",
  "import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';",
  "import { Heart } from 'lucide-react';",
  '',
  'const data = [',
  "  { day: 'Mon', words: 420, notes: 260 },",
  "  { day: 'Tue', words: 380, notes: 310 },",
  "  { day: 'Wed', words: 610, notes: 290 },",
  "  { day: 'Thu', words: 540, notes: 450 },",
  '];',
  '',
  'export default function WritingWeek() {',
  '  const [liked, setLiked] = useState(false);',
  '  return (',
  '    <div id="card" className="space-y-4 rounded-lg border bg-card p-4 font-sans">',
  '      <div className="flex items-center justify-between">',
  '        <h2 className="text-lg font-semibold">Writing this week</h2>',
  '        <button id="like" onClick={() => setLiked(!liked)} className="flex items-center gap-1 rounded-md bg-blue-500 px-3 py-1 text-sm text-white">',
  "          <Heart className=\"size-4\" /> {liked ? 'Liked' : 'Like'}",
  '        </button>',
  '      </div>',
  '      <p id="caption" className="text-sm text-gray-500">Words and notes per day</p>',
  '      <ResponsiveContainer width="100%" height={220}>',
  '        <LineChart data={data}>',
  '          <CartesianGrid strokeDasharray="3 3" />',
  '          <XAxis dataKey="day" />',
  '          <YAxis />',
  '          <Tooltip />',
  '          <Line type="monotone" dataKey="words" />',
  '          <Line type="monotone" dataKey="notes" />',
  '        </LineChart>',
  '      </ResponsiveContainer>',
  '    </div>',
  '  );',
  '}',
].join('\n');

const NOT_ALLOWED = "import * as d3 from 'd3';\nfunction App() { return <p>{d3.version}</p>; }";

const LIBRARY_URL = /react-block-(recharts|lucide)/;

const reactFrame = (page: Page, index = 0): FrameLocator => activeEditor(page).locator('[data-live-block="react"]').nth(index).frameLocator('iframe[title="React preview"]');

/** True for a request made by a frame inside the page, rather than by the page itself. */
function fromFrame(request: Request): boolean {
  try {
    return request.frame().parentFrame() !== null;
  } catch {
    // A service worker's own request has no frame.
    return false;
  }
}

/** Pastes `source` as a react block on a new line; a pasted block opens in Preview. */
async function pasteBlock(page: Page, source: string): Promise<void> {
  await page.keyboard.press('Enter');
  await pastePlainText(page, '```react\n' + source + '\n```');
}

/**
 * What the artifact's parts are drawn in, and the theme variables they should be drawn in,
 * both as the frame computes them (a colour in rgb() form).
 */
async function drawn(frame: FrameLocator) {
  return frame.locator('#card').evaluate((card) => {
    const computed = (el: Element) => getComputedStyle(el);
    // A theme variable as the frame resolves it, in the same form as a computed colour.
    const token = (name: string) => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = `var(${name})`;
      const value = computed(probe).color;
      probe.remove();
      return value;
    };
    const raw = (name: string) => computed(document.documentElement).getPropertyValue(name).trim();
    const like = document.getElementById('like')!;
    return {
      tokens: {
        chart1: token('--chart-1'),
        chart1Raw: raw('--chart-1'),
        chart2Raw: raw('--chart-2'),
        background: token('--background'),
        mutedForeground: token('--muted-foreground'),
        mutedForegroundRaw: raw('--muted-foreground'),
        borderRaw: raw('--border'),
        border: token('--border'),
        card: token('--card'),
      },
      likeBackground: computed(like).backgroundColor,
      likeText: computed(like).color,
      icon: { stroke: like.querySelector('svg')?.getAttribute('stroke'), color: computed(like.querySelector('svg')!).color },
      caption: computed(document.getElementById('caption')!).color,
      cardBackground: computed(card).backgroundColor,
      cardBorder: computed(card).borderTopColor,
      cardFont: computed(card).fontFamily,
      noteFont: computed(document.body).fontFamily,
      lines: [...document.querySelectorAll('.recharts-line-curve')].map((line) => line.getAttribute('stroke')),
      grid: [...document.querySelectorAll('.recharts-cartesian-grid line')].map((line) => line.getAttribute('stroke')),
      ticks: [...document.querySelectorAll('.recharts-cartesian-axis-tick-value')].map((tick) => tick.getAttribute('fill')),
    };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`react block like a Claude artifact: Tailwind, a Recharts chart and a lucide icon in Journal's theme, with no network, ${theme} theme`, async ({ app }) => {
    const requests: Request[] = [];
    app.on('request', (request) => requests.push(request));
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `React artifact ${theme} ${Date.now()}`, body: 'Intro' });
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));
    await pasteBlock(app, ARTIFACT);

    const frame = reactFrame(app);
    await expect(frame.getByRole('button', { name: 'Like' })).toBeVisible();
    await expect(frame.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(frame.locator('.recharts-cartesian-axis-tick-value').first()).toBeVisible();
    await frame.getByRole('button', { name: 'Like' }).click();
    await expect(frame.getByRole('button', { name: 'Liked' })).toBeVisible();

    const result = await drawn(frame);
    // The two series, with no colour props, are --chart-1 and --chart-2.
    expect(result.lines).toEqual([result.tokens.chart1Raw, result.tokens.chart2Raw]);
    // The grid is --border, the tick labels --muted-foreground.
    expect(result.grid.length).toBeGreaterThan(0);
    expect(new Set(result.grid)).toEqual(new Set([result.tokens.borderRaw]));
    expect(result.ticks.length).toBeGreaterThan(0);
    expect(new Set(result.ticks)).toEqual(new Set([result.tokens.mutedForegroundRaw]));
    // Raw palette classes resolve to their theme tokens: bg-blue-500 is --chart-1, text-white
    // --background, text-gray-500 --muted-foreground.
    expect(result.likeBackground).toBe(result.tokens.chart1);
    expect(result.likeText).toBe(result.tokens.background);
    expect(result.caption).toBe(result.tokens.mutedForeground);
    // Theme names: bg-card, and a bare border in --border.
    expect(result.cardBackground).toBe(result.tokens.card);
    expect(result.cardBorder).toBe(result.tokens.border);
    // The icon draws in currentColor, so it follows the button's text.
    expect(result.icon).toEqual({ stroke: 'currentColor', color: result.likeText });
    // font-sans is the note's font.
    expect(result.cardFont).toBe(result.noteFont);

    // Nothing in the frame touched the network: the sheet and the libraries are inline.
    expect(requests.filter(fromFrame).map((request) => request.url())).toEqual([]);
    // The app loaded both libraries for this block, from its own origin.
    const origin = new URL(app.url()).origin;
    const libraries = requests.filter((request) => LIBRARY_URL.test(request.url()));
    expect(libraries.length).toBeGreaterThanOrEqual(2);
    expect(libraries.every((request) => new URL(request.url()).origin === origin)).toBe(true);

    const block = activeEditor(app).locator('[data-live-block="react"]').first();
    await block.scrollIntoViewIfNeeded();
    // The lines are drawn in by an animation, which dashes them until it ends.
    await expect.poll(() => frame.locator('.recharts-line-curve').evaluateAll((curves) => curves.every((curve) => !curve.hasAttribute('stroke-dasharray')))).toBe(true);
    await frame.locator('body').evaluate(() => new Promise<void>((painted) => requestAnimationFrame(() => requestAnimationFrame(() => painted()))));
    await app.screenshot({ path: test.info().outputPath(`react-artifact-${theme}-desktop.png`) });
  });
}

test('react block: an import outside the allow-list shows an error naming the module and the allowed ones', async ({ app }) => {
  await createNote(app, { title: `React d3 ${Date.now()}`, body: 'Intro' });
  await pasteBlock(app, NOT_ALLOWED);
  await expect(reactFrame(app).getByRole('alert')).toContainText('A react block can import only react, recharts and lucide-react, not d3.');
  await app.screenshot({ path: test.info().outputPath('react-import-error-light-desktop.png') });
});

test('react block: after one render, the artifact with its chart and icon still renders offline after a reload', async ({ browser }) => {
  // The dev server builds no service worker; this needs the preview build's real /sw.js.
  test.skip(process.env.E2E_SERVER === 'dev', 'needs the preview build');
  // The hermetic project blocks service workers (playwright.config.ts). This test needs one to
  // serve the app offline, so its own context allows it; sw.ts only fetches the app's origin.
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'allow' }, async (page) => {
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await createNote(page, { title: `React artifact offline ${Date.now()}`, body: 'Intro' });
    await pasteBlock(page, ARTIFACT);
    await expect(reactFrame(page).locator('.recharts-line-curve')).toHaveCount(2);
    // The runtime, the sheet, the compiler and both libraries (the react-block route in sw.ts).
    await expect
      .poll(() => page.evaluate(async () => ((await caches.has('react-block')) ? (await (await caches.open('react-block')).keys()).length : 0)))
      .toBe(5);

    await page.context().setOffline(true);
    try {
      await page.reload();
      await waitForAppReady(page);
      const frame = reactFrame(page);
      await expect(frame.locator('.recharts-line-curve')).toHaveCount(2);
      await expect(frame.locator('#like svg')).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });
});

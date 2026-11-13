import type { CDPSession, Locator, Page } from '@playwright/test';
import { test, waitForAppReady } from '../fixtures';
import { assertTestOrigin } from './origin-guard';

// Note-open measurement: from the click (or tap) on a note row to the URL change, the
// row selected or the editor mounted, and the note's title and editor visible, plus
// the long tasks and CDP style/layout/script time on the way. Run with --trace=off: the
// config's trace (retain-on-failure) snapshots the DOM after each step, and with long notes
// open each snapshot is a ~200 ms task that lands inside the measurement.

/** The folder the note-open specs seed: a realistic list. */
export const NOTE_FOLDER = { name: 'Alpha', count: 100 };

export interface OpenSample {
  title: string;
  /** Click to the URL change, in ms. */
  urlMs: number;
  /** Click to the row selected (desktop) or the note's editor mounted (phone), in ms. */
  selectedMs: number;
  /** Click to the first frame with the note's title and editor visible, in ms. */
  visibleMs: number;
  longTasks: number;
  longTaskMs: number;
  layoutMs: number;
  styleMs: number;
  scriptMs: number;
}

/** Records long tasks (installed before the app loads), seeds the folder and returns a CDP session. */
export async function setUpNoteOpen(page: Page): Promise<CDPSession> {
  await page.addInitScript(() => {
    const w = window as unknown as { __openProbe: PerformanceEntry[] };
    w.__openProbe = [];
    new PerformanceObserver((list) => w.__openProbe.push(...list.getEntries())).observe({ entryTypes: ['longtask'] });
  });
  await page.reload();
  await waitForAppReady(page);
  await assertTestOrigin(page);
  await page.evaluate((f) => window.__journalE2E!.seedFolders([f]), NOTE_FOLDER);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  return cdp;
}

async function cdpMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/**
 * Clicks (or taps) `row`, the row of the note titled `title`, and measures until the note shows.
 * The input goes to the row's coordinates: a locator click re-runs Playwright's selector engine
 * in the page while the app works, and with long notes open each of those runs takes a frame.
 */
export async function measureOpen(page: Page, cdp: CDPSession, row: Locator, title: string, input: 'click' | 'tap' = 'click'): Promise<OpenSample> {
  await assertTestOrigin(page);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (!box) throw new Error(`no row for ${title}`);
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.evaluate((title) => {
    const state = { t0: 0, url: 0, selected: 0, visible: 0 };
    (window as unknown as { __open: typeof state }).__open = state;
    const href = location.href;
    const editorFor = () =>
      [...document.querySelectorAll<HTMLTextAreaElement>('textarea[placeholder="Untitled"]')].find((t) => t.value === title);
    const tick = () => {
      const now = performance.now();
      if (!state.url && location.href !== href) state.url = now;
      if (!state.selected) {
        const rows = [...document.querySelectorAll('[data-testid="note-row"]')];
        const selected = rows.some((r) => r.textContent?.includes(title) && r.querySelector('.bg-accent'));
        if (selected || editorFor()) state.selected = now;
      }
      const editor = editorFor();
      const body = [...document.querySelectorAll('.ProseMirror')].some((e) => e.checkVisibility());
      if (editor?.checkVisibility() && body) {
        state.visible = now;
        return;
      }
      requestAnimationFrame(tick);
    };
    document.addEventListener('pointerdown', () => {
      state.t0 = performance.now();
      requestAnimationFrame(tick);
    }, { capture: true, once: true });
  }, title);
  const before = await cdpMetrics(cdp);
  await (input === 'tap' ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  await page.waitForFunction(() => (window as unknown as { __open: { visible: number } }).__open.visible > 0, null, { timeout: 30_000 });
  const after = await cdpMetrics(cdp);
  const probe = await page.evaluate(() => {
    const w = window as unknown as { __open: { t0: number; url: number; selected: number; visible: number }; __openProbe: PerformanceEntry[] };
    const s = w.__open;
    const tasks = w.__openProbe.filter((t) => t.startTime + t.duration >= s.t0 && t.startTime <= s.visible);
    return {
      urlMs: s.url ? s.url - s.t0 : -1,
      selectedMs: s.selected - s.t0,
      visibleMs: s.visible - s.t0,
      longTasks: tasks.length,
      longTaskMs: tasks.reduce((sum, t) => sum + t.duration, 0),
    };
  });
  const d = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000);
  return {
    title,
    urlMs: Math.round(probe.urlMs),
    selectedMs: Math.round(probe.selectedMs),
    visibleMs: Math.round(probe.visibleMs),
    longTasks: probe.longTasks,
    longTaskMs: Math.round(probe.longTaskMs),
    layoutMs: d('LayoutDuration'),
    styleMs: d('RecalcStyleDuration'),
    scriptMs: d('ScriptDuration'),
  };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Prints and attaches the samples and returns the per-metric medians. */
export async function reportOpens(samples: OpenSample[], attachment: string): Promise<Omit<OpenSample, 'title'>> {
  const keys = ['urlMs', 'selectedMs', 'visibleMs', 'longTasks', 'longTaskMs', 'layoutMs', 'styleMs', 'scriptMs'] as const;
  const medians = Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]))])) as Omit<OpenSample, 'title'>;
  console.table([...samples, { title: 'median', ...medians }]);
  console.log(`NOTE_OPEN_MEDIAN ${attachment} ${JSON.stringify(medians)}`);
  await test.info().attach(attachment, { body: JSON.stringify({ samples, medians }, null, 2), contentType: 'application/json' });
  return medians;
}
